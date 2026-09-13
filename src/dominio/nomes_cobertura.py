"""Mapa de nomes legíveis de cobertura — dono único (LEI 11, achado #54): os ids crus vêm da
`/quote`/`/planos` (`quote-service/data/plans.json`) em minúsculo e sem acento; este módulo é o
único lugar que traduz id -> nome para o texto que o lead lê. Id fora do mapa aparece como veio —
nunca inventa nome (LEI 2)."""
from __future__ import annotations

_NOMES: dict[str, str] = {
    "colisao": "colisão",
    "roubo": "roubo",
    "furto": "furto",
    "terceiros": "terceiros",
    "vidros": "vidros",
    "carro_reserva": "carro reserva",
    "assistencia_24h": "assistência 24h",
}


def nome_legivel(id_cobertura: str) -> str:
    return _NOMES.get(id_cobertura, id_cobertura)
