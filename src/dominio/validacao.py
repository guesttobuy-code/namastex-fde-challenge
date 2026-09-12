"""Validação APENAS de formato (CEP, data ISO, campos presentes).

Elegibilidade (faixa etária, idade do veículo, região) é decidida pela `/quote` — não replicar
aqui (issue #5, achado já registrado pela auditoria externa; ratificado em #16)."""
from __future__ import annotations

import re
from datetime import date

_CEP_RE = re.compile(r"^\d{5}-?\d{3}$")
_CAMPOS_OBRIGATORIOS = ("idade", "veiculo_ano", "cep")


def cep_valido(cep: str | None) -> bool:
    if not isinstance(cep, str) or not cep:
        return False
    return bool(_CEP_RE.match(cep.strip()))


def data_iso_valida(data: str | None) -> bool:
    if not isinstance(data, str) or not data:
        return False
    try:
        date.fromisoformat(data)
    except ValueError:
        return False
    return True


def campos_obrigatorios_faltantes(payload: dict) -> frozenset[str]:
    # CEP é política NOSSA (não da API): sem ele a /quote responde 200 e cobra até 30% a menos, em
    # silêncio (regiao_cep). plano_id NÃO entra aqui — a /quote assume "essencial" quando ausente
    # (quote_logic.py:64). Elegibilidade (faixa etária, idade do veículo) não é validada aqui.
    return frozenset(c for c in _CAMPOS_OBRIGATORIOS if payload.get(c) in (None, ""))
