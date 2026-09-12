"""Casca HTML compartilhada pelas seis telas — menu lateral + CSS embutido, fiel ao desenho
aprovado em `docs/design/`. O CSS embutido é o `docs/design/ui.css` real, lido do disco (`css()`),
nunca uma segunda cópia colada aqui — diverge do desenho no primeiro ajuste (LEI 11).
"""

from __future__ import annotations

from pathlib import Path

from interfaces.painel.campos import esc

_RAIZ_DESIGN = Path(__file__).resolve().parents[3] / "docs" / "design"

_ITENS_MENU = (
    ("Atendimento", (
        ("index.html", "💬", "Conversas", "conversas"),
        ("handoffs.html", "🙋", "Fila humana", "fila"),
    )),
    ("Observabilidade", (
        ("rastreio.html", "🧭", "Rastreio", None),
        ("cotacoes.html", "📈", "Cotações", None),
        ("avaliacao.html", "🎯", "Avaliação", None),
    )),
    ("Configuração", (
        ("regras.html", "⚖️", "Regras e política", None),
    )),
)


def css_embutido(caminho_ui_css: Path | None = None) -> str:
    """Lê `docs/design/ui.css` do disco — uma cópia colada aqui divergiria do desenho aprovado
    no primeiro ajuste que alguém fizer só num dos dois lugares."""
    caminho = caminho_ui_css or (_RAIZ_DESIGN / "ui.css")
    return Path(caminho).read_text(encoding="utf-8")


def pagina(
    *,
    titulo: str,
    pagina_ativa: str,
    corpo: str,
    contagens: dict[str, int] | None = None,
    caminho_ui_css: Path | None = None,
) -> str:
    contagens = contagens or {}
    menu_html = []
    for grupo, itens in _ITENS_MENU:
        menu_html.append(f'<div class="grupo">{esc(grupo)}</div>')
        for arquivo, icone, rotulo, chave_contagem in itens:
            ativo = ' aria-current="page"' if arquivo == pagina_ativa else ""
            cont = f'<span class="cont">{contagens[chave_contagem]}</span>' if chave_contagem in contagens else ""
            menu_html.append(
                f'<a href="{arquivo}"{ativo}><span class="ic">{icone}</span> {esc(rotulo)} {cont}</a>'
            )
    menu = "\n    ".join(menu_html)

    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AutoSeguro · {esc(titulo)}</title>
<style>
{css_embutido(caminho_ui_css)}
</style>
</head>
<body>
<div class="app">
<aside class="lateral">
  <div class="produto"><b data-t="AutoSeguro">AutoSeguro</b><span>agente de cotação · console</span></div>
  <nav class="menu">
    {menu}
  </nav>
  <div class="selo"><small>desafio técnico FDE<br>painel gerado da trilha real</small></div>
</aside>
<main class="conteudo">
{corpo}
</main>
</div>
</body>
</html>
"""
