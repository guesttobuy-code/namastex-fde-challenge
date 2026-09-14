"""CLI (issue #6, F5/#8 absorvida): coleta -> cota -> decide -> responde ou encaminha. Usa
`FakePortalDeCotacao` -- nunca a rede de verdade (a prova contra o quote-service real é manual,
colada no corpo do PR, não faz parte da suíte automática)."""
from __future__ import annotations

from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao
from infra.adaptador_de_linguagem import AdaptadorDeLinguagemDeterministico
from infra.cliente_quote import FakePortalDeCotacao
from infra.repositorio_configuracao_comercial_json import RepositorioDeConfiguracaoComercialJSON
from infra.trilha_jsonl import RepositorioDeTrilhaMemoria
from interfaces.cli import _Transcricao, coletar_dados, coletar_dados_por_texto_livre, rodar_conversa

_PRECO = PrecoCotado(
    quote_attempt_id="attempt-1",
    conversation_id="conv-x",
    plano_id="essencial",
    plano_nome="Essencial",
    premio_mensal=119.9,
    franquia=4500.0,
    coberturas=("colisao", "roubo", "furto"),
    moeda="BRL",
)


def _respostas(*linhas: str):
    fila = list(linhas)

    def entrada() -> str:
        return fila.pop(0)

    return entrada


def _respostas_com_eof(*linhas: str):
    """Como `_respostas`, mas levanta `EOFError` quando a fila acaba — o que `input()` faz de
    verdade quando o stdin fecha (achado da coordenação, 2026-09-12: sem tratar isso a CLI caía
    com traceback)."""
    fila = list(linhas)

    def entrada() -> str:
        if not fila:
            raise EOFError
        return fila.pop(0)

    return entrada


def test_coletar_dados_aceita_tudo_de_primeira(capsys):
    dados = coletar_dados(
        _Transcricao(), "conv-teste", entrada=_respostas("30", "2020", "01310-100", "completo", "2026-10-01")
    )

    assert dados == {
        "idade": 30,
        "veiculo_ano": 2020,
        "cep": "01310-100",
        "plano_id": "completo",
        "data_inicio": "2026-10-01",
    }
    capsys.readouterr()  # silencia a saída da coleta neste teste


def test_coletar_dados_campos_opcionais_em_branco():
    dados = coletar_dados(_Transcricao(), "conv-teste", entrada=_respostas("30", "2020", "01310-100", "", ""))

    assert dados["plano_id"] is None
    assert dados["data_inicio"] is None


def test_coletar_dados_reprompta_cep_invalido(capsys):
    dados = coletar_dados(
        _Transcricao(), "conv-teste", entrada=_respostas("30", "2020", "abc", "01310-100", "", "")
    )

    assert dados["cep"] == "01310-100"
    assert "inválido" in capsys.readouterr().out


def test_coletar_dados_reprompta_campo_obrigatorio_em_branco(capsys):
    dados = coletar_dados(
        _Transcricao(), "conv-teste", entrada=_respostas("", "30", "2020", "01310-100", "", "")
    )

    assert dados["idade"] == 30
    assert "obrigatório" in capsys.readouterr().out


def test_rodar_conversa_ponta_a_ponta_com_portal_falso_gera_log(tmp_path, monkeypatch):
    import interfaces.cli as cli_mod

    monkeypatch.setattr(cli_mod, "RAIZ", tmp_path)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(_PRECO)])

    caminho = rodar_conversa(entrada=_respostas("30", "2020", "01310-100", "essencial", ""), portal=portal)

    assert caminho.exists()
    conteudo = caminho.read_text(encoding="utf-8")
    assert "explicar_cotacao" in conteudo
    assert "119,90" in conteudo  # achado #54: formato brasileiro, não mais "119.9" cru
    assert len(portal.chamadas) == 1


def test_rodar_conversa_encaminha_quando_a_quote_esta_indisponivel(tmp_path, monkeypatch):
    import interfaces.cli as cli_mod

    monkeypatch.setattr(cli_mod, "RAIZ", tmp_path)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.indisponivel("upstream respondeu 502")])

    caminho = rodar_conversa(entrada=_respostas("30", "2020", "01310-100", "", ""), portal=portal)

    conteudo = caminho.read_text(encoding="utf-8")
    assert "encaminhar" in conteudo
    assert "quote_indisponivel" in conteudo


