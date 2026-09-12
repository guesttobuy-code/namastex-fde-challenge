import pytest

from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao, StatusCotacao


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


def test_sucesso_carrega_preco_e_nao_carrega_motivo():
    r = ResultadoDaCotacao.sucesso(_preco())
    assert r.status == StatusCotacao.SUCESSO
    assert r.preco is not None
    assert r.motivo is None


def test_falha_carrega_motivo_e_nao_carrega_preco():
    r = ResultadoDaCotacao.indisponivel("upstream_unavailable")
    assert r.status == StatusCotacao.INDISPONIVEL
    assert r.motivo == "upstream_unavailable"
    assert r.preco is None


def test_construcao_direta_recusa_preco_e_motivo_juntos():
    with pytest.raises(ValueError, match="preco"):
        ResultadoDaCotacao(status=StatusCotacao.SUCESSO, preco=_preco(), motivo="nao devia vir junto")


def test_sucesso_sem_preco_e_recusado():
    with pytest.raises(ValueError, match="preco"):
        ResultadoDaCotacao(status=StatusCotacao.SUCESSO, preco=None)


def test_falha_sem_motivo_e_recusada():
    with pytest.raises(ValueError, match="motivo"):
        ResultadoDaCotacao(status=StatusCotacao.INDISPONIVEL, motivo=None)
