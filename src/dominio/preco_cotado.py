"""PrecoCotado — o único tipo que carrega valor monetário no domínio.

Garantia de FLUXO (correção da auditoria externa, 2026-09-11 — issue #5): em Python não existe
construtor privado de verdade, então a garantia não é "ninguém instancia por fora". A garantia é
que este tipo só nasce de um payload com os campos de uma cotação bem-sucedida — e que o redator
(dominio.redator) recusa qualquer outra coisa como preço.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PrecoCotado:
    quote_attempt_id: str
    conversation_id: str
    plano_id: str
    plano_nome: str
    premio_mensal: float
    franquia: float
    coberturas: tuple[str, ...]
    moeda: str
    multiplicadores: dict | None = None
    carencia: dict | None = None
    pro_rata: dict | None = None

    _CAMPOS_OBRIGATORIOS = ("plano_id", "plano_nome", "premio_mensal", "franquia", "coberturas", "moeda")

    @classmethod
    def de_resposta_http_200(cls, quote_attempt_id: str, conversation_id: str, resposta: dict) -> "PrecoCotado":
        # Invariante I-1 (CONTRACT.md): só nasce se a resposta trouxer os campos de uma cotação
        # bem-sucedida — exceção declarada: ValueError, citando o(s) campo(s) ausente(s).
        faltando = [c for c in cls._CAMPOS_OBRIGATORIOS if resposta.get(c) is None]
        if faltando:
            raise ValueError(
                f"resposta da /quote sem os campos de uma cotação bem-sucedida: {', '.join(faltando)}"
            )
        return cls(
            quote_attempt_id=quote_attempt_id,
            conversation_id=conversation_id,
            plano_id=resposta["plano_id"],
            plano_nome=resposta["plano_nome"],
            premio_mensal=resposta["premio_mensal"],
            franquia=resposta["franquia"],
            coberturas=tuple(resposta["coberturas"]),
            moeda=resposta["moeda"],
            multiplicadores=resposta.get("multiplicadores"),
            carencia=resposta.get("carencia"),
            pro_rata=resposta.get("primeiro_pagamento_pro_rata"),
        )