def test_rodar_conversa_com_configuracao_desligada_encerra_na_recusa_de_negocio(tmp_path, monkeypatch):
    # bloqueante B4 da auditoria do PR #45: prova de ponta a ponta que a CLI passa `configuracao`
    # adiante para `conduzir_conversa`/`politica.decidir` — não é só um parâmetro que existe, ele
    # muda o desfecho real de "tenho 80 anos..." (a `/quote` recusaria por regra de aceitação).
    import interfaces.cli as cli_mod

    monkeypatch.setattr(cli_mod, "RAIZ", tmp_path)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.recusa_de_negocio("Idade fora das faixas aceitas.")])
    configuracao = ConfiguracaoComercial(encaminhar_lead_fora_do_padrao=False)

    caminho = rodar_conversa(
        entrada=_respostas("80", "2020", "01310-100", "", ""), portal=portal, configuracao=configuracao
    )

    conteudo = caminho.read_text(encoding="utf-8")
    assert "encerrar" in conteudo
    assert "encaminhar" not in conteudo


def test_rodar_conversa_com_configuracao_ligada_encaminha_na_recusa_de_negocio(tmp_path, monkeypatch):
    import interfaces.cli as cli_mod

    monkeypatch.setattr(cli_mod, "RAIZ", tmp_path)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.recusa_de_negocio("Idade fora das faixas aceitas.")])
    configuracao = ConfiguracaoComercial(encaminhar_lead_fora_do_padrao=True)

    caminho = rodar_conversa(
        entrada=_respostas("80", "2020", "01310-100", "", ""), portal=portal, configuracao=configuracao
    )

    conteudo = caminho.read_text(encoding="utf-8")
    assert "encaminhar" in conteudo
    assert "recusa_regra_de_aceitacao" in conteudo


def test_rodar_conversa_sem_configuracao_injetada_carrega_do_arquivo_real(tmp_path, monkeypatch):
    # sem `configuracao` explícita, a CLI carrega de `conhecimento/configuracao_comercial.json`
    # (a mesma que a tela de edição grava) — não fica presa ao padrão em memória.
    import interfaces.cli as cli_mod

    monkeypatch.setattr(cli_mod, "RAIZ", tmp_path)
    caminho_config = tmp_path / "configuracao_comercial.json"
    RepositorioDeConfiguracaoComercialJSON(caminho_config).salvar(
        ConfiguracaoComercial(encaminhar_lead_fora_do_padrao=False)
    )
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.recusa_de_negocio("Idade fora das faixas aceitas.")])

    caminho = rodar_conversa(
        entrada=_respostas("80", "2020", "01310-100", "", ""),
        portal=portal,
        caminho_configuracao_comercial=caminho_config,
    )

    conteudo = caminho.read_text(encoding="utf-8")
    assert "encerrar" in conteudo


def test_coletar_dados_por_texto_livre_aceita_tudo_de_primeira():
    portal = AdaptadorDeLinguagemDeterministico()
    entrada = _respostas("tenho 30 anos, um sandero 2022 e meu cep e 01310-100")

    estado = coletar_dados_por_texto_livre(_Transcricao(), portal, "conv-texto-livre", entrada=entrada)

    assert estado.idade == 30
    assert estado.veiculo_ano == 2022
    assert estado.cep == "01310-100"
    assert not estado.campos_faltantes


def test_coletar_dados_por_texto_livre_pede_de_novo_quando_falta_algo():
    """O determinístico não extrai CEP (isso é `extrair_dados_da_mensagem`, fora do texto livre
    aqui) — então o primeiro turno sempre falta `cep`, forçando um segundo turno."""
    portal = AdaptadorDeLinguagemDeterministico()
    entrada = _respostas("tenho 30 anos e um sandero 2022", "meu cep e 01310-100")

    estado = coletar_dados_por_texto_livre(_Transcricao(), portal, "conv-texto-livre-2", entrada=entrada, max_turnos=3)

    assert estado.idade == 30
    assert estado.veiculo_ano == 2022
    assert estado.cep == "01310-100"
    assert not estado.campos_faltantes


def test_coletar_dados_por_texto_livre_grava_trilha_com_origem_do_portal():
    portal = AdaptadorDeLinguagemDeterministico()
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)
    entrada = _respostas("tenho 30 anos e um sandero 2022", "meu cep e 01310-100")

    coletar_dados_por_texto_livre(
        _Transcricao(), portal, "conv-trilha-texto-livre", trilha=trilha, entrada=entrada, max_turnos=3
    )

    eventos = repositorio.eventos_da_conversa("conv-trilha-texto-livre")
    enviadas = [e for e in eventos if e["evento"] == "mensagem_enviada"]
    assert enviadas, "esperava ao menos uma mensagem_enviada durante a coleta"
    assert all(e["origem_do_texto"] == "extrator_deterministico:v1" for e in enviadas)


