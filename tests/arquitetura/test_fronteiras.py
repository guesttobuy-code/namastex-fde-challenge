"""Roda `lint-imports` contra o `.importlinter` real (contrato de camadas da issue #4).
Fica vermelho se o contrato de fronteira entre `dominio`/`aplicacao`/`infra`/`interfaces` quebrar.
"""

import os
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]


def test_contrato_de_camadas_nao_quebrou():
    env = {**os.environ, "PYTHONPATH": str(RAIZ / "src")}
    lint_imports = Path(sys.executable).with_name("lint-imports.exe")
    if not lint_imports.exists():
        lint_imports = Path(sys.executable).with_name("lint-imports")
    resultado = subprocess.run(
        [str(lint_imports)],
        cwd=RAIZ,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert resultado.returncode == 0, (
        f"contrato de camadas quebrou:\n{resultado.stdout}\n{resultado.stderr}"
    )
