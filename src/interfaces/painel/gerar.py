"""Gerador do painel (issue #13): lê uma trilha JSONL — um arquivo, ou uma pasta com vários
`trilha_*.jsonl` (o formato que `interfaces.cli` grava em `examples/`, uma por conversa) — e
escreve as telas do painel em HTML estático (mais o CSV do Relatório), sem servidor, sem
dependência externa, CSS embutido. `python -m interfaces.painel.gerar <trilha.jsonl ou pasta>
<dir_saida>`.
"""

from __future__ import annotations

import sys
from pathlib import Path

from aplicacao.portas.repositorio_contato import RepositorioDeContato
from dominio.contato_lead import ContatoLead
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
    tela_rastreio,
    tela_regras,
    tela_relatorio,
)

# index.html sai deste dict (issue #46 e #57, PR 2 de 2): precisa receber `contatos`, que as
# outras telas do loop não usam — mesmo padrão que regras.html/avaliacao.html já seguem, tratadas
# à parte logo abaixo, fora do loop.
_ARQUIVOS = {
    "rastreio.html": lambda eventos, **kw: tela_rastreio.render(eventos, **kw),
    "cotacoes.html": lambda eventos, **kw: tela_cotacoes.render(eventos, **kw),
}


def _ler_eventos(caminho_trilha: Path) -> list[dict]:
    caminho_trilha = Path(caminho_trilha)
    if caminho_trilha.is_dir():
        eventos: list[dict] = []
        for arquivo in sorted(caminho_trilha.glob("trilha_*.jsonl")):
            eventos.extend(RepositorioDeTrilhaJSONL(arquivo).todos_os_eventos())
        return eventos
    return RepositorioDeTrilhaJSONL(caminho_trilha).todos_os_eventos()


def _contatos_das_conversas(
    eventos: list[dict], repositorio_contato: RepositorioDeContato | None
) -> dict[str, ContatoLead] | None:
    """Monta `conversation_id -> ContatoLead` para `tela_conversas.render` (ADR-0005, decisão 3;
    issue #57, P14 — antes alimentava `tela_fila_humana`, removida): lê o repositório de contato só
    para as conversas que aparecem na trilha, nunca grava nada e nunca passa pelo
    `RepositorioDeTrilha`. `repositorio_contato=None` (chamador não passou — aditivo) devolve
    `None`, e a tela cai no comportamento de hoje ("não informado" para tudo)."""
    if repositorio_contato is None:
        return None
    conversas = {evento.get("conversation_id") for evento in eventos if evento.get("conversation_id")}
    contatos: dict[str, ContatoLead] = {}
    for conversation_id in conversas:
        contato = repositorio_contato.obter(conversation_id)
        if contato is not None:
            contatos[conversation_id] = contato
    return contatos


def gerar_paineis(
    caminho_trilha: Path,
    dir_saida: Path,
    *,
    caminho_ui_css: Path | None = None,
    repositorio_contato: RepositorioDeContato | None = None,
) -> list[Path]:
    """Gera as telas do painel em `dir_saida` a partir da trilha em `caminho_trilha` — um arquivo
    `.jsonl`, ou uma pasta com vários `trilha_*.jsonl`. Retorna os caminhos escritos, na ordem de
    prioridade do escopo #13. `handoffs.html` (Fila humana) não é mais gerado (issue #57, P14, PR
    2 de 2, pré-auditoria do PR #87) — o menu aponta pro Histórico já filtrado (S10), e o catálogo
    de motivos migrou para `regras.html`. `relatorio.html`/`relatorio.csv` (issue #59, PR 2 de 2)
    reusam a MESMA `contatos` já calculada para `index.html` — sem segunda leitura do repositório.

    `repositorio_contato` (issue #46, PR 2 de 2, ADR-0005): aditivo, default `None` — todo chamador
    existente continua funcionando igual. Quando passado, `index.html` (Histórico) ganha nome/
    WhatsApp do lead ao lado de cada conversa encaminhada, lido fora da trilha."""
    eventos = _ler_eventos(caminho_trilha)

    dir_saida = Path(dir_saida)
    dir_saida.mkdir(parents=True, exist_ok=True)

    contatos = _contatos_das_conversas(eventos, repositorio_contato)

    escritos = []
    for nome_arquivo, render in _ARQUIVOS.items():
        html = render(eventos, caminho_ui_css=caminho_ui_css)
        caminho = dir_saida / nome_arquivo
        caminho.write_text(html, encoding="utf-8")
        escritos.append(caminho)

    caminho_index = dir_saida / "index.html"
    caminho_index.write_text(
        tela_conversas.render(eventos, caminho_ui_css=caminho_ui_css, contatos=contatos), encoding="utf-8"
    )
    escritos.append(caminho_index)

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

    linhas_relatorio = tela_relatorio.montar_linhas(eventos, contatos=contatos)
    caminho_relatorio = dir_saida / "relatorio.html"
    caminho_relatorio.write_text(
        tela_relatorio.render(linhas_relatorio, caminho_ui_css=caminho_ui_css), encoding="utf-8"
    )
    escritos.append(caminho_relatorio)
    caminho_relatorio_csv = dir_saida / "relatorio.csv"
    caminho_relatorio_csv.write_bytes(tela_relatorio.gerar_csv(linhas_relatorio))
    escritos.append(caminho_relatorio_csv)

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
