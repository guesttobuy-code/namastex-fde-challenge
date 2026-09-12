"""CLI (issue #6, F5/#8 absorvida): coleta -> cota -> decide -> responde ou encaminha. Usa
`FakePortalDeCotacao` -- nunca a rede de verdade (a prova contra o quote-service real é manual,
colada no corpo do PR, não faz parte da suíte automática)."""
from __future__ import annotations

from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao
from infra.adaptador_de_linguagem import AdaptadorDeLinguagemDeterministico
from infra.cliente_quote import FakePortalDeCotacao
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
    dados = coletar_dados(_Transcricao(), entrada=_respostas("30", "2020", "01310-100", "completo", "2026-10-01"))

    assert dados == {
        "idade": 30,
        "veiculo_ano": 2020,
        "cep": "01310-100",
        "plano_id": "completo",
        "data_inicio": "2026-10-01",
    }
    capsys.readouterr()  # silencia a saída da coleta neste teste


def test_coletar_dados_campos_opcionais_em_branco():
    dados = coletar_dados(_Transcricao(), entrada=_respostas("30", "2020", "01310-100", "", ""))

    assert dados["plano_id"] is None
    assert dados["data_inicio"] is None


def test_coletar_dados_reprompta_cep_invalido(capsys):
    dados = coletar_dados(_Transcricao(), entrada=_respostas("30", "2020", "abc", "01310-100", "", ""))

    assert dados["cep"] == "01310-100"
    assert "inválido" in capsys.readouterr().out


def test_coletar_dados_reprompta_campo_obrigatorio_em_branco(capsys):
    dados = coletar_dados(_Transcricao(), entrada=_respostas("", "30", "2020", "01310-100", "", ""))

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
    assert "119.9" in conteudo
    assert len(portal.chamadas) == 1


def test_rodar_conversa_encaminha_quando_a_quote_esta_indisponivel(tmp_path, monkeypatch):
    import interfaces.cli as cli_mod

    monkeypatch.setattr(cli_mod, "RAIZ", tmp_path)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.indisponivel("upstream respondeu 502")])

    caminho = rodar_conversa(entrada=_respostas("30", "2020", "01310-100", "", ""), portal=portal)

    conteudo = caminho.read_text(encoding="utf-8")
    assert "encaminhar" in conteudo
    assert "quote_indisponivel" in conteudo


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
