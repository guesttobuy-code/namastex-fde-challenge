"""Adaptador real da porta `RepositorioDeTrilha` (issue #7): append-only em JSONL, uma linha por
evento, sem banco — "não precisa, e banco custa tempo" (encomenda F4). `RepositorioDeTrilhaMemoria`
é o dublê determinístico para teste (âncora #3 §4: toda porta tem adaptador real e dublê).
"""

from __future__ import annotations

import json
from pathlib import Path


class RepositorioDeTrilhaJSONL:
    def __init__(self, caminho: Path) -> None:
        self._caminho = Path(caminho)

    def registrar(self, evento: dict) -> None:
        self._caminho.parent.mkdir(parents=True, exist_ok=True)
        with self._caminho.open("a", encoding="utf-8") as arquivo:
            arquivo.write(json.dumps(evento, ensure_ascii=False) + "\n")

    def eventos_da_conversa(self, conversation_id: str) -> list[dict]:
        if not self._caminho.exists():
            return []
        eventos = []
        with self._caminho.open(encoding="utf-8") as arquivo:
            for linha in arquivo:
                evento = json.loads(linha)
                if evento.get("conversation_id") == conversation_id:
                    eventos.append(evento)
        return eventos


class RepositorioDeTrilhaMemoria:
    """Dublê determinístico — mesma interface, sem tocar disco. Para teste de quem consome a porta."""

    def __init__(self) -> None:
        self._eventos: list[dict] = []

    def registrar(self, evento: dict) -> None:
        self._eventos.append(dict(evento))

    def eventos_da_conversa(self, conversation_id: str) -> list[dict]:
        return [e for e in self._eventos if e.get("conversation_id") == conversation_id]