def test_coletar_dados_por_texto_livre_trata_eof_sem_traceback():
    """Achado da coordenação (2026-09-12): `entrada()` (via `input()` real) levanta `EOFError`
    quando o stdin fecha antes do lead terminar — a CLI não pode cair com traceback nesse caso."""
    portal = AdaptadorDeLinguagemDeterministico()
    entrada = _respostas_com_eof("tenho 30 anos e um sandero 2022")  # sem CEP, e a fila acaba aqui

    estado = coletar_dados_por_texto_livre(_Transcricao(), portal, "conv-eof", entrada=entrada, max_turnos=6)

    assert estado.idade == 30
    assert estado.veiculo_ano == 2022
    assert "cep" in estado.campos_faltantes  # incompleto, mas devolvido limpo — sem exceção


def test_coletar_dados_por_texto_livre_esgota_max_turnos_sem_travar():
    portal = AdaptadorDeLinguagemDeterministico()
    entrada = _respostas("oi", "qualquer coisa", "sem dado nenhum")

    estado = coletar_dados_por_texto_livre(_Transcricao(), portal, "conv-sem-dado", entrada=entrada, max_turnos=3)

    assert estado.campos_faltantes  # não travou, mas também não inventou dado que não veio


def test_rodar_conversa_com_portal_de_linguagem_usa_coleta_por_texto_livre(tmp_path, monkeypatch):
    """Ponta a ponta com o portal de linguagem: a trilha ganha `origem_do_texto` do adaptador
    (aqui o determinístico, para rodar offline) — o mesmo caminho que, com o OpenRouter, produz
    `origem_do_texto="llm:<modelo>@<versao>"` na trilha real (prova 7 da #9)."""
    import interfaces.cli as cli_mod

    monkeypatch.setattr(cli_mod, "RAIZ", tmp_path)
    portal_cotacao = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(_PRECO)])
    portal_linguagem = AdaptadorDeLinguagemDeterministico()

    caminho = rodar_conversa(
        entrada=_respostas("tenho 30 anos e um sandero 2020", "meu cep e 01310-100"),
        portal=portal_cotacao,
        portal_de_linguagem=portal_linguagem,
    )

    conteudo = caminho.read_text(encoding="utf-8")
    assert "explicar_cotacao" in conteudo
    conversation_id = caminho.stem.removeprefix("execucao_")
    jsonl = (tmp_path / "examples" / f"trilha_{conversation_id}.jsonl").read_text(encoding="utf-8")
    assert "extrator_deterministico:v1" in jsonl


def test_rodar_conversa_grava_a_trilha_estruturada_por_padrao(tmp_path, monkeypatch):
    """Sem passar `trilha=`, a CLI grava sozinha em examples/trilha_<id>.jsonl (RAIZ monkeypatchada
    para tmp_path) e exporta o log estruturado via infra.exportador_trilha — issue #7 costurada."""
    import interfaces.cli as cli_mod

    monkeypatch.setattr(cli_mod, "RAIZ", tmp_path)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(_PRECO)])

    caminho = rodar_conversa(entrada=_respostas("30", "2020", "01310-100", "essencial", ""), portal=portal)

    conversation_id = caminho.stem.removeprefix("execucao_")
    jsonl = tmp_path / "examples" / f"trilha_{conversation_id}.jsonl"
    estruturado = tmp_path / "examples" / f"trilha_{conversation_id}.log"
    assert jsonl.exists() and jsonl.stat().st_size > 0
    assert estruturado.exists()
    assert "mensagem_enviada" in estruturado.read_text(encoding="utf-8")
    assert "01310-100" not in jsonl.read_text(encoding="utf-8"), "CEP em claro no arquivo de trilha"


