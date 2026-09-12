"""Testes do cliente `/quote` (issue #6): motor de retry/orçamento + tradução para o domínio.

Os corpos de resposta simulados abaixo foram medidos ao vivo contra o `quote-service` real
(`docker compose up`, porta 8000), não inventados:
    502 -> {"error": "upstream_unavailable", "message": "..."}
    422 recusa de negócio -> {"error": "cotacao_recusada", "motivo": "..."}
    422 validação Pydantic -> {"detail": [{"type": ..., "loc": [...], "msg": ..., "input": ...}]}
    400 payload inválido -> {"error": "payload_invalido", "detalhe": "..."}

Nenhum destes testes espera tempo de parede real: `RelogioFake` avança quando o cliente chamaria
`time.sleep`, e `FakeTransporteQuote` avança o mesmo relógio para simular uma chamada lenta sendo
cortada no timeout — a suíte inteira roda em milissegundos.
"""
from __future__ import annotations

import pytest

from dominio.resultado_cotacao import StatusCotacao
from infra.cliente_quote import (
    ClienteQuoteHTTP,
    FakePortalDeCotacao,
    FakeTransporteQuote,
    RelogioFake,
    RespostaBruta,
)

PAYLOAD = {"plano_id": "completo", "idade": 30, "veiculo_ano": 2020, "cep": "01310-100"}
CONVERSATION_ID = "conv-123"

_RESPOSTA_502 = RespostaBruta(
    status_code=502,
    corpo={"error": "upstream_unavailable", "message": "Servico de cotacao temporariamente indisponivel. Tente novamente."},
)
_RESPOSTA_200 = RespostaBruta(
    status_code=200,
    corpo={
        "plano_id": "completo",
        "plano_nome": "Completo",
        "premio_mensal": 245.67,
        "franquia": 3000.0,
        "coberturas": ["colisao", "roubo", "furto", "terceiros", "vidros"],
        "moeda": "BRL",
    },
)
_RESPOSTA_422_RECUSA_DE_NEGOCIO = RespostaBruta(
    status_code=422,
    corpo={"error": "cotacao_recusada", "motivo": "Plano 'inexistente' inexistente. Opcoes: essencial, completo, premium"},
)
_RESPOSTA_422_ERRO_DE_PAYLOAD = RespostaBruta(
    status_code=422,
    corpo={"detail": [{"type": "less_than_equal", "loc": ["body", "idade"], "msg": "Input should be less than or equal to 200", "input": 999}]},
)
_RESPOSTA_400_PAYLOAD_INVALIDO = RespostaBruta(
    status_code=400,
    corpo={"error": "payload_invalido", "detalhe": "Invalid isoformat string: '31/12/2026'"},
)


def _cliente(transporte: FakeTransporteQuote, relogio: RelogioFake) -> ClienteQuoteHTTP:
    return ClienteQuoteHTTP("http://quote-service.invalido", transporte=transporte, relogio=relogio, dormir=relogio.avancar)


# ---------------------------------------------------------------------------
# Motor de retry/orçamento (executar_com_orcamento) — sem tradução para o domínio.
# ---------------------------------------------------------------------------


def test_200_feliz_retorna_na_primeira_tentativa_sem_retry():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 1
    assert relogio.agora == pytest.approx(0.0)


def test_5xx_repete_dentro_do_orcamento_e_desiste_no_fim_dele():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 502
    assert transporte.numero_de_chamadas == 3
    # 3 tentativas -> 2 esperas entre elas (0,4s e 0,8s); nenhuma tentativa aqui é lenta.
    assert relogio.agora == pytest.approx(1.2)


def test_5xx_uma_vez_depois_recupera_com_200():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_200], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 2
    assert relogio.agora == pytest.approx(0.4)


def test_200_lento_mas_dentro_do_timeout_da_tentativa_nao_repete():
    """Servidor demora 2s (< 3s do timeout por tentativa): a resposta chega, sem retry."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio, demoras_segundos=[2.0])
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 1
    assert relogio.agora == pytest.approx(2.0)


def test_200_lento_alem_do_orcamento_respeita_o_deadline_de_10s_em_vez_de_esperar_para_sempre():
    """Servidor sempre demora 8s (o pior caso real do quote-service): sem orçamento, seriam 24s
    de espera em 3 tentativas. Com o orçamento de 10s, o cliente desiste em exatamente 10s —
    nunca espera os 8s inteiros de uma tentativa que já não cabe."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio, demoras_segundos=[8.0, 8.0, 8.0])
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.excedeu_o_tempo is True
    assert transporte.numero_de_chamadas == 3
    # tentativa 1: timeout 3s (gasto 3, sobra 7) + espera 0,4s = 3,4
    # tentativa 2: timeout 3s (gasto 3, sobra 3,6) + espera 0,8s = 7,2
    # tentativa 3: timeout min(3, 2,8)=2,8s (gasto 2,8) = 10,0 -> orçamento esgotado, para
    assert relogio.agora == pytest.approx(10.0)
    assert transporte.chamadas == pytest.approx([3.0, 3.0, 2.8])


@pytest.mark.parametrize(
    "resposta_terminal",
    [_RESPOSTA_422_RECUSA_DE_NEGOCIO, _RESPOSTA_422_ERRO_DE_PAYLOAD, _RESPOSTA_400_PAYLOAD_INVALIDO],
    ids=["422-recusa-de-negocio", "422-erro-de-payload-pydantic", "400-payload-invalido"],
)
def test_422_e_400_sao_terminais_e_nunca_repetem(resposta_terminal):
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[resposta_terminal], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado is resposta_terminal
    assert transporte.numero_de_chamadas == 1
    assert relogio.agora == pytest.approx(0.0)


