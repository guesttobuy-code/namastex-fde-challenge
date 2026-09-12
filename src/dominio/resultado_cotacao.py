"""Resultado de uma tentativa de cotação — estados explícitos, sem IO."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from dominio.preco_cotado import PrecoCotado


class StatusCotacao(str, Enum):
    SUCESSO = "sucesso"
    RECUSA_DE_NEGOCIO = "recusa_de_negocio"
    ERRO_DE_PAYLOAD = "erro_de_payload"
    INDISPONIVEL = "indisponivel"
    TIMEOUT = "timeout"


@dataclass(frozen=True)
class ResultadoDaCotacao:
    status: StatusCotacao
    preco: PrecoCotado | None = None
    motivo: str | None = None

    # Wave 1 (esqueleto permissivo, issue #5 — Ajuste 1 do veredito): sem validação de que `preco`
    # e `motivo` são mutuamente exclusivos. A invariante entra no commit seguinte.

    @classmethod
    def sucesso(cls, preco: PrecoCotado) -> "ResultadoDaCotacao":
        return cls(status=StatusCotacao.SUCESSO, preco=preco)

    @classmethod
    def recusa_de_negocio(cls, motivo: str) -> "ResultadoDaCotacao":
        return cls(status=StatusCotacao.RECUSA_DE_NEGOCIO, motivo=motivo)

    @classmethod
    def erro_de_payload(cls, motivo: str) -> "ResultadoDaCotacao":
        return cls(status=StatusCotacao.ERRO_DE_PAYLOAD, motivo=motivo)

    @classmethod
    def indisponivel(cls, motivo: str) -> "ResultadoDaCotacao":
        return cls(status=StatusCotacao.INDISPONIVEL, motivo=motivo)

    @classmethod
    def timeout(cls, motivo: str) -> "ResultadoDaCotacao":
        return cls(status=StatusCotacao.TIMEOUT, motivo=motivo)
