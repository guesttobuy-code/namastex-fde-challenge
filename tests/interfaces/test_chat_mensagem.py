"""`POST /api/chat/mensagem` (issue #51, parte 2): registro por mensagem do chat guiado — espelha
a divisão de `interfaces.chat_mensagem` (módulo próprio, separado de `interfaces.servidor` para não
empurrar `test_servidor.py`/`servidor.py` perto do teto do `file-loc-ceiling`). Reaproveita os
helpers de `test_servidor.py` (`_chamar`, `_criar_app`, a fixture `app`) em vez de duplicá-los."""
from __future__ import annotations

from dominio.resultado_cotacao import ResultadoDaCotacao
from infra.cliente_quote import FakePortalDeCotacao
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL

from tests.interfaces.test_servidor import _chamar, _criar_app, _estados_em_memoria_isolados, app

__all__ = ["_chamar", "_criar_app", "_estados_em_memoria_isolados", "app"]


def test_chat_mensagem_pergunta_e_resposta_gravam_na_trilha_com_id(tmp_path):
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "conversation_id": "conv-mensagem", "indice": 0, "direcao": "pergunta", "campo": "idade",
        "texto": "Qual sua idade?",
    })
    assert status == "200 OK"
    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "conversation_id": "conv-mensagem", "indice": 0, "direcao": "resposta", "campo": "idade",
        "texto": "35",
    })
    assert status == "200 OK"

    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / "trilha_conv-mensagem.jsonl")
    eventos = repositorio_trilha.eventos_da_conversa("conv-mensagem")
    assert len(eventos) == 2
    enviada, recebida = eventos
    assert enviada["evento"] == "mensagem_enviada"
    assert enviada["id"]
    assert enviada["texto"] == "Qual sua idade?"
    assert recebida["evento"] == "mensagem_recebida"
    assert recebida["id"]
    assert recebida["texto"] == "35"


def test_chat_mensagem_campo_nome_nunca_grava_o_valor_real(tmp_path):
    """A garantia é do SERVIDOR, incondicional ao que o cliente mandou (decidir no cliente é
    frágil: bug no JS, ou alguém chamando a rota direto, gravaria o nome real) — manda o valor
    REAL (não um marcador fabricado pelo cliente) e confere que ele nunca chega na trilha."""
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "conversation_id": "conv-nome-real", "indice": 0, "direcao": "resposta", "campo": "nome",
        "texto": "João da Silva",
    })
    assert status == "200 OK"

    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / "trilha_conv-nome-real.jsonl")
    eventos = repositorio_trilha.eventos_da_conversa("conv-nome-real")
    assert len(eventos) == 1
    assert "João" not in eventos[0]["texto"]


def test_chat_mensagem_campo_whatsapp_nunca_grava_o_valor_real(tmp_path):
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "conversation_id": "conv-whatsapp-real", "indice": 0, "direcao": "resposta", "campo": "whatsapp",
        "texto": "+55 21 97224-2584",
    })
    assert status == "200 OK"

    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / "trilha_conv-whatsapp-real.jsonl")
    eventos = repositorio_trilha.eventos_da_conversa("conv-whatsapp-real")
    assert len(eventos) == 1
    assert "97224" not in eventos[0]["texto"]


def test_chat_mensagem_campo_email_nunca_grava_o_valor_real(tmp_path):
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "conversation_id": "conv-email-real", "indice": 0, "direcao": "resposta", "campo": "email",
        "texto": "ursula@example.com",
    })
    assert status == "200 OK"

    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / "trilha_conv-email-real.jsonl")
    eventos = repositorio_trilha.eventos_da_conversa("conv-email-real")
    assert len(eventos) == 1
    assert "@" not in eventos[0]["texto"]


def test_chat_mensagem_sem_conversation_id_e_400(app):
    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "indice": 0, "direcao": "pergunta", "campo": "idade", "texto": "Qual sua idade?",
    })
    assert status == "400 Bad Request"


def test_chat_mensagem_com_indice_ou_direcao_invalidos_e_400(app):
    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "conversation_id": "conv-invalido", "indice": "zero", "direcao": "pergunta", "campo": "idade", "texto": "x",
    })
    assert status == "400 Bad Request"

    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "conversation_id": "conv-invalido", "indice": 0, "direcao": "outra", "campo": "idade", "texto": "x",
    })
    assert status == "400 Bad Request"


def test_chat_mensagem_campo_desconhecido_e_400(app):
    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "conversation_id": "conv-campo-invalido", "indice": 0, "direcao": "pergunta", "campo": "sobrenome", "texto": "x",
    })
    assert status == "400 Bad Request"


