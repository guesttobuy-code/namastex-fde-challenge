"""CLI (issue #6, F5/#8 absorvida): coleta -> cota -> decide -> responde ou encaminha. Usa
`FakePortalDeCotacao` -- nunca a rede de verdade (a prova contra o quote-service real é manual,
colada no corpo do PR, não faz parte da suíte automática)."""
from __future__ import annotations

from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao
from infra.cliente_quote import FakePortalDeCotacao
from interfaces.cli import _Transcricao, coletar_dados, rodar_conversa

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
