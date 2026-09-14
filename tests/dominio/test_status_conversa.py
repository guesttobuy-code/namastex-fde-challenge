"""`dominio.status_conversa` é o dono único (LEI 11) da tabela `TipoDecisao -> StatusDaConversa` —
`proxima_transicao_automatica` (turno ao vivo) e `status_atual_da_conversa` (reconstrução de
trilhas antigas, condição 1 do veredito do PLANO do PR 2 da issue #57) têm que concordar sempre.
"""

import pytest

from dominio.decisao import Decisao, MotivoHandoff, TipoDecisao
from dominio.status_conversa import (
    StatusDaConversa,
    pode_assumir,
    pode_encerrar,
    proxima_transicao_automatica,
    status_atual_da_conversa,
    transicao_permitida,
)


def _decisao_evento(tipo: str, instante: str = "2026-09-13T10:00:00") -> dict:
    return {"evento": "decisao", "conversation_id": "conv_1", "id": f"dec_{instante}", "instante": instante, "tipo": tipo}


def _status_evento(para: str, instante: str = "2026-09-13T10:00:00") -> dict:
    return {
        "evento": "status_alterado",
        "conversation_id": "conv_1",
        "id": f"st_{instante}",
        "instante": instante,
        "de": None,
        "para": para,
        "origem": "automatico",
    }


@pytest.mark.parametrize(
    ("tipo", "status_esperado"),
    [
        (TipoDecisao.COLETAR_INFORMACAO, StatusDaConversa.COM_O_AGENTE),
        (TipoDecisao.COTAR, StatusDaConversa.COM_O_AGENTE),
        (TipoDecisao.EXPLICAR_COTACAO, StatusDaConversa.COTADA),
        (TipoDecisao.ENCERRAR, StatusDaConversa.ENCERRADA),
    ],
)
def test_proxima_transicao_automatica_mapeia_tipo_de_decisao(tipo, status_esperado):
    decisao = Decisao(tipo=tipo)
    assert proxima_transicao_automatica(decisao, resultado=None) == status_esperado


@pytest.mark.parametrize(
    "motivo",
    [
        MotivoHandoff.QUOTE_INDISPONIVEL,
        MotivoHandoff.QUOTE_TIMEOUT,
        MotivoHandoff.QUOTE_ERRO_DE_PAYLOAD,
        MotivoHandoff.RECUSA_REGRA_DE_ACEITACAO,
        MotivoHandoff.LEAD_QUER_CONTRATAR,
        MotivoHandoff.LEAD_PEDIU_HUMANO,
    ],
)
def test_encaminhar_de_qualquer_motivo_vira_aguardando_corretor(motivo):
    """Condição 3 do veredito: ENCAMINHAR de QUALQUER motivo (inclusive um novo, futuro, da #58) vai
    para AGUARDANDO_CORRETOR pela regra genérica — sem caso especial por `reason_code`."""
    decisao = Decisao(tipo=TipoDecisao.ENCAMINHAR, reason_code=motivo)
    assert proxima_transicao_automatica(decisao, resultado=None) == StatusDaConversa.AGUARDANDO_CORRETOR


def test_transicao_permitida_aceita_qualquer_destino_quando_nao_ha_status_ainda():
    assert transicao_permitida(None, StatusDaConversa.ENCERRADA) is True
    assert transicao_permitida(None, StatusDaConversa.COTADA) is True


def test_transicao_permitida_recusa_sair_de_encerrada():
    assert transicao_permitida(StatusDaConversa.ENCERRADA, StatusDaConversa.COM_O_AGENTE) is False


def test_transicao_permitida_recusa_encerrada_para_cotada():
    """S11 do roteiro de aceite (#57, comentário 5657299328): `encerrada -> cotada` é o exemplo
    citado de transição proibida — este teste fica vermelho se a tabela um dia aceitar."""
    assert transicao_permitida(StatusDaConversa.ENCERRADA, StatusDaConversa.COTADA) is False


def test_pode_assumir_so_a_partir_de_aguardando_corretor():
    assert pode_assumir(StatusDaConversa.AGUARDANDO_CORRETOR) is True
    assert pode_assumir(StatusDaConversa.COM_O_AGENTE) is False
    assert pode_assumir(StatusDaConversa.EM_ATENDIMENTO_HUMANO) is False
    assert pode_assumir(None) is False


def test_pode_encerrar_a_partir_de_aguardando_corretor_ou_em_atendimento_humano():
    assert pode_encerrar(StatusDaConversa.AGUARDANDO_CORRETOR) is True
    assert pode_encerrar(StatusDaConversa.EM_ATENDIMENTO_HUMANO) is True
    assert pode_encerrar(StatusDaConversa.COM_O_AGENTE) is False
    assert pode_encerrar(None) is False


def test_status_atual_usa_o_ultimo_status_alterado_quando_existe():
    eventos = [
        _decisao_evento("coletar_informacao", "10:00"),
        _status_evento("com_o_agente", "10:00"),
        _decisao_evento("explicar_cotacao", "10:05"),
        _status_evento("cotada", "10:05"),
    ]
    assert status_atual_da_conversa(eventos) == StatusDaConversa.COTADA


def test_status_atual_reconstroi_pelo_ultimo_decisao_quando_nao_ha_status_alterado():
    """Condição 1 do veredito — trilha ANTIGA, sem nenhum evento `status_alterado`: reconstrói pela
    MESMA tabela de `proxima_transicao_automatica`, nunca uma segunda regra em `agrupar.py`. Este é
    o teste vermelho-antes do requisito (a trilha aqui deliberadamente NÃO tem `status_alterado`)."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv_1", "id": "m1", "instante": "10:00", "texto": "oi"},
        _decisao_evento("coletar_informacao", "10:00"),
        _decisao_evento("cotar", "10:01"),
        _decisao_evento("encaminhar", "10:02"),
        {
            "evento": "handoff", "conversation_id": "conv_1", "id": "h1", "instante": "10:02",
            "reason_code": "quote_timeout", "contexto_coletado": {}, "mensagem_ao_lead": "",
        },
    ]
    assert status_atual_da_conversa(eventos) == StatusDaConversa.AGUARDANDO_CORRETOR


def test_status_atual_trata_handoff_isolado_como_aguardando_corretor():
    """Fixture/trilha sem o `decisao` que normalmente antecede o `handoff` no mesmo turno (achado
    ao atualizar `tests/conftest.py::construir_trilha_fixture`, conv_b93c) — um `handoff` sozinho
    ainda tem que virar AGUARDANDO_CORRETOR, nunca cair em COM_O_AGENTE por falta de `decisao`."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv_1", "id": "m1", "instante": "10:00", "texto": "oi"},
        {
            "evento": "handoff", "conversation_id": "conv_1", "id": "h1", "instante": "10:01",
            "reason_code": "quote_indisponivel", "contexto_coletado": {}, "mensagem_ao_lead": "",
        },
    ]
    assert status_atual_da_conversa(eventos) == StatusDaConversa.AGUARDANDO_CORRETOR


def test_status_atual_e_none_quando_a_conversa_nao_tem_nenhum_sinal():
    eventos = [{"evento": "mensagem_recebida", "conversation_id": "conv_1", "id": "m1", "instante": "10:00", "texto": "oi"}]
    assert status_atual_da_conversa(eventos) is None
