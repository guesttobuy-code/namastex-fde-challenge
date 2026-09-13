"""`ServicoDeContato` (issue #46, PR 2 de 2, ADR-0005): caso de uso para salvar/obter o contato real
do lead (nome, WhatsApp, e-mail). Único caminho de escrita/leitura do contato — mesma disciplina de
`ServicoDeConhecimento` (#43): orquestra domínio (`ContatoLead`, que já valida nome/whatsapp
obrigatórios) + porta, nunca reimplementa a validação nem escreve em `dominio.eventos_trilha`."""

from __future__ import annotations

from dominio.contato_lead import ContatoLead

from .portas.repositorio_contato import RepositorioDeContato


class ServicoDeContato:
    def __init__(self, repositorio: RepositorioDeContato) -> None:
        self._repositorio = repositorio

    def salvar(self, conversation_id: str, *, nome: str, whatsapp: str, email: str | None = None) -> ContatoLead:
        contato = ContatoLead(nome=nome, whatsapp=whatsapp, email=email)
        self._repositorio.salvar(conversation_id, contato)
        return contato

    def obter(self, conversation_id: str) -> ContatoLead | None:
        return self._repositorio.obter(conversation_id)
