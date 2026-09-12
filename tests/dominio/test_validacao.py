import pytest

from dominio.validacao import campos_obrigatorios_faltantes, cep_valido, data_iso_valida


@pytest.mark.parametrize(
    "cep,esperado",
    [
        ("01310-100", True),
        ("01310100", True),
        ("123", False),
        ("abcde-123", False),
        (None, False),
        ("", False),
    ],
)
def test_cep_valido(cep, esperado):
    assert cep_valido(cep) is esperado


@pytest.mark.parametrize(
    "data,esperado",
    [
        ("2026-10-01", True),
        ("2026-13-40", False),
        ("01/10/2026", False),
        (None, False),
        ("", False),
    ],
)
def test_data_iso_valida(data, esperado):
    assert data_iso_valida(data) is esperado


def test_campos_obrigatorios_faltantes_aponta_o_que_falta():
    payload = {"idade": 30, "veiculo_ano": 2018}
    assert campos_obrigatorios_faltantes(payload) == frozenset({"cep"})


def test_campos_obrigatorios_faltantes_vazio_quando_nada_falta():
    payload = {"idade": 30, "veiculo_ano": 2018, "cep": "01310-100"}
    assert campos_obrigatorios_faltantes(payload) == frozenset()


def test_campos_obrigatorios_faltantes_nao_exige_plano_id():
    # plano_id é opcional: a /quote assume "essencial" quando ausente (quote_logic.py:64).
    payload = {"idade": 30, "veiculo_ano": 2018, "cep": "01310-100"}
    assert "plano_id" not in campos_obrigatorios_faltantes(payload)
