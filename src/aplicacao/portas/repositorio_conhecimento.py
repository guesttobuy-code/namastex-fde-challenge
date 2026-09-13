"""Porta `RepositorioDeConhecimento` (issue #43, F13): declara a forma de armazenamento das fichas
de objeção de preço em `conhecimento/objecoes/`.

Quem grava de verdade é `infra/repositorio_conhecimento_json.py`; o dublê determinístico para
teste é `RepositorioDeConhecimentoMemoria`, no mesmo arquivo do adaptador real. `aplicacao` só
conhece esta interface — nunca importa `infra` (mesma disciplina de `RepositorioDeTrilha`, #7).
"""

from __future__ import annotations

from typing import Protocol


class RepositorioDeConhecimento(Protocol):
    def listar_objecoes(self) -> list[dict]: ...

    def obter_objecao(self, id: str) -> dict | None: ...

    def salvar_objecao(self, id: str, ficha: dict) -> None: ...
