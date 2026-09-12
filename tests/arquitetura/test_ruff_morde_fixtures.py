"""Cada substituto tem um teste que prova que ele morde a fixture correspondente (issue #4).
Se alguém afrouxar a configuração do ruff, um destes fica vermelho.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[2]
FIXTURES = RAIZ / "tests" / "arquitetura" / "fixtures"

CASOS = [
    ("except_nu.py", {"E722", "S110"}),
    ("except_generico.py", {"BLE001"}),
    ("log_engole_erro.py", {"TRY400", "TRY300"}),
    ("task_solta.py", {"RUF006", "ASYNC110"}),
    ("todo_sem_issue.py", {"TD003", "FIX002"}),
]


def _codigos_do_ruff(caminho: Path) -> set[str]:
    resultado = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--output-format=json", str(caminho)],
        cwd=RAIZ,
        capture_output=True,
        text=True,
        check=False,
    )
    achados = json.loads(resultado.stdout or "[]")
    return {a["code"] for a in achados}


@pytest.mark.parametrize("nome_arquivo,codigos_esperados", CASOS)
def test_fixture_morde_a_regra_esperada(nome_arquivo, codigos_esperados):
    codigos = _codigos_do_ruff(FIXTURES / nome_arquivo)
    faltando = codigos_esperados - codigos
    assert not faltando, (
        f"{nome_arquivo}: esperava {codigos_esperados}, ruff achou {codigos} (faltou {faltando})"
    )


def test_import_furando_camada_morde():
    fixture_dir = FIXTURES / "import_furando_camada"
    lint_imports = Path(sys.executable).with_name("lint-imports.exe")
    if not lint_imports.exists():
        lint_imports = Path(sys.executable).with_name("lint-imports")
    resultado = subprocess.run(
        [str(lint_imports), "--config", str(fixture_dir / ".importlinter_fixture")],
        cwd=RAIZ,
        env={**os.environ, "PYTHONPATH": str(fixture_dir)},
        capture_output=True,
        text=True,
        check=False,
    )
    assert resultado.returncode == 1, (
        f"a fixture de import cruzando camada devia reprovar (exit 1); saiu {resultado.returncode}\n"
        f"{resultado.stdout}\n{resultado.stderr}"
    )
    assert "BROKEN" in resultado.stdout
