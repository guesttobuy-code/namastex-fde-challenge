"""Porta `RepositorioDeContato` (issue #46, PR 2 de 2, ADR-0005): declara a forma de armazenamento
do contato real do lead (nome, WhatsApp, e-mail) em `contato/leads/`.

Quem grava de verdade é `infra/repositorio_contato_json.py`; o dublê determinístico para teste é
`RepositorioDeContatoMemoria`, no mesmo arquivo do adaptador real. `aplicacao` só conhece esta
interface — nunca importa `infra` (mesma disciplina de `RepositorioDeConhecimento`, #43)."""

from __future__ import annotations

from typing import Protocol

from dominio.contato_lead import ContatoLead


class RepositorioDeContato(Protocol):
    def salvar(self, conversation_id: str, contato: ContatoLead) -> None: ...

    def obter(self, conversation_id: str) -> ContatoLead | None: ...
