"""Nenhum teste aqui abre socket real (achado da coordenação, 2026-09-12): teste que depende do
serviço estar de pé vira flakiness alheia ao código e, dentro do pre-commit — que roda ao lado de
outras frentes na mesma máquina —, virou travamento medido. Tudo mockado; a chamada real só existe
na geração de verdade.
"""

from __future__ import annotations

import json
import urllib.error
from unittest.mock import MagicMock, patch

from infra.planos_http import TIMEOUT_SEGUNDOS, buscar_planos


def test_servico_indisponivel_devolve_none_nunca_levanta():
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("recusado")):
        assert buscar_planos("http://quote-service.invalido") is None


def test_chamada_usa_timeout_explicito():
    """A regra que não pode sumir num refactor: sem timeout explícito, uma resposta lenta do
    quote-service (ele dorme até 8s em parte das chamadas, medido) pendura a geração inteira."""
    resposta_falsa = MagicMock()
    resposta_falsa.read.return_value = json.dumps({"planos": []}).encode("utf-8")
    resposta_falsa.__enter__.return_value = resposta_falsa

    with patch("urllib.request.urlopen", return_value=resposta_falsa) as urlopen_mock:
        buscar_planos("http://quote-service.exemplo")

    _args, kwargs = urlopen_mock.call_args
    assert "timeout" in kwargs, "GET /planos sem timeout explícito pendura a geração se o serviço estiver lento"
    assert kwargs["timeout"] == TIMEOUT_SEGUNDOS


def test_le_quote_service_url_do_ambiente_como_o_cliente_da_quote(monkeypatch):
    """Mesma variável e mesmo default que `src/interfaces/cli.py:118` (PR #35) usa para a /quote —
    achado da coordenação em 2026-09-12: sem isso, o painel chamaria um host diferente do que o
    agente realmente usou quando QUOTE_SERVICE_URL apontar para outro lugar."""
    monkeypatch.setenv("QUOTE_SERVICE_URL", "http://quote-service-de-outra-rede:9000")
    resposta_falsa = MagicMock()
    resposta_falsa.read.return_value = json.dumps({"planos": []}).encode("utf-8")
    resposta_falsa.__enter__.return_value = resposta_falsa

    with patch("urllib.request.urlopen", return_value=resposta_falsa) as urlopen_mock:
        buscar_planos()  # sem base_url — precisa cair no ambiente, não no default fixo

    (url_chamada,), _kwargs = urlopen_mock.call_args
    assert url_chamada == "http://quote-service-de-outra-rede:9000/planos"


def test_sem_quote_service_url_no_ambiente_usa_o_mesmo_default_da_cli(monkeypatch):
    monkeypatch.delenv("QUOTE_SERVICE_URL", raising=False)
    resposta_falsa = MagicMock()
    resposta_falsa.read.return_value = json.dumps({"planos": []}).encode("utf-8")
    resposta_falsa.__enter__.return_value = resposta_falsa

    with patch("urllib.request.urlopen", return_value=resposta_falsa) as urlopen_mock:
        buscar_planos()

    (url_chamada,), _kwargs = urlopen_mock.call_args
    assert url_chamada == "http://localhost:8000/planos"


def test_resposta_valida_e_decodificada():
    resposta_falsa = MagicMock()
    resposta_falsa.read.return_value = json.dumps({"moeda": "BRL", "planos": []}).encode("utf-8")
    resposta_falsa.__enter__.return_value = resposta_falsa

    with patch("urllib.request.urlopen", return_value=resposta_falsa):
        planos = buscar_planos("http://quote-service.exemplo")

    assert planos == {"moeda": "BRL", "planos": []}
