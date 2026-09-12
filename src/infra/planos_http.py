"""Cliente mínimo e só-leitura do `GET /planos` do quote-service, para a tela Regras (escopo #13,
regra 3: "esta tela lê a tabela do serviço de cotação", nunca redigita números). Timeout curto e
falha silenciosa controlada — se o serviço não estiver de pé na geração, quem chama recebe `None`
e mostra o buraco visível; nunca um valor de memória fingindo ser a tabela real.

A URL vem de `infra.config.url_quote_service()` — mesma função que `interfaces/cli.py` usa para a
`/quote`, depois do rebase pós-#35 (achado da coordenação, LEI 11: antes do merge, os dois liam
`QUOTE_SERVICE_URL` cada um do seu jeito).
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

from infra.config import url_quote_service

TIMEOUT_SEGUNDOS = 2.0


def buscar_planos(base_url: str | None = None) -> dict | None:
    base_url = base_url if base_url is not None else url_quote_service()
    try:
        with urllib.request.urlopen(f"{base_url}/planos", timeout=TIMEOUT_SEGUNDOS) as resposta:
            return json.loads(resposta.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None
