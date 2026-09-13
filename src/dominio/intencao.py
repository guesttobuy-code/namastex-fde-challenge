"""Vocabulário fechado da intenção do lead (issue #42) — Enum, no lugar da string livre que
`estado_conversa.EstadoDaConversa.ultimo_intent` aceitava antes. Começa só com as intenções que
têm decisão (`politica.decidir`); outras entram quando o dono decidir (LEI 2 — não-chute).

Fica fora daqui, por decisão do dono (issue #42): `dominio.saida_de_linguagem.SaidaDeLinguagem.intent`
e o adaptador do LLM (F6/#9) — território de outra frente, continuam `str | None`. A conversão da
string livre do LLM para este Enum acontece em `aplicacao.servico_conversa`, na fronteira que esta
frente é dona de decidir.
"""
from __future__ import annotations

from enum import Enum


class Intencao(str, Enum):
    INFORMAR_DADOS = "informar_dados"
    QUER_CONTRATAR = "quer_contratar"
