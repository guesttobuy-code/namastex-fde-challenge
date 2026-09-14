"""Rotas de `interfaces/rotas_status_conversa.py` (issue #57, P14, PR 2 de 2): os botões "Assumir"
e "Encerrar" da tela de conversas. Arquivo PRÓPRIO — não em `test_servidor.py`, que já estava no
teto de linhas do `file-loc-ceiling` antes mesmo destes testes; reusa os helpers de lá (`_criar_app`,
`_chamar`), dono único do dublê de app WSGI (LEI 11 — duplicar `_criar_app` divergiria no primeiro
ajuste feito só num dos dois lugares)."""
from __future__ import annotations

import json

from tests.interfaces.test_servidor import _chamar, _criar_app


def test_conversa_assumir_a_partir_de_aguardando_corretor_devolve_em_atendimento_humano(tmp_path):
    """Chama `aplicacao.servico_status_conversa.assumir` e regenera o painel. Leva a conversa a
    "Aguardando corretor" de verdade primeiro (via "Quero contratar"), igual o corretor faria
    clicando na tela."""
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir)
    _chamar(app, "POST", "/api/chat/contratar", {"conversation_id": "conv-assume"})

    status, _, corpo = _chamar(app, "POST", "/api/conversa/assumir", {"conversation_id": "conv-assume"})

    assert status == "200 OK"
    assert json.loads(corpo)["status"] == "em_atendimento_humano"


def test_conversa_assumir_fora_de_aguardando_corretor_e_recusado_com_409(tmp_path):
    trilha_dir = tmp_path / "trilha"
    trilha_dir.mkdir()
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    status, _, _ = _chamar(app, "POST", "/api/conversa/assumir", {"conversation_id": "conv-nova"})

    assert status == "409 Conflict"


def test_conversa_encerrar_a_partir_de_aguardando_corretor_devolve_encerrada(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir)
    _chamar(app, "POST", "/api/chat/contratar", {"conversation_id": "conv-encerra", "motivo": "humano"})

    status, _, corpo = _chamar(app, "POST", "/api/conversa/encerrar", {"conversation_id": "conv-encerra"})

    assert status == "200 OK"
    assert json.loads(corpo)["status"] == "encerrada"


def test_conversa_assumir_com_conversation_id_de_path_traversal_e_recusado(tmp_path):
    trilha_dir = tmp_path / "trilha"
    trilha_dir.mkdir()
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    status, _, _ = _chamar(app, "POST", "/api/conversa/assumir", {"conversation_id": "..\\..\\segredo"})

    assert status == "400 Bad Request"


def test_conversa_assumir_com_metodo_errado_e_recusado(tmp_path):
    app = _criar_app(tmp_path=tmp_path)

    status, _, _ = _chamar(app, "GET", "/api/conversa/assumir")

    assert status == "405 Method Not Allowed"
