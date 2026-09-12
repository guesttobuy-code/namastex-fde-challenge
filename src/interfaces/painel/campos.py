"""Como um campo da trilha vira texto na tela — as duas regras que não se negociam do escopo #13.

Regra 1: todo texto vindo da trilha é conteúdo não confiável (mensagem do lead) e passa por
`html.escape` antes de entrar no HTML, sem exceção — inclusive `regra_aplicada`, `reason_code` e
ids. Regra 2: campo ausente vira um marcador visível (`.falta`, já existe em `docs/design/ui.css`),
nunca string vazia — "no dia em que a trilha não tiver um campo, a tela mostra o buraco em vez de
esconder" (ESPECIFICACAO.md §3).
"""

from __future__ import annotations

import html
from collections.abc import Iterable
from typing import Any

MARCADOR_AUSENTE = "ausente na trilha"


def esc(valor: Any) -> str:
    """Escapa qualquer valor da trilha para uso seguro em HTML. Nunca pula um campo."""
    if valor is None:
        return ""
    return html.escape(str(valor), quote=True)


def campo(evento: dict, chave: str) -> str:
    """Texto escapado do campo, ou o buraco visível se ausente/vazio — nunca string vazia lisa."""
    valor = evento.get(chave)
    if valor is None or valor == "" or valor == () or valor == []:
        return buraco(chave)
    return esc(valor)


def buraco(chave: str) -> str:
    return f'<span class="falta">⚠ {MARCADOR_AUSENTE}: {esc(chave)}</span>'


def resposta_http_textual(tentativa: dict) -> str:
    """Texto de resposta de uma `tentativa_de_cotacao` — nunca o `http_status` cru quando ele é 0.

    Medido na trilha real do PR #35: um timeout de conexão/leitura não chega a ter resposta HTTP, e
    `infra.cliente_quote` grava `http_status: 0` nesse caso. Mostrar "0" sugeriria um código que não
    existe; inventar um código (ex.: 504) seria a mesma fabricação que a regra 2 do escopo #13
    proíbe. A `classificacao` é a fonte real do que aconteceu."""
    http_status = tentativa.get("http_status")
    if http_status == 0:
        return f"sem resposta ({campo(tentativa, 'classificacao')})"
    return campo(tentativa, "http_status")


def lista(valores: Iterable[Any] | None, vazio_e_buraco: bool = True) -> str:
    """Junta uma lista de valores (ex.: `dados_usados`, `coberturas`) escapando cada item."""
    itens = list(valores) if valores else []
    if not itens:
        return buraco("lista vazia") if vazio_e_buraco else ""
    return ", ".join(esc(item) for item in itens)
