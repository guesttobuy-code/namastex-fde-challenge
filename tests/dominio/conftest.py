"""Redundante desde que `pyproject.toml` ganhou `pythonpath = ["src"]` (R9, issue #16) — este
arquivo só continua aqui porque `companion-red-green` compara `merge-base(origin/main)..HEAD` unido
ao índice staged, e um `add` num commit já feito + `delete` no índice do commit seguinte, DENTRO DA
MESMA branch ainda não mergeada, deixa o caminho na lista de "testes tocados" sem existir no
working tree, e o guard reprova tentando rodar pytest num arquivo que já não está lá (achado
medido nesta frente, comentado na issue #5).

REMOVER neste arquivo assim que a branch mergear (o `merge-base` andar) — não antes, senão o
pre-commit reprova o commit que apaga. Sem isto, nada quebra: é dead code, o `if` abaixo nunca
insere nada de novo além do que `pythonpath` já colocou."""
from __future__ import annotations

import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parents[2] / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
