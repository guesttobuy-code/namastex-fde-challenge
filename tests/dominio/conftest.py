"""Coloca `src/` no sys.path só para os testes de `tests/dominio/`.

Não mexe em `pyproject.toml` (config da F1, issue #4 — "não mexa, se precisar fale comigo") nem em
`tests/arquitetura/`, que resolvem PYTHONPATH do jeito deles via subprocess. Este conftest é local
e reversível; se F3/F4 precisarem do mesmo, é candidato a virar `pythonpath = ["src"]` único em
`pyproject.toml` — sinalizado à coordenação em vez de decidido aqui (LEI 11)."""
from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parents[2] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
