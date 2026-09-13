"""Validação APENAS de formato (CEP, data ISO, campos presentes).

Elegibilidade (faixa etária, idade do veículo, região) é decidida pela `/quote` — não replicar
aqui (issue #5, achado já registrado pela auditoria externa; ratificado em #16)."""
from __future__ import annotations

import re
from datetime import date

_CEP_RE = re.compile(r"^(\d{5})-?(\d{3})$")
_CAMPOS_OBRIGATORIOS = ("idade", "veiculo_ano", "cep")


def cep_valido(cep: str | None) -> bool:
    if not isinstance(cep, str) or not cep:
        return False
    return bool(_CEP_RE.match(cep.strip()))


def normalizar_cep(cep: str | None) -> str | None:
    """CEP no formato `#####-###` quando `cep` bate com o mesmo formato que `cep_valido` aceita
    (com ou sem hífen); `None` caso contrário — dono único de "o que é CEP válido" e "qual o
    formato normalizado" (LEI 11, issue #68): antes disso, `dominio.validacao.cep_valido` aceitava
    CEP sem hífen, mas nada normalizava esse valor para o formato que `dominio.redator_pii` sabe
    mascarar, e ele seguia em claro até a trilha."""
    if not isinstance(cep, str):
        return None
    m = _CEP_RE.match(cep.strip())
    if not m:
        return None
    return f"{m.group(1)}-{m.group(2)}"


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
