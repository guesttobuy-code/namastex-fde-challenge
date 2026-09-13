"""Redator determinístico — monta o texto oficial a partir de um PrecoCotado.

A função que escreve preço não aceita outro tipo (issue #5 — a garantia de fluxo da premissa 3 da
âncora #3: "preço só existe se veio da API")."""
from __future__ import annotations

from dominio.nomes_cobertura import nome_legivel
from dominio.preco_cotado import PrecoCotado


def valor_br(valor: float) -> str:
    """Formato brasileiro de moeda (achado #54): `f"{valor:.2f}"` saía `241.38`/`3000.00` — ponto
    decimal, sem separador de milhar. Aqui: vírgula decimal, ponto de milhar. Público (issue #58,
    dono único LEI 11) — `aplicacao.servico_resposta_orientada` reaproveita para preencher os
    marcadores monetários da resposta da IA, em vez de duplicar a formatação."""
    inteiro, decimal = f"{valor:,.2f}".split(".")
    return f"{inteiro.replace(',', '.')},{decimal}"


def montar_mensagem(preco: PrecoCotado) -> str:
    if not isinstance(preco, PrecoCotado):
        raise TypeError(f"montar_mensagem só aceita PrecoCotado, recebeu {type(preco).__name__}")

    coberturas = ", ".join(nome_legivel(c) for c in preco.coberturas)
    linhas = [
        f"Plano {preco.plano_nome}: R$ {valor_br(preco.premio_mensal)}/mês, franquia R$ {valor_br(preco.franquia)}.",
        f"Coberturas: {coberturas}.",
    ]
    if preco.carencia and preco.carencia.get("coberturas"):
        coberturas_carencia = ", ".join(nome_legivel(c) for c in preco.carencia["coberturas"])
        linhas.append(f"Carência de {preco.carencia['dias']} dias para: {coberturas_carencia}.")
    if preco.pro_rata:
        linhas.append(
            f"Primeiro pagamento proporcional: R$ {valor_br(preco.pro_rata['valor_primeiro_pagamento'])} "
            f"({preco.pro_rata['dias_cobrados']} de {preco.pro_rata['dias_no_mes']} dias)."
        )
    return " ".join(linhas)
