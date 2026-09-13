"""Adaptador real da porta `RepositorioDeConhecimento` (issue #43, F13): um arquivo JSON por ficha
em `conhecimento/objecoes/<id>.json`, legível e versionável no git — a decisão registrada em
ADR-0004. `RepositorioDeConhecimentoMemoria` é o dublê determinístico para teste (mesmo molde de
`infra/trilha_jsonl.py`, #7).

`id` vem de fora (rota HTTP) e vira nome de arquivo — `_validar_id` é o dono único da forma segura
(slug), para as duas classes nunca divergirem sobre o que é um id aceitável (LEI 11) e para nenhum
`id` conseguir escapar de `conhecimento/objecoes/` (path traversal)."""

from __future__ import annotations

import json
import re
from pathlib import Path

_ID_VALIDO = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _validar_id(id: str) -> None:
    if not _ID_VALIDO.match(id):
        raise ValueError(f"id de ficha inválido: {id!r}")


class RepositorioDeConhecimentoJSON:
    def __init__(self, diretorio: Path) -> None:
        self._diretorio = Path(diretorio)

    def listar_objecoes(self) -> list[dict]:
        if not self._diretorio.exists():
            return []
        return [
            json.loads(caminho.read_text(encoding="utf-8"))
            for caminho in sorted(self._diretorio.glob("*.json"))
        ]

    def obter_objecao(self, id: str) -> dict | None:
        _validar_id(id)
        caminho = self._diretorio / f"{id}.json"
        if not caminho.exists():
            return None
        return json.loads(caminho.read_text(encoding="utf-8"))

    def salvar_objecao(self, id: str, ficha: dict) -> None:
        _validar_id(id)
        self._diretorio.mkdir(parents=True, exist_ok=True)
        caminho = self._diretorio / f"{id}.json"
        caminho.write_text(
            json.dumps(ficha, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


class RepositorioDeConhecimentoMemoria:
    """Dublê determinístico — mesma interface, sem tocar disco. Para teste de quem consome a porta."""

    def __init__(self) -> None:
        self._fichas: dict[str, dict] = {}

    def listar_objecoes(self) -> list[dict]:
        return [dict(ficha) for ficha in self._fichas.values()]

    def obter_objecao(self, id: str) -> dict | None:
        ficha = self._fichas.get(id)
        return dict(ficha) if ficha is not None else None

    def salvar_objecao(self, id: str, ficha: dict) -> None:
        _validar_id(id)
        self._fichas[id] = dict(ficha)
