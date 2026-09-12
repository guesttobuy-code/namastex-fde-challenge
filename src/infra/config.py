"""Configuração de ambiente compartilhada por quem fala com serviços externos em `infra` — hoje só
a URL do `quote-service`. Antes do merge do PR #35, `interfaces/cli.py` (a `/quote`) e
`infra/planos_http.py` (o `/planos`) liam `QUOTE_SERVICE_URL` cada um do seu jeito, mesmo nome e
mesmo default, mas em dois lugares — exatamente a divergência que a LEI 11 do CLAUDE.md proíbe: se
alguém mudasse um site sem lembrar do outro, o painel chamaria um host diferente do que o agente
realmente usou. Dono único agora (achado da coordenação, issue #13, 2026-09-12).
"""

from __future__ import annotations

import os

_DEFAULT_URL_QUOTE_SERVICE = "http://localhost:8000"


def url_quote_service() -> str:
    return os.environ.get("QUOTE_SERVICE_URL", _DEFAULT_URL_QUOTE_SERVICE)
