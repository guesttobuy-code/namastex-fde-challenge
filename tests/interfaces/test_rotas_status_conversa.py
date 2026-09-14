"""Rotas de `interfaces/rotas_status_conversa.py` (issue #57, P14, PR 2 de 2): os botões "Assumir"
e "Encerrar" da tela de conversas. Arquivo PRÓPRIO — não em `test_servidor.py`, que já estava no
teto de linhas do `file-loc-ceiling` antes mesmo destes testes; reusa os helpers de lá (`_criar_app`,
`_chamar`), dono único do dublê de app WSGI (LEI 11 — duplicar `_criar_app` divergiria no primeiro
ajuste feito só num dos dois lugares)."""
from __future__ import annotations

import json

from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao
from infra.cliente_quote import FakePortalDeCotacao
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL
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


# ── B1, achado da pré-auditoria do PR #87: a tabela de transições precisa valer no caminho HTTP
# real, não só no domínio isolado — sem isso, "Encerrar" seguido de um turno automático (o lead
# tocando "Ver outro plano" na mesma conversa) reabria o status pra "cotada".


def test_conversa_encerrada_nao_reabre_com_um_turno_de_cotar_seguinte(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(PrecoCotado(
        quote_attempt_id="qa_1", conversation_id="conv-reabre", plano_id="completo",
        plano_nome="Completo", premio_mensal=272.87, franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"), moeda="BRL",
    ))])
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir, portal_de_cotacao=portal)
    dados_completos = {
        "conversation_id": "conv-reabre", "idade": 35, "veiculo_ano": 2019,
        "cep": "01310-100", "plano_id": "completo", "data_inicio": "2026-10-01",
    }
    _chamar(app, "POST", "/api/chat/cotar", dados_completos)
    _chamar(app, "POST", "/api/chat/contratar", {"conversation_id": "conv-reabre"})
    _chamar(app, "POST", "/api/conversa/assumir", {"conversation_id": "conv-reabre"})
    _chamar(app, "POST", "/api/conversa/encerrar", {"conversation_id": "conv-reabre"})

    status, _, _ = _chamar(app, "POST", "/api/chat/cotar", dados_completos)

    assert status == "200 OK"
    eventos = RepositorioDeTrilhaJSONL(trilha_dir / "trilha_conv-reabre.jsonl").eventos_da_conversa("conv-reabre")
    mudancas = [e for e in eventos if e["evento"] == "status_alterado"]
    assert mudancas[-1]["para"] == "encerrada", "o turno de cotar depois de Encerrar não pode reabrir o status"
    assert mudancas[-1]["origem"] == "manual", "nenhum status_alterado NOVO deveria ter sido gravado pelo turno de cotar"


def test_dois_turnos_de_coleta_seguidos_gravam_um_unico_status_alterado(tmp_path):
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)
    dados_incompletos = {"conversation_id": "conv-coleta", "idade": 30}

    _chamar(app, "POST", "/api/chat/cotar", dados_incompletos)
    _chamar(app, "POST", "/api/chat/cotar", dados_incompletos)

    eventos = RepositorioDeTrilhaJSONL(trilha_dir / "trilha_conv-coleta.jsonl").eventos_da_conversa("conv-coleta")
    mudancas = [e for e in eventos if e["evento"] == "status_alterado"]
    assert len(mudancas) == 1, "dois turnos no MESMO status (com_o_agente) não podem virar 2 eventos"
    assert mudancas[0]["para"] == "com_o_agente"


# ── S4 do roteiro de aceite: motivo="humano"/"contratar" no /api/chat/contratar (migrados de
# test_servidor.py, que bateu no teto do file-loc-ceiling depois do merge com a main).


def test_chat_contratar_com_motivo_humano_grava_lead_pediu_humano_nao_lead_quer_contratar(tmp_path):
    """"Falar com um corretor" (`motivo="humano"`) tem que gravar um `MotivoHandoff` PRÓPRIO
    (`lead_pediu_humano`, #63), distinto de "Quero contratar" (`motivo="contratar"`) — antes desta
    frente os dois caíam no mesmo motivo por falta do campo `motivo` no corpo do POST."""
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir)

    status, _, corpo = _chamar(
        app, "POST", "/api/chat/contratar", {"conversation_id": "conv-humano", "motivo": "humano"}
    )

    assert status == "200 OK"
    resposta = json.loads(corpo)
    assert resposta["decisao"]["tipo"] == "encaminhar"
    assert resposta["decisao"]["reason_code"] == "lead_pediu_humano"

    eventos = RepositorioDeTrilhaJSONL(trilha_dir / "trilha_conv-humano.jsonl").eventos_da_conversa("conv-humano")
    (handoff,) = [e for e in eventos if e["evento"] == "handoff"]
    assert handoff["reason_code"] == "lead_pediu_humano"


def test_chat_contratar_com_motivo_invalido_e_recusado_com_400(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    trilha_dir.mkdir()
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir)

    status, _, corpo = _chamar(
        app, "POST", "/api/chat/contratar", {"conversation_id": "conv-x", "motivo": "outra-coisa"}
    )

    assert status == "400 Bad Request"
    assert "motivo" in json.loads(corpo)["erro"]
    assert list(trilha_dir.iterdir()) == []
