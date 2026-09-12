"""Validação APENAS de formato (CEP, data ISO, campos presentes).

Elegibilidade (faixa etária, idade do veículo, região) é decidida pela `/quote` — não replicar
aqui (issue #5, achado já registrado pela auditoria externa; ratificado em #16)."""
from __future__ import annotations


def cep_valido(cep: str | None) -> bool:
    # Wave 1 (esqueleto permissivo, issue #5): sem checar o formato de verdade.
    return True


def data_iso_valida(data: str | None) -> bool:
    # Wave 1 (esqueleto permissivo, issue #5): sem checar o formato de verdade.
    return True


def campos_obrigatorios_faltantes(payload: dict) -> frozenset[str]:
    # Wave 1 (esqueleto permissivo, issue #5): nunca aponta nada faltando.
    return frozenset()
