import pytest

from dominio.preco_cotado import PrecoCotado

RESPOSTA_VALIDA = {
    "plano_id": "essencial",
    "plano_nome": "Essencial",
    "premio_mensal": 123.45,
    "franquia": 1000.0,
    "coberturas": ["colisao", "roubo_e_furto"],
    "moeda": "BRL",
    "multiplicadores": {"faixa_etaria": 1.0, "idade_veiculo": 1.0, "regiao": 1.0},
    "carencia": {"coberturas": ["roubo_e_furto"], "dias": 30, "observacao": "..."},
}


def test_de_resposta_http_200_monta_preco_com_os_campos_da_cotacao():
    preco = PrecoCotado.de_resposta_http_200("qa-1", "c1", RESPOSTA_VALIDA)
    assert preco.quote_attempt_id == "qa-1"
    assert preco.conversation_id == "c1"
    assert preco.premio_mensal == 123.45
    assert preco.coberturas == ("colisao", "roubo_e_furto")


@pytest.mark.parametrize("campo_ausente", ["plano_id", "plano_nome", "premio_mensal", "franquia", "coberturas", "moeda"])
def test_de_resposta_http_200_exige_campos_da_cotacao(campo_ausente):
    resposta_incompleta = {k: v for k, v in RESPOSTA_VALIDA.items() if k != campo_ausente}
    with pytest.raises(ValueError, match=campo_ausente):
        PrecoCotado.de_resposta_http_200("qa-1", "c1", resposta_incompleta)
