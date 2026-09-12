"""Cliente mínimo e só-leitura do `GET /planos` do quote-service, para a tela Regras (escopo #13,
regra 3: "esta tela lê a tabela do serviço de cotação", nunca redigita números). Timeout curto e
falha silenciosa controlada — se o serviço não estiver de pé na geração, quem chama recebe `None`
e mostra o buraco visível; nunca um valor de memória fingindo ser a tabela real.

`QUOTE_SERVICE_URL` é a mesma variável e o mesmo padrão que `src/interfaces/cli.py:118` do PR #35
usa para resolver a `/quote` — se divergir, o painel chamaria um host diferente do que o agente
realmente usou (LEI 11, achado da coordenação em 2026-09-12). Unificar os dois num lugar só em
`infra` fica para o rebase pós-#35 — até lá, cada cliente lê a variável do seu jeito, mesmo nome e
mesmo default, sem copiar código da branch `agente`.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

TIMEOUT_SEGUNDOS = 2.0


def _url_padrao() -> str:
    return os.environ.get("QUOTE_SERVICE_URL", "http://localhost:8000")


def buscar_planos(base_url: str | None = None) -> dict | None:
    base_url = base_url if base_url is not None else _url_padrao()
    try:
        with urllib.request.urlopen(f"{base_url}/planos", timeout=TIMEOUT_SEGUNDOS) as resposta:
            return json.loads(resposta.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError):
        return None
