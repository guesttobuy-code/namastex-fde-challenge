"""Rotas de `interfaces/rotas_planos_indisponivel.py` (issue #95): `POST /api/chat/planos-indisponivel`
— chamada pelo chat quando `GET /api/planos` falha tentativas suficientes. Arquivo PRÓPRIO — não em
`test_servidor.py` (perto do teto do `file-loc-ceiling`); reusa `_criar_app`/`_chamar` de lá (dono
único do dublê de app WSGI, LEI 11 — mesmo padrão de `test_rotas_status_conversa.py`)."""
from __future__ import annotations

import json

import pytest

from infra.trilha_jsonl import RepositorioDeTrilhaJSONL
from tests.interfaces.test_servidor import _chamar, _criar_app


class _PortalQueReprovaSeChamado:
    """Prova estrutural da condição do PLANO (issue #95): a rota NUNCA pode chamar `portal.cotar()`
    — com a `/quote` de pé mas só `/api/planos` fora do ar, cotar de verdade escolheria "essencial"
    no lugar do lead. Em vez de um dublê que devolve sucesso/falha, este reprova o TESTE (não só a
    chamada) se `.cotar()` for invocado — a garantia fica auto-verificável, não depende de alguém
    lembrar de conferir "e cadê a chamada à `/quote`?" depois."""

    def cotar(self, payload, conversation_id, on_tentativa=None):
        pytest.fail("encaminhar_planos_indisponiveis não pode chamar portal.cotar()")


def test_planos_indisponivel_encaminha_e_grava_handoff_sem_chamar_o_portal(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(
        tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir,
        portal_de_cotacao=_PortalQueReprovaSeChamado(),
    )

    status, _, corpo = _chamar(app, "POST", "/api/chat/planos-indisponivel", {
        "conversation_id": "conv-planos-http", "idade": 35, "veiculo_ano": 2020, "cep": "01310-100",
    })

    assert status == "200 OK"
    resposta = json.loads(corpo)
    assert resposta["decisao"]["tipo"] == "encaminhar"
    assert resposta["decisao"]["reason_code"] == "quote_indisponivel"

    eventos = RepositorioDeTrilhaJSONL(trilha_dir / "trilha_conv-planos-http.jsonl").eventos_da_conversa(
        "conv-planos-http"
    )
    (handoff,) = [e for e in eventos if e["evento"] == "handoff"]
    assert handoff["reason_code"] == "quote_indisponivel"
    assert "tentativa_de_cotacao" not in [e["evento"] for e in eventos]


def test_planos_indisponivel_e_idempotente_pela_rota_http(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(
        tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir,
        portal_de_cotacao=_PortalQueReprovaSeChamado(),
    )
    corpo_da_chamada = {"conversation_id": "conv-planos-2x-http", "idade": 35, "veiculo_ano": 2020, "cep": "01310-100"}

    _chamar(app, "POST", "/api/chat/planos-indisponivel", corpo_da_chamada)
    eventos_apos_primeira = RepositorioDeTrilhaJSONL(
        trilha_dir / "trilha_conv-planos-2x-http.jsonl"
    ).eventos_da_conversa("conv-planos-2x-http")
    status, _, corpo = _chamar(app, "POST", "/api/chat/planos-indisponivel", corpo_da_chamada)
    eventos_apos_segunda = RepositorioDeTrilhaJSONL(
        trilha_dir / "trilha_conv-planos-2x-http.jsonl"
    ).eventos_da_conversa("conv-planos-2x-http")

    assert status == "200 OK"
    assert len(eventos_apos_segunda) == len(eventos_apos_primeira), "a 2a chamada gravou evento(s) novo(s)"


def test_planos_indisponivel_com_metodo_errado_e_recusado(tmp_path):
    app = _criar_app(tmp_path=tmp_path)

    status, _, _ = _chamar(app, "GET", "/api/chat/planos-indisponivel")

    assert status == "405 Method Not Allowed"


def test_planos_indisponivel_sem_conversation_id_e_400(tmp_path):
    app = _criar_app(tmp_path=tmp_path)

    status, _, _ = _chamar(app, "POST", "/api/chat/planos-indisponivel", {"idade": 35})

    assert status == "400 Bad Request"


def test_planos_indisponivel_com_conversation_id_de_path_traversal_e_recusado(tmp_path):
    app = _criar_app(tmp_path=tmp_path)

    status, _, _ = _chamar(app, "POST", "/api/chat/planos-indisponivel", {
        "conversation_id": "..\\..\\segredo", "idade": 35, "veiculo_ano": 2020, "cep": "01310-100",
    })

    assert status == "400 Bad Request"


def test_planos_indisponivel_com_cep_fora_do_formato_e_recusado_com_400(tmp_path):
    app = _criar_app(tmp_path=tmp_path)

    status, _, _ = _chamar(app, "POST", "/api/chat/planos-indisponivel", {
        "conversation_id": "conv-cep-ruim", "idade": 35, "veiculo_ano": 2020, "cep": "abc",
    })

    assert status == "400 Bad Request"


def test_planos_indisponivel_sem_dados_minimos_e_recusado_com_400_sem_gravar_nada(tmp_path):
    """"Conversa sem estado" (condição da coordenação, #95): sem idade/veiculo_ano/cep não dá pra
    nem montar o `contexto_coletado` do `handoff` — `_ESTADOS_EM_MEMORIA` também nunca teria nada
    aqui (só `/api/chat/cotar` o preenche, e o lead nunca chega lá quando `/api/planos` falha
    antes — exatamente o caso que esta rota cobre), por isso o mínimo vem sempre do corpo."""
    trilha_dir = tmp_path / "trilha"
    trilha_dir.mkdir()
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    status, _, corpo = _chamar(app, "POST", "/api/chat/planos-indisponivel", {"conversation_id": "conv-sem-dados"})

    assert status == "400 Bad Request"
    assert "campos_faltantes" in json.loads(corpo)
    assert list(trilha_dir.iterdir()) == []
