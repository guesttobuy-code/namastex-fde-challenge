"""Testes da política de retry do cliente `/quote` (issue #6) — motor de orçamento, sem
tradução para o domínio (essa parte chega em commit próprio, depois do rebase sobre a F2/#5).

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

from infra.cliente_quote import (
    ClienteQuoteHTTP,
    FakeTransporteQuote,
    RelogioFake,
    RespostaBruta,
)

PAYLOAD = {"plano_id": "completo", "idade": 30, "veiculo_ano": 2020, "cep": "01310-100"}

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


def test_200_feliz_retorna_na_primeira_tentativa_sem_retry():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio)
    resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 1
    assert relogio.agora == pytest.approx(0.0)


def test_5xx_repete_dentro_do_orcamento_e_desiste_no_fim_dele():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502], relogio=relogio)
    resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 502
    assert transporte.numero_de_chamadas == 3
    # 3 tentativas -> 2 esperas entre elas (0,4s e 0,8s); nenhuma tentativa aqui é lenta.
    assert relogio.agora == pytest.approx(1.2)


def test_5xx_uma_vez_depois_recupera_com_200():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_200], relogio=relogio)
    resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 2
    assert relogio.agora == pytest.approx(0.4)


def test_200_lento_mas_dentro_do_timeout_da_tentativa_nao_repete():
    """Servidor demora 2s (< 3s do timeout por tentativa): a resposta chega, sem retry."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio, demoras_segundos=[2.0])
    resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 1
    assert relogio.agora == pytest.approx(2.0)


def test_200_lento_alem_do_orcamento_respeita_o_deadline_de_10s_em_vez_de_esperar_para_sempre():
    """Servidor sempre demora 8s (o pior caso real do quote-service): sem orçamento, seriam 24s
    de espera em 3 tentativas. Com o orçamento de 10s, o cliente desiste em exatamente 10s —
    nunca espera os 8s inteiros de uma tentativa que já não cabe."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio, demoras_segundos=[8.0, 8.0, 8.0])
    resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

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
    resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado is resposta_terminal
    assert transporte.numero_de_chamadas == 1
    assert relogio.agora == pytest.approx(0.0)


def test_as_duas_formas_de_corpo_do_422_sao_distinguiveis_por_quem_traduzir_depois():
    """RECUSA_DE_NEGOCIO carrega `motivo` direto no corpo; ERRO_DE_PAYLOAD (validação Pydantic
    automática) carrega `detail`, uma lista. A tradução para StatusCotacao mora no commit que
    entra depois do rebase sobre a F2/#5 — este teste só fixa o contrato de shape que ela lê."""
    assert "motivo" in _RESPOSTA_422_RECUSA_DE_NEGOCIO.corpo
    assert "detail" in _RESPOSTA_422_ERRO_DE_PAYLOAD.corpo
    assert "motivo" not in _RESPOSTA_422_ERRO_DE_PAYLOAD.corpo
