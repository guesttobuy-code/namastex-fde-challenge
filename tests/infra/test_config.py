"""Dono único da URL do quote-service (achado da coordenação, issue #13): antes do merge do #35,
`interfaces/cli.py` e `infra/planos_http.py` liam `QUOTE_SERVICE_URL` cada um do seu jeito."""

from infra.config import url_quote_service


def test_sem_variavel_de_ambiente_usa_o_mesmo_default_que_a_cli_sempre_usou(monkeypatch):
    monkeypatch.delenv("QUOTE_SERVICE_URL", raising=False)
    assert url_quote_service() == "http://localhost:8000"


def test_com_variavel_de_ambiente_le_o_valor_configurado(monkeypatch):
    monkeypatch.setenv("QUOTE_SERVICE_URL", "http://quote-service-de-outra-rede:9000")
    assert url_quote_service() == "http://quote-service-de-outra-rede:9000"
