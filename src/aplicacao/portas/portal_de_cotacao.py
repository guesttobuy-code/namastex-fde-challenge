"""Porta `PortalDeCotacao` (issue #6, âncora #3 §4 — uma das seis portas previstas).

Declara a forma; quem chama a `/quote` de verdade é `infra/cliente_quote.py:ClienteQuoteHTTP`, e o
dublê determinístico para teste é `FakePortalDeCotacao`, no mesmo arquivo do adaptador real (padrão
de `infra/trilha_jsonl.py`, issue #7). `aplicacao` só conhece esta interface — nunca importa
`infra` (R2/R3, issue #16).

`aplicacao/portas/` nasce pacote — um arquivo por porta (R3, #16) — para que frentes paralelas
escrevendo portas diferentes não colidam no mesmo arquivo.
"""

from __future__ import annotations

from typing import Protocol

from dominio.resultado_cotacao import ResultadoDaCotacao


class PortalDeCotacao(Protocol):
    def cotar(self, payload: dict, conversation_id: str) -> ResultadoDaCotacao: ...
