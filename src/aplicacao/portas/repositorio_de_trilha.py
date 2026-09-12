"""Porta `RepositorioDeTrilha` (issue #7, âncora #3 §4 — uma das seis portas previstas).

Declara a forma; quem grava de verdade em JSONL é `infra/trilha_jsonl.py`, e o dublê determinístico
para teste é `RepositorioDeTrilhaMemoria`, no mesmo arquivo do adaptador real. `aplicacao` só conhece
esta interface — nunca importa `infra`.
"""

from __future__ import annotations

from typing import Protocol


class RepositorioDeTrilha(Protocol):
    def registrar(self, evento: dict) -> None: ...

    def eventos_da_conversa(self, conversation_id: str) -> list[dict]: ...
