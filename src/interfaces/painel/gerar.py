"""Gerador do painel (issue #13): lê uma trilha JSONL — um arquivo, ou uma pasta com vários
`trilha_*.jsonl` (o formato que `interfaces.cli` grava em `examples/`, uma por conversa) — e
escreve as seis telas em HTML estático, sem servidor, sem dependência externa, CSS embutido.
`python -m interfaces.painel.gerar <trilha.jsonl ou pasta> <dir_saida>`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from infra.cliente_quote import (
    ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS,
    MAX_TENTATIVAS,
    ORCAMENTO_TOTAL_SEGUNDOS,
    TIMEOUT_POR_TENTATIVA_SEGUNDOS,
)
from infra.config import url_quote_service
from infra.planos_http import buscar_planos
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


def _ler_eventos(caminho_trilha: Path) -> list[dict]:
    caminho_trilha = Path(caminho_trilha)
    if caminho_trilha.is_dir():
        eventos: list[dict] = []
        for arquivo in sorted(caminho_trilha.glob("trilha_*.jsonl")):
            eventos.extend(RepositorioDeTrilhaJSONL(arquivo).todos_os_eventos())
        return eventos
    return RepositorioDeTrilhaJSONL(caminho_trilha).todos_os_eventos()


def gerar_paineis(caminho_trilha: Path, dir_saida: Path, *, caminho_ui_css: Path | None = None) -> list[Path]:
    """Gera as seis telas em `dir_saida` a partir da trilha em `caminho_trilha` — um arquivo
    `.jsonl`, ou uma pasta com vários `trilha_*.jsonl`. Retorna os caminhos escritos, na ordem de
    prioridade do escopo #13."""
    eventos = _ler_eventos(caminho_trilha)

    dir_saida = Path(dir_saida)
    dir_saida.mkdir(parents=True, exist_ok=True)

    escritos = []
    for nome_arquivo, render in _ARQUIVOS.items():
        html = render(eventos, caminho_ui_css=caminho_ui_css)
        caminho = dir_saida / nome_arquivo
        caminho.write_text(html, encoding="utf-8")
        escritos.append(caminho)

    planos = buscar_planos(url_quote_service())
    caminho_regras = dir_saida / "regras.html"
    caminho_regras.write_text(
        tela_regras.render(
            planos=planos,
            orcamento_total_segundos=ORCAMENTO_TOTAL_SEGUNDOS,
            timeout_por_tentativa_segundos=TIMEOUT_POR_TENTATIVA_SEGUNDOS,
            max_tentativas=MAX_TENTATIVAS,
            esperas_entre_tentativas_segundos=ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS,
            caminho_ui_css=caminho_ui_css,
        ),
        encoding="utf-8",
    )
    escritos.append(caminho_regras)

    caminho_avaliacao = dir_saida / "avaliacao.html"
    caminho_avaliacao.write_text(tela_avaliacao.render(caminho_ui_css=caminho_ui_css), encoding="utf-8")
    escritos.append(caminho_avaliacao)

    return escritos


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if len(argv) != 2:
        print("uso: python -m interfaces.painel.gerar <trilha.jsonl ou pasta> <dir_saida>", file=sys.stderr)
        return 2
    caminho_trilha, dir_saida = argv
    escritos = gerar_paineis(Path(caminho_trilha), Path(dir_saida))
    for caminho in escritos:
        print(f"gerado: {caminho}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
