"""Redator determinístico — monta o texto oficial a partir de um PrecoCotado.

A função que escreve preço não aceita outro tipo (issue #5 — a garantia de fluxo da premissa 3 da
âncora #3: "preço só existe se veio da API")."""
from __future__ import annotations

from dominio.preco_cotado import PrecoCotado


def montar_mensagem(preco: PrecoCotado) -> str:
    if not isinstance(preco, PrecoCotado):
        raise TypeError(f"montar_mensagem só aceita PrecoCotado, recebeu {type(preco).__name__}")

    linhas = [
        f"Plano {preco.plano_nome}: R$ {preco.premio_mensal:.2f}/mês, franquia R$ {preco.franquia:.2f}.",
        f"Coberturas: {', '.join(preco.coberturas)}.",
    ]
    if preco.carencia and preco.carencia.get("coberturas"):
        linhas.append(
            f"Carência de {preco.carencia['dias']} dias para: {', '.join(preco.carencia['coberturas'])}."
        )
    if preco.pro_rata:
        linhas.append(
            f"Primeiro pagamento proporcional: R$ {preco.pro_rata['valor_primeiro_pagamento']:.2f} "
            f"({preco.pro_rata['dias_cobrados']} de {preco.pro_rata['dias_no_mes']} dias)."
        )
    return " ".join(linhas)
