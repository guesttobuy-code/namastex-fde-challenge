"""Roda `lint-imports` contra o `.importlinter` real (contrato de camadas da issue #4).
Fica vermelho se o contrato de fronteira entre `dominio`/`aplicacao`/`infra`/`interfaces` quebrar.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
_IMPORT_DE_INFRA = re.compile(r"^\s*(from\s+infra\b|import\s+infra\b)", re.MULTILINE)


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


def test_telas_do_painel_nao_importam_infra_direto():
    """I-4 de `interfaces/CONTRACT.md` (issue #51/#55): só `painel/gerar.py` é raiz de composição —
    telas do painel (`painel/tela_*.py` e módulos auxiliares) recebem dado pronto por parâmetro,
    nunca importam `infra`. `.importlinter` não cobra `interfaces`→`infra` (achado da própria I-4),
    então esta é a única máquina que existe para essa garantia — achado da auditoria do PR #64."""
    dir_painel = RAIZ / "src" / "interfaces" / "painel"
    violacoes = {}
    for arquivo in sorted(dir_painel.glob("*.py")):
        if arquivo.name in ("gerar.py", "__init__.py"):
            continue
        texto = arquivo.read_text(encoding="utf-8")
        achados = _IMPORT_DE_INFRA.findall(texto)
        if achados:
            violacoes[arquivo.name] = achados
    assert not violacoes, (
        f"tela(s) do painel importando infra direto (só gerar.py pode): {violacoes}"
    )