def test_quote_attempt_id_e_diferente_a_cada_tentativa():
    """Correlação entre tentativas, não idempotência (issue #6): cada tentativa (inclusive as que
    não vencem) tem o seu próprio id."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_502, _RESPOSTA_200], relogio=relogio)
    cliente = _cliente(transporte, relogio)

    ids_vistos = set()
    for _ in range(3):
        quote_attempt_id, _resultado = cliente.executar_com_orcamento(PAYLOAD)
        ids_vistos.add(quote_attempt_id)
    # 3 chamadas a executar_com_orcamento (não 3 tentativas de uma só) -> ainda assim, 3 ids distintos.
    assert len(ids_vistos) == 3


# ---------------------------------------------------------------------------
# Tradução para o domínio (cotar) — dominio.ResultadoDaCotacao / PrecoCotado.
# ---------------------------------------------------------------------------


def test_cotar_200_vira_preco_cotado_com_o_quote_attempt_id_da_tentativa_vencedora():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_200], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.SUCESSO
    assert resultado.preco is not None
    assert resultado.preco.conversation_id == CONVERSATION_ID
    assert resultado.preco.premio_mensal == 245.67
    assert resultado.preco.quote_attempt_id  # não vazio


def test_cotar_resposta_sem_campo_obrigatorio_nao_vira_preco_cotado():
    """I-1 do domínio (CONTRACT.md de src/dominio/): PrecoCotado só nasce de resposta completa."""
    relogio = RelogioFake()
    resposta_incompleta = RespostaBruta(status_code=200, corpo={"plano_id": "completo"})  # falta premio_mensal etc.
    transporte = FakeTransporteQuote(roteiro=[resposta_incompleta], relogio=relogio)

    with pytest.raises(ValueError, match="cotação bem-sucedida"):
        _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)


def test_cotar_422_recusa_de_negocio_vira_status_recusa_de_negocio():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_422_RECUSA_DE_NEGOCIO], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.RECUSA_DE_NEGOCIO
    assert resultado.motivo == "Plano 'inexistente' inexistente. Opcoes: essencial, completo, premium"
    assert resultado.preco is None


def test_cotar_422_erro_de_validacao_pydantic_vira_status_erro_de_payload_com_motivo_legivel():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_422_ERRO_DE_PAYLOAD], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.ERRO_DE_PAYLOAD
    assert "idade" in resultado.motivo
    assert "less than or equal to 200" in resultado.motivo


def test_cotar_400_payload_invalido_vira_status_erro_de_payload():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_400_PAYLOAD_INVALIDO], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.ERRO_DE_PAYLOAD
    assert resultado.motivo == "Invalid isoformat string: '31/12/2026'"


def test_cotar_5xx_esgotado_vira_status_indisponivel():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.INDISPONIVEL
    assert "502" in resultado.motivo


def test_cotar_timeout_esgotado_vira_status_timeout():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio, demoras_segundos=[8.0, 8.0, 8.0])
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.TIMEOUT


# ---------------------------------------------------------------------------
# FakePortalDeCotacao — dublê da PORTA (para quem consome `cotar()`, não o transporte).
# ---------------------------------------------------------------------------


def test_fake_portal_de_cotacao_devolve_o_roteiro_programado_em_ordem():
    from dominio.resultado_cotacao import ResultadoDaCotacao

    sucesso = ResultadoDaCotacao.indisponivel("upstream fora do ar (roteiro de teste)")
    fake = FakePortalDeCotacao(roteiro=[sucesso])

    assert fake.cotar(PAYLOAD, CONVERSATION_ID) is sucesso
    assert fake.cotar(PAYLOAD, CONVERSATION_ID) is sucesso  # roteiro de 1 item repete
    assert len(fake.chamadas) == 2
    assert fake.chamadas[0] == {"payload": PAYLOAD, "conversation_id": CONVERSATION_ID}


# ---------------------------------------------------------------------------
# on_tentativa -- observação POR TENTATIVA (issue #7/#6, ESPECIFICACAO.md §1: "cada chamada, não
# cada cotação"), o ponto de injeção para quem grava TentativaDeCotacao na trilha.
# ---------------------------------------------------------------------------


def test_on_tentativa_e_chamado_uma_vez_por_tentativa_http_com_numeracao_1_based():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_200], relogio=relogio)
    observadas = []

    _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID, on_tentativa=observadas.append)

    assert [o.numero_da_tentativa for o in observadas] == [1, 2]
    assert [o.classificacao for o in observadas] == ["indisponivel", "sucesso"]
    assert all(o.quote_attempt_id for o in observadas)
    assert len({o.quote_attempt_id for o in observadas}) == 2  # um id por tentativa, não reusado


def test_on_tentativa_orcamento_restante_diminui_a_cada_tentativa():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_502, _RESPOSTA_502], relogio=relogio)
    observadas = []

    _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD, on_tentativa=observadas.append)

    restantes = [o.orcamento_restante_ms for o in observadas]
    assert restantes == sorted(restantes, reverse=True)
    assert restantes[0] == 10_000  # nada de latência simulada nas tentativas em si (demora=0)
    assert restantes[-1] == pytest.approx(8_800, abs=1)  # 10s - 0,4s - 0,8s (as duas esperas já tomadas)


def test_on_tentativa_nao_e_chamado_quando_omitido():
    """Regressão trivial: on_tentativa é opcional, o motor não quebra sem ele (é o que o
    FakePortalDeCotacao e todo teste anterior a este já exercitam, mas fica explícito aqui)."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio)

    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.SUCESSO
