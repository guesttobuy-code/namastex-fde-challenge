"""Adaptador real da porta `RepositorioDeContato` (issue #46, PR 2 de 2, ADR-0005): um arquivo JSON
por lead em `contato/leads/<conversation_id>.json`, FORA do git (`contato/` entra no `.gitignore` na
Fase B) — decisão registrada em `governance/adr/0005-chat-guiado-estado-e-contato.md`.
`RepositorioDeContatoMemoria` é o dublê determinístico para teste (mesmo molde de
`infra/repositorio_conhecimento_json.py`, #43), para os testes de `aplicacao` não tocarem disco.

`conversation_id` vem de fora (rota HTTP) e vira nome de arquivo — `_validar_conversation_id` é o
dono único da forma segura (slug), mesma técnica de `_validar_id` em
`infra/repositorio_conhecimento_json.py` (LEI 11: não inventar validação nova), para nenhum
`conversation_id` conseguir escapar de `contato/leads/` (path traversal)."""

from __future__ import annotations

import json
import re
from pathlib import Path

from dominio.contato_lead import ContatoLead

_CONVERSATION_ID_VALIDO = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _validar_conversation_id(conversation_id: str) -> None:
    if not _CONVERSATION_ID_VALIDO.match(conversation_id):
        raise ValueError(f"conversation_id inválido: {conversation_id!r}")


def _de_dict(dados: dict) -> ContatoLead:
    return ContatoLead(nome=dados["nome"], whatsapp=dados["whatsapp"], email=dados.get("email"))


def _para_dict(contato: ContatoLead) -> dict:
    return {"nome": contato.nome, "whatsapp": contato.whatsapp, "email": contato.email}


class RepositorioDeContatoJSON:
    def __init__(self, diretorio: Path) -> None:
        self._diretorio = Path(diretorio)

    def salvar(self, conversation_id: str, contato: ContatoLead) -> None:
        _validar_conversation_id(conversation_id)
        self._diretorio.mkdir(parents=True, exist_ok=True)
        caminho = self._diretorio / f"{conversation_id}.json"
        caminho.write_text(
            json.dumps(_para_dict(contato), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def obter(self, conversation_id: str) -> ContatoLead | None:
        _validar_conversation_id(conversation_id)
        caminho = self._diretorio / f"{conversation_id}.json"
        if not caminho.exists():
            return None
        return _de_dict(json.loads(caminho.read_text(encoding="utf-8")))


class RepositorioDeContatoMemoria:
    """Dublê determinístico — mesma interface, sem tocar disco. Para teste de quem consome a porta."""

    def __init__(self) -> None:
        self._contatos: dict[str, ContatoLead] = {}

    def salvar(self, conversation_id: str, contato: ContatoLead) -> None:
        _validar_conversation_id(conversation_id)
        self._contatos[conversation_id] = contato

    def obter(self, conversation_id: str) -> ContatoLead | None:
        return self._contatos.get(conversation_id)
