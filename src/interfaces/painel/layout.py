"""Casca HTML compartilhada pelas seis telas — menu lateral + CSS embutido, fiel ao desenho
aprovado em `docs/design/`. O CSS embutido é o `docs/design/ui.css` real, lido do disco
(`css_embutido`), mais o segundo bloco `<style>` PRÓPRIO de cada mock (`css_extra_da_tela`) — cada
`docs/design/<tela>.html` tem componentes que não estão no `ui.css` compartilhado (a timeline do
Rastreio, o balão de conversa, os cartões da Fila humana...). Os dois são lidos do disco, nunca
colados aqui — divergiria do desenho aprovado no primeiro ajuste feito só num dos dois lugares
(LEI 11).
"""

from __future__ import annotations

import re
from pathlib import Path

from interfaces.painel.campos import esc

_RAIZ_DESIGN = Path(__file__).resolve().parents[3] / "docs" / "design"

# O painel introduz um conceito que o mock não tinha (campo ausente na trilha vira buraco visível,
# ESPECIFICACAO.md §3) — não há bloco correspondente em nenhum docs/design/*.html para reler daqui.
# Reaproveita a variável de cor `--alerta` já definida em ui.css, mesma classe usada por
# `campos.buraco()`.
_CSS_BURACO_VISIVEL = ".falta{color:var(--alerta)}"

# issue #93: resposta vazia EXPLÍCITA (o lead apertou Enter sem responder um campo opcional) não é
# falha de gravação — precisa de um estilo neutro, nunca o vermelho de `.falta`. Nenhum mock tinha
# esse conceito ainda (o mesmo motivo do `.falta` acima).
_CSS_VAZIO_EXPLICITO = ".vazio{color:var(--texto-mais-fraco);font-style:italic}"

# issue #93 (achado da coordenação no #91): o resumo sintético da coleta (`sender_role="sistema"`,
# issue #39) já usa `.estado-interno` na tela de Conversas — a classe vive só no `<style>` de
# `docs/design/index.html:124-125` (copiada aqui LITERAL, LEI 11: mesma regra, nunca redecidida),
# porque `docs/design/rastreio.html` nunca precisou dela até o Rastreio também desenhar esse evento.
_CSS_ESTADO_INTERNO = (
    ".estado-interno{align-self:center;font-family:var(--mono);font-size:11px;"
    "color:var(--texto-mais-fraco);border:1px dashed var(--borda);border-radius:999px;"
    "padding:3px 12px}"
)

# Idem para botão desabilitado: o mock nunca precisou disso, porque lá os botões só pareciam
# clicáveis (nenhum tinha `disabled` de verdade). Regra 4 do escopo exige que fiquem VISIVELMENTE
# desabilitados — o atributo HTML sozinho, sem isto, não basta em todo navegador.
_CSS_BOTAO_DESABILITADO = "button[disabled]{opacity:.45;cursor:not-allowed}"

# UI-B1 (achado da pré-auditoria em navegador do PR #87): nenhum mock em docs/design/ jamais usou o
# atributo `hidden` — a tela de conversas (S13, issue #57) é a primeira a depender dele pra mostrar
# uma conversa por vez —, então nenhuma folha carregada tem esta regra; sem ela `hidden` fica só um
# atributo inerte no HTML, o navegador continua desenhando o elemento.
_CSS_HIDDEN_FUNCIONA = "[hidden]{display:none!important}"

# UI-B2 (mesma pré-auditoria): `.botao`/`.botao.principal` também são novos desta tela — nenhum mock
# tinha botão de ação real (só pareciam clicáveis). Reaproveita as cores do tema; `.principal` usa o
# magenta da identidade, o secundário fica neutro. `button[disabled]` acima já cobre o apagado.
_CSS_BOTAO = (
    ".botao{background:var(--superficie-2);color:var(--texto);border:1px solid var(--borda);"
    "border-radius:10px;padding:8px 14px;font-size:13.5px;cursor:pointer}"
    ".botao:hover:not([disabled]){border-color:var(--magenta)}"
    ".botao.principal{background:var(--magenta);color:#1a002e;border-color:var(--magenta);font-weight:600}"
    ".botao.principal:hover:not([disabled]){background:#e600e6}"
)

_ITENS_MENU = (
    ("Atendimento", (
        ("/", "💬", "Conversas", None),
        # issue #57 (P14, S10 do roteiro de aceite): "Fila humana" deixa de ser página própria e
        # vira atalho — mesmo rótulo/ícone, só o destino muda (decisão do dono: "não some, vira
        # atalho"). Filtra o Histórico de atendimentos pelo status oficial equivalente
        # (`interfaces.painel.tela_conversas`, JS lê `?status=` no carregamento da página).
        ("/painel/index.html?status=aguardando_corretor", "🙋", "Fila humana", "fila"),
    )),
    ("Observabilidade", (
        ("/painel/rastreio.html", "🧭", "Rastreio", None),
        ("/painel/cotacoes.html", "📈", "Cotações", None),
        ("/painel/avaliacao.html", "🎯", "Avaliação", None),
        ("/painel/index.html", "📚", "Histórico de atendimentos", "conversas"),
    )),
    ("Configuração", (
        ("/painel/regras.html", "⚖️", "Regras e política", None),
    )),
    ("Insumos", (
        ("/conhecimento", "🧠", "Base de conhecimento", None),
    )),
)


def css_embutido(caminho_ui_css: Path | None = None) -> str:
    """Lê `docs/design/ui.css` do disco — uma cópia colada aqui divergiria do desenho aprovado
    no primeiro ajuste que alguém fizer só num dos dois lugares."""
    caminho = caminho_ui_css or (_RAIZ_DESIGN / "ui.css")
    return Path(caminho).read_text(encoding="utf-8")


def css_extra_da_tela(nome_arquivo_mock: str, *, raiz_design: Path | None = None) -> str:
    """Lê o(s) bloco(s) `<style>` PRÓPRIO(S) de `docs/design/<nome_arquivo_mock>` — tudo depois do
    primeiro, que é o `ui.css` compartilhado repetido em cada mock. Sem isso, componentes como a
    timeline do Rastreio ou o balão de conversa ficam sem estilo nenhum: existem só no segundo
    bloco de cada arquivo, nunca em `ui.css`."""
    caminho = (raiz_design or _RAIZ_DESIGN) / nome_arquivo_mock
    html = Path(caminho).read_text(encoding="utf-8")
    blocos = re.findall(r"<style>(.*?)</style>", html, flags=re.DOTALL)
    return "\n".join(blocos[1:])


def pagina(
    *,
    titulo: str,
    pagina_ativa: str,
    corpo: str,
    contagens: dict[str, int] | None = None,
    caminho_ui_css: Path | None = None,
    css_extra: str = "",
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
{_CSS_BURACO_VISIVEL}
{_CSS_VAZIO_EXPLICITO}
{_CSS_ESTADO_INTERNO}
{_CSS_BOTAO_DESABILITADO}
{_CSS_HIDDEN_FUNCIONA}
{_CSS_BOTAO}
{css_extra}
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
