"""Vocabulário fechado da intenção do lead (issue #42) — Enum, no lugar da string livre que
`estado_conversa.EstadoDaConversa.ultimo_intent` aceitava antes. Começa só com as intenções que
têm decisão (`politica.decidir`); outras entram quando o dono decidir (LEI 2 — não-chute).

`QUER_FALAR_COM_HUMANO` (issue #57, P9, decisão do dono 13/09/2026): pedido explícito de humano
("quero falar com um atendente", "me passa para uma pessoa") vira `MotivoHandoff.LEAD_PEDIU_HUMANO`
em `politica.decidir`, mesmo grau de `QUER_CONTRATAR` (incondicional, antes de qualquer outro
ramo) — nunca reaproveita o motivo de "quero contratar", são pedidos diferentes do lead.

Fica fora daqui, por decisão do dono (issue #42): `dominio.saida_de_linguagem.SaidaDeLinguagem.intent`
e o adaptador do LLM (F6/#9) — território de outra frente, continuam `str | None`. A conversão da
string livre do LLM para este Enum acontece em `aplicacao.servico_conversa`, na fronteira que esta
frente é dona de decidir.

`OBJECAO_DE_PRECO` (issue #58, frente `ia-responde`): o lead levanta objeção de preço fora do
fluxo de coleta — desvia `conduzir_conversa` para a resposta orientada pela base de conhecimento
em vez do fluxo guiado normal (ver `aplicacao.servico_resposta_orientada`).
"""
from __future__ import annotations

from enum import Enum


class Intencao(str, Enum):
    INFORMAR_DADOS = "informar_dados"
    QUER_CONTRATAR = "quer_contratar"
    QUER_FALAR_COM_HUMANO = "quer_falar_com_humano"
    OBJECAO_DE_PRECO = "objecao_de_preco"