def test_chat_mensagem_os_9_campos_gravam_pergunta_e_resposta_com_id(tmp_path):
    """Roteiro de aceite T1: os 9 passos do fluxo guiado, cada um com `mensagem_enviada` (pergunta)
    e `mensagem_recebida` (resposta), na ordem, cada evento com `id`."""
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)
    conversation_id = "conv-9-campos"
    campos = ["nome", "whatsapp", "email", "idade", "modelo", "ano", "cep", "plano", "inicio"]

    for indice, campo in enumerate(campos):
        for direcao in ("pergunta", "resposta"):
            status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
                "conversation_id": conversation_id, "indice": indice, "direcao": direcao,
                "campo": campo, "texto": f"{direcao} de {campo}",
            })
            assert status == "200 OK", f"falhou em campo={campo} direcao={direcao}"

    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / f"trilha_{conversation_id}.jsonl")
    eventos = repositorio_trilha.eventos_da_conversa(conversation_id)
    assert len(eventos) == 18, f"esperava 9 pares (18 eventos), veio {len(eventos)}"
    for i in range(9):
        enviada, recebida = eventos[2 * i], eventos[2 * i + 1]
        assert enviada["evento"] == "mensagem_enviada" and enviada["id"], campos[i]
        assert recebida["evento"] == "mensagem_recebida" and recebida["id"], campos[i]


def test_chat_mensagem_cep_com_e_sem_hifen_sao_mascarados(tmp_path):
    """Roteiro de aceite T4: achado durante a prova — CEP sem hífen bate em
    `dominio.validacao.cep_valido` mas não em nenhum padrão de `dominio.redator_pii` (issue #68);
    sem `normalizar_cep` em `chat_mensagem.responder_chat_mensagem`, "01310100" chegaria em claro
    na trilha enquanto "01310-100" já saía mascarado — as duas formas têm que sair mascaradas."""
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    for indice, (conversation_id, texto) in enumerate([
        ("conv-cep-sem-hifen", "01310100"),
        ("conv-cep-com-hifen", "01310-100"),
    ]):
        status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
            "conversation_id": conversation_id, "indice": indice, "direcao": "resposta",
            "campo": "cep", "texto": texto,
        })
        assert status == "200 OK"

        repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / f"trilha_{conversation_id}.jsonl")
        eventos = repositorio_trilha.eventos_da_conversa(conversation_id)
        assert len(eventos) == 1
        assert "01310" not in eventos[0]["texto"], f"CEP em claro para {texto!r}: {eventos[0]!r}"


def test_chat_mensagem_e_cotar_gravam_na_ordem_mesmo_com_falha_da_quote(tmp_path):
    """Roteiro de aceite T7: as mensagens da coleta (via `/api/chat/mensagem`) continuam ANTES das
    tentativas de cotação e do encaminhamento (via `/api/chat/cotar`) na trilha, mesmo quando a
    `/quote` falha — as duas rotas escrevem no MESMO arquivo (`trilha_dir / f"trilha_{id}.jsonl"`),
    append-only, então a ordem de chamada já garante a ordem na trilha; este teste prova que a
    integração entre as duas rotas não embaralha nada."""
    trilha_dir = tmp_path / "trilha"
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.indisponivel("upstream indisponível")])
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir, portal_de_cotacao=portal)
    conversation_id = "conv-ordem-t7"

    for indice, campo in enumerate(["idade", "cep"]):
        for direcao in ("pergunta", "resposta"):
            status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
                "conversation_id": conversation_id, "indice": indice, "direcao": direcao,
                "campo": campo, "texto": f"{direcao} de {campo}",
            })
            assert status == "200 OK"

    status, _, _ = _chamar(app, "POST", "/api/chat/cotar", {
        "conversation_id": conversation_id, "idade": 30, "veiculo_ano": 2020, "cep": "01310-100",
    })
    assert status == "200 OK"

    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / f"trilha_{conversation_id}.jsonl")
    eventos = repositorio_trilha.eventos_da_conversa(conversation_id)
    tipos = [e["evento"] for e in eventos]
    indice_do_primeiro_handoff = tipos.index("handoff") if "handoff" in tipos else len(tipos)
    eventos_de_coleta = tipos[:4]
    assert eventos_de_coleta == ["mensagem_enviada", "mensagem_recebida", "mensagem_enviada", "mensagem_recebida"]
    assert all(t not in ("tentativa_de_cotacao", "decisao", "handoff") for t in eventos_de_coleta)
    assert indice_do_primeiro_handoff > 3, f"handoff veio antes da coleta: {tipos}"


def test_chat_mensagem_campo_desconhecido_nao_grava_nada(tmp_path):
    """Roteiro de aceite T5, reforçando a asserção de 'nada gravado' além do 400."""
    trilha_dir = tmp_path / "trilha"
    trilha_dir.mkdir()
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    status, _, _ = _chamar(app, "POST", "/api/chat/mensagem", {
        "conversation_id": "conv-nada-gravado", "indice": 0, "direcao": "pergunta",
        "campo": "sobrenome", "texto": "x",
    })
    assert status == "400 Bad Request"
    assert list(trilha_dir.iterdir()) == []