def test_coletar_dados_com_trilha_grava_dez_eventos_na_ordem_certa():
    """issue #51/#55: a coleta campo a campo hoje não grava nada na trilha — com `trilha=` passado,
    cada um dos 5 campos grava a pergunta (`mensagem_enviada`) ANTES de perguntar e a resposta REAL
    do lead (`mensagem_recebida`) DEPOIS, pela `aplicacao` (nunca `trilha.registrar_evento` direto
    daqui)."""
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)

    dados = coletar_dados(
        _Transcricao(),
        "conv-coleta-trilha",
        entrada=_respostas("30", "2020", "01310-100", "completo", "2026-10-01"),
        trilha=trilha,
    )

    assert dados["idade"] == 30
    eventos = repositorio.eventos_da_conversa("conv-coleta-trilha")
    assert len(eventos) == 10
    assert [e["evento"] for e in eventos] == [
        "mensagem_enviada", "mensagem_recebida",
        "mensagem_enviada", "mensagem_recebida",
        "mensagem_enviada", "mensagem_recebida",
        "mensagem_enviada", "mensagem_recebida",
        "mensagem_enviada", "mensagem_recebida",
    ]
    # o CEP é PII: `ServicoDeTrilha` redige sozinho antes de gravar (mesmo tratamento dos outros
    # eventos) — a resposta REAL (não redigida) é o que `registrar_resposta_de_coleta` recebeu,
    # não necessariamente o que fica no repositório.
    respostas_gravadas = [e["texto"] for e in eventos if e["evento"] == "mensagem_recebida"]
    assert respostas_gravadas == ["30", "2020", "[REDIGIDO]", "completo", "2026-10-01"]
    # a pergunta do CEP casa com o próprio padrão de PII (`00000-000`) e sai redigida pelo
    # ServicoDeTrilha — mesma disciplina de "nada escapa do redator" que vale para qualquer
    # evento da trilha; índice 0 (idade) não tem esse formato, então prova o texto plano.
    perguntas_gravadas = [e["texto"] for e in eventos if e["evento"] == "mensagem_enviada"]
    assert perguntas_gravadas[0] == "Qual a sua idade?"
    assert all(e["origem_do_texto"] == "coleta_deterministica" for e in eventos if e["evento"] == "mensagem_enviada")


def test_coletar_dados_com_trilha_grava_string_vazia_quando_campo_opcional_em_branco():
    """Campo opcional em branco (`resposta is None`) tem que gravar `""` na trilha, nunca `None`
    (o dataclass `MensagemRecebida.texto` espera `str`)."""
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)

    coletar_dados(
        _Transcricao(), "conv-coleta-branco", entrada=_respostas("30", "2020", "01310-100", "", ""), trilha=trilha
    )

    eventos = repositorio.eventos_da_conversa("conv-coleta-branco")
    respostas_gravadas = [e["texto"] for e in eventos if e["evento"] == "mensagem_recebida"]
    assert respostas_gravadas == ["30", "2020", "[REDIGIDO]", "", ""]


def test_transcricao_salvar_nao_redige_o_prompt_mas_redige_a_resposta(tmp_path):
    """O prompt do CEP é texto do sistema (nunca dado do lead) — não pode ser redigido, senão o
    `"00000-000"` do formato viraria `[REDIGIDO]`. A resposta com o CEP real continua redigida."""
    transcricao = _Transcricao()
    transcricao.emitir("Qual o seu CEP? (formato 00000-000)", redigir=False)
    transcricao.emitir("> 01310-100")

    caminho = tmp_path / "transcricao.log"
    transcricao.salvar(caminho)

    conteudo = caminho.read_text(encoding="utf-8")
    linhas = conteudo.splitlines()
    assert linhas[0] == "Qual o seu CEP? (formato 00000-000)"
    assert "[REDIGIDO]" not in linhas[0]
    assert "01310-100" not in linhas[1]
    assert "[REDIGIDO]" in linhas[1]


def test_coletar_dados_ponta_a_ponta_prompt_do_cep_sobrevive_e_resposta_sai_redigida(tmp_path):
    """Achado da auditoria do PR (veredito no #64): o teste acima chama `_Transcricao.emitir`
    direto, com literais — nunca passa por `_perguntar`/`coletar_dados`, então uma mutação que
    também marcasse a RESPOSTA como `redigir=False` dentro de `_perguntar` ficava verde. Este teste
    roda `coletar_dados` de ponta a ponta (o caminho de produção real) com um CEP de verdade na
    entrada simulada e lê o arquivo que `_Transcricao.salvar` escreveria — o mesmo formato do log
    de execução, que é entregável público (`examples/execucao_*.log`)."""
    transcricao = _Transcricao()

    coletar_dados(
        transcricao, "conv-teste-log", entrada=_respostas("30", "2020", "01310-100", "completo", "2026-10-01")
    )

    caminho = tmp_path / "transcricao.log"
    transcricao.salvar(caminho)
    linhas = caminho.read_text(encoding="utf-8").splitlines()

    linha_prompt_cep = next(l for l in linhas if l.startswith("Qual o seu CEP?"))
    linha_resposta_cep = next(l for l in linhas if l.startswith("> ") and ("01310-100" in l or "[REDIGIDO]" in l))
    assert linha_prompt_cep == "Qual o seu CEP? (formato 00000-000)"
    assert "01310-100" not in linha_resposta_cep
    assert linha_resposta_cep == "> [REDIGIDO]"
