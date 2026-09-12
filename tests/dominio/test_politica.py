import pytest

from dominio.decisao import Decisao, MotivoHandoff, TipoDecisao
from dominio.estado_conversa import EstadoDaConversa
from dominio.politica import decidir
from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao


def _estado(**over):
    base = {"conversation_id": "c1", "campos_faltantes": frozenset()}
    base.update(over)
    return EstadoDaConversa(**base)


def _preco() -> PrecoCotado:
    return PrecoCotado(
        quote_attempt_id="qa-1",
        conversation_id="c1",
        plano_id="essencial",
        plano_nome="Essencial",
        premio_mensal=100.0,
        franquia=1000.0,
        coberturas=("colisao",),
        moeda="BRL",
    )


_XFAIL = pytest.mark.xfail(strict=True, reason="esqueleto Wave 1 (issue #5, Ajuste 1) — tabela real entra no commit 2")

CASOS = [
    pytest.param(_estado(campos_faltantes=frozenset({"cep"})), None, Decisao(TipoDecisao.COLETAR_INFORMACAO), id="falta_cep", marks=_XFAIL),
    pytest.param(_estado(), None, Decisao(TipoDecisao.COTAR), id="pronto_para_cotar"),
    pytest.param(_estado(), ResultadoDaCotacao.sucesso(_preco()), Decisao(TipoDecisao.EXPLICAR_COTACAO), id="sucesso", marks=_XFAIL),
    pytest.param(_estado(), ResultadoDaCotacao.recusa_de_negocio("idade fora da faixa"), Decisao(TipoDecisao.ENCERRAR), id="recusa_de_negocio", marks=_XFAIL),
    pytest.param(
        _estado(), ResultadoDaCotacao.indisponivel("upstream_unavailable"),
        Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_INDISPONIVEL), id="indisponivel", marks=_XFAIL,
    ),
    pytest.param(
        _estado(), ResultadoDaCotacao.timeout("upstream_timeout"),
        Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_TIMEOUT), id="timeout", marks=_XFAIL,
    ),
    pytest.param(
        _estado(), ResultadoDaCotacao.erro_de_payload("payload_invalido"),
        Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_ERRO_DE_PAYLOAD), id="erro_de_payload", marks=_XFAIL,
    ),
]


@pytest.mark.parametrize("estado,resultado,esperado", CASOS)
def test_tabela_de_decisao(estado, resultado, esperado):
    assert decidir(estado, resultado) == esperado
