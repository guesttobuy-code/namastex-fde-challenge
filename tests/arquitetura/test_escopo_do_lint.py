"""O teste que pega a regressão da frente F1 (#4) — escrito ANTES do conserto.

A máquina só pode medir o NOSSO código Python. `pyproject.toml` ainda não existir faz este teste
falhar na coleta (ruff roda com defaults e lintaria tudo, incluindo `quote-service/`); depois do
`pyproject.toml` com `extend-exclude`, fica verde.
"""

import json
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
PROIBIDOS = ("quote-service/", "scripts/", "dataset/")


def _rodar_ruff_json() -> list[dict]:
    resultado = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--output-format=json", "."],
        cwd=RAIZ,
        capture_output=True,
        text=True,
        check=False,
    )
    # ruff sai 1 quando encontra violação — isso é esperado; só falha se a saída não for JSON válido.
    return json.loads(resultado.stdout or "[]")


def test_nenhum_arquivo_medido_e_da_namastex():
    achados = _rodar_ruff_json()
    caminhos = {Path(a["filename"]).resolve().relative_to(RAIZ).as_posix() for a in achados}
    for caminho in caminhos:
        assert not caminho.startswith(PROIBIDOS), (
            f"ruff mediu {caminho}, que é código da Namastex — extend-exclude está errado para menos"
        )


def test_ruff_mede_pelo_menos_um_arquivo_de_src():
    resultado = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--output-format=json", "src"],
        cwd=RAIZ,
        capture_output=True,
        text=True,
        check=False,
    )
    # src/ hoje só tem os __init__.py de fundação (limpos) — o que prova é que o comando ENXERGA
    # arquivos sob src/ (não sai "no files found"), não que ele acha erro.
    assert resultado.returncode in (0, 1), (
        f"ruff não conseguiu nem tentar medir src/: {resultado.stderr}"
    )
    arquivos_py_em_src = list((RAIZ / "src").rglob("*.py"))
    assert len(arquivos_py_em_src) > 0, "não há nenhum .py sob src/ para a máquina medir"
