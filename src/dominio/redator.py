"""Redator determinístico — monta o texto oficial a partir de um PrecoCotado.

A função que escreve preço não aceita outro tipo (issue #5 — a garantia de fluxo da premissa 3 da
âncora #3: "preço só existe se veio da API")."""
from __future__ import annotations

from dominio.preco_cotado import PrecoCotado


def montar_mensagem(preco: PrecoCotado) -> str:
    # Wave 1 (esqueleto permissivo, issue #5 — Ajuste 1 do veredito): sem o isinstance, qualquer
    # coisa "passa". A invariante entra no commit seguinte.
    return str(preco)
