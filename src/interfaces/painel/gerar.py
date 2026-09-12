"""Gerador do painel (issue #13): lê um arquivo de trilha JSONL e escreve as seis telas em HTML
estático — sem servidor, sem dependência externa, CSS embutido. `python -m interfaces.painel.gerar
<trilha.jsonl> <dir_saida>`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from infra.trilha_jsonl import RepositorioDeTrilhaJSONL
from interfaces.painel import (
    tela_avaliacao,
    tela_conversas,
    tela_cotacoes,
    tela_fila_humana,
    tela_rastreio,
    tela_regras,
)

_ARQUIVOS = {
    "index.html": lambda eventos, **kw: tela_conversas.render(eventos, **kw),
    "rastreio.html": lambda eventos, **kw: tela_rastreio.render(eventos, **kw),
    "cotacoes.html": lambda eventos, **kw: tela_cotacoes.render(eventos, **kw),
    "handoffs.html": lambda eventos, **kw: tela_fila_humana.render(eventos, **kw),
}


def gerar_paineis(caminho_trilha: Path, dir_saida: Path, *, caminho_ui_css: Path | None = None) -> list[Path]:
    """Gera as seis telas em `dir_saida` a partir da trilha em `caminho_trilha`. Retorna os
    caminhos escritos, na ordem de prioridade do escopo #13."""
    repositorio = RepositorioDeTrilhaJSONL(Path(caminho_trilha))
    eventos = repositorio.todos_os_eventos()

    dir_saida = Path(dir_saida)
    dir_saida.mkdir(parents=True, exist_ok=True)

    escritos = []
    for nome_arquivo, render in _ARQUIVOS.items():
        html = render(eventos, caminho_ui_css=caminho_ui_css)
        caminho = dir_saida / nome_arquivo
        caminho.write_text(html, encoding="utf-8")
        escritos.append(caminho)

    caminho_regras = dir_saida / "regras.html"
    caminho_regras.write_text(tela_regras.render(caminho_ui_css=caminho_ui_css), encoding="utf-8")
    escritos.append(caminho_regras)

    caminho_avaliacao = dir_saida / "avaliacao.html"
    caminho_avaliacao.write_text(tela_avaliacao.render(caminho_ui_css=caminho_ui_css), encoding="utf-8")
    escritos.append(caminho_avaliacao)

    return escritos


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if len(argv) != 2:
        print("uso: python -m interfaces.painel.gerar <trilha.jsonl> <dir_saida>", file=sys.stderr)
        return 2
    caminho_trilha, dir_saida = argv
    escritos = gerar_paineis(Path(caminho_trilha), Path(dir_saida))
    for caminho in escritos:
        print(f"gerado: {caminho}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
