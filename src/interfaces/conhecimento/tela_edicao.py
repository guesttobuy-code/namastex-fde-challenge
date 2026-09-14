"""Tela Base de conhecimento (issue #46, PR 1 de 2 — Casca): o editor de fichas de objeção que
antes vivia sozinho em `/`, com uma casca visual PRÓPRIA (CSS embutido, paleta diferente de
`docs/design/ui.css`). Esta frente ELIMINA a segunda casca (LEI 11 — dono único do menu/CSS) e
serve o mesmo editor — campos, ids e `<script>` intactos (fora de escopo redesenhar a UX interna,
ver PLANO item 5) — dentro de `layout.pagina()`, igual às cinco telas do painel.

`_corpo.html` é o fragmento estático (formulário + `<script>` que faz `fetch` para
`/api/objecoes*` e `/api/configuracao-comercial` — rotas que não mudam nesta PR): lido do disco,
nunca colado aqui, pela mesma razão de `painel.layout.css_embutido` — uma cópia divergiria do
arquivo real no primeiro ajuste feito só num dos dois lugares.
"""

from __future__ import annotations

from pathlib import Path

from interfaces.painel.layout import css_extra_da_tela, pagina

_CORPO = Path(__file__).resolve().parent / "_corpo.html"


def render(*, caminho_ui_css=None) -> str:
    corpo = _CORPO.read_text(encoding="utf-8")
    return pagina(
        titulo="Base de conhecimento",
        pagina_ativa="/conhecimento",
        corpo=corpo,
        caminho_ui_css=caminho_ui_css,
        css_extra=css_extra_da_tela("conhecimento.html"),
    )
