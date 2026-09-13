import pytest

from dominio.preco_cotado import PrecoCotado
from dominio.redator import montar_mensagem


def _preco(**over) -> PrecoCotado:
    base = dict(
        quote_attempt_id="qa-1",
        conversation_id="c1",
        plano_id="essencial",
        plano_nome="Essencial",
        premio_mensal=189.9,
        franquia=1500.0,
        coberturas=("colisao", "roubo_e_furto"),
        moeda="BRL",
    )
    base.update(over)
    return PrecoCotado(**base)


def test_montar_mensagem_recusa_dict_solto():
    with pytest.raises(TypeError, match="PrecoCotado"):
        montar_mensagem({"premio_mensal": 199.9})


def test_montar_mensagem_recusa_string_solta():
    with pytest.raises(TypeError, match="PrecoCotado"):
        montar_mensagem("R$ 199,90")


def test_montar_mensagem_recusa_none():
    with pytest.raises(TypeError, match="PrecoCotado"):
        montar_mensagem(None)


def test_montar_mensagem_traz_o_premio_e_a_franquia_em_formato_brasileiro():
    """Achado #54: o `.2f` cru saía `R$ 189.90` (ponto, sem separador de milhar) — o texto
    oficial que o lead lê precisa de vírgula decimal e ponto de milhar."""
    texto = montar_mensagem(_preco())
    assert "R$ 189,90" in texto
    assert "R$ 1.500,00" in texto


def test_montar_mensagem_traz_valores_com_milhar_no_formato_brasileiro():
    texto = montar_mensagem(_preco(premio_mensal=241.38, franquia=3000.0))
    assert "R$ 241,38" in texto
    assert "R$ 3.000,00" in texto


def test_montar_mensagem_traduz_cobertura_conhecida_e_preserva_a_desconhecida():
    """id sem entrada no mapa (`roubo_e_furto`, fixture) aparece cru — nunca inventa nome (LEI 2)."""
    texto = montar_mensagem(_preco(coberturas=("colisao", "roubo_e_furto")))
    assert "colisão" in texto
    assert "roubo_e_furto" in texto


def test_montar_mensagem_so_traz_carencia_quando_a_cotacao_traz():
    sem = montar_mensagem(_preco(carencia=None))
    assert "carência" not in sem.lower()

    com = montar_mensagem(_preco(carencia={"coberturas": ["roubo_e_furto"], "dias": 30, "observacao": "x"}))
    assert "carência" in com.lower()
    assert "30" in com


def test_montar_mensagem_so_traz_pro_rata_quando_a_cotacao_traz():
    sem = montar_mensagem(_preco(pro_rata=None))
    assert "primeiro pagamento" not in sem.lower()

    com = montar_mensagem(
        _preco(pro_rata={"dias_no_mes": 31, "dias_cobrados": 15, "valor_primeiro_pagamento": 91.9})
    )
    assert "primeiro pagamento" in com.lower()
    assert "R$ 91,90" in com
