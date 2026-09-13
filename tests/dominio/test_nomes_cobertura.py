"""Dono único (LEI 11) dos nomes legíveis de cobertura — achado #54: os ids crus vêm da `/quote`/
`/planos` (`quote-service/data/plans.json`) sem acento e em snake_case; este mapa é o único lugar
que traduz id -> nome para o texto que o lead lê."""
import pytest

from dominio.nomes_cobertura import nome_legivel

# Os 7 ids que existem hoje em quote-service/data/plans.json (essencial + completo + premium).
_IDS_DE_PLANS_JSON = {
    "colisao": "colisão",
    "roubo": "roubo",
    "furto": "furto",
    "terceiros": "terceiros",
    "vidros": "vidros",
    "carro_reserva": "carro reserva",
    "assistencia_24h": "assistência 24h",
}


@pytest.mark.parametrize("id_cru,nome_esperado", sorted(_IDS_DE_PLANS_JSON.items()))
def test_os_7_ids_de_plans_json_tem_nome_legivel(id_cru, nome_esperado):
    assert nome_legivel(id_cru) == nome_esperado


def test_id_desconhecido_cai_no_proprio_id_nunca_inventa_nome():
    """LEI 2: dado real ausente se omite, nunca se fabrica — um id que `plans.json` ainda não tem
    aparece como veio, em vez de um nome adivinhado."""
    assert nome_legivel("cobertura_nova_que_ainda_nao_existe") == "cobertura_nova_que_ainda_nao_existe"
