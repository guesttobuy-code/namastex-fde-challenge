import pytest

from dominio.validacao import campos_obrigatorios_faltantes, cep_valido, data_iso_valida

_XFAIL = pytest.mark.xfail(strict=True, reason="esqueleto Wave 1 (issue #5, Ajuste 1) — invariante entra no commit 2")


@pytest.mark.parametrize(
    "cep,esperado",
    [
        ("01310-100", True),
        ("01310100", True),
        pytest.param("123", False, marks=_XFAIL),
        pytest.param("abcde-123", False, marks=_XFAIL),
        pytest.param(None, False, marks=_XFAIL),
        pytest.param("", False, marks=_XFAIL),
    ],
)
def test_cep_valido(cep, esperado):
    assert cep_valido(cep) is esperado


@pytest.mark.parametrize(
    "data,esperado",
    [
        ("2026-10-01", True),
        pytest.param("2026-13-40", False, marks=_XFAIL),
        pytest.param("01/10/2026", False, marks=_XFAIL),
        pytest.param(None, False, marks=_XFAIL),
        pytest.param("", False, marks=_XFAIL),
    ],
)
def test_data_iso_valida(data, esperado):
    assert data_iso_valida(data) is esperado


@pytest.mark.xfail(strict=True, reason="esqueleto Wave 1 (issue #5, Ajuste 1) — invariante entra no commit 2")
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
