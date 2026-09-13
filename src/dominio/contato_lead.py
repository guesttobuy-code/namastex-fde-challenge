"""Contato real do lead (issue #46, PR 2 de 2, C.1): nome completo e WhatsApp são OBRIGATÓRIOS
pela decisão do dono (issue #46 e briefing #41, item 5 — "Contato: nome completo e WhatsApp são
obrigatórios"). E-mail é opcional.

Este módulo só valida o DADO — nunca gera id nem grava nada em disco. Persistência é
`aplicacao.servico_contato.ServicoDeContato` + `infra.repositorio_contato_json`, fora daqui
(mesma separação de `dominio.ficha_objecao`, que também só valida FORMA)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ContatoLead:
    nome: str
    whatsapp: str
    email: str | None = None

    def __post_init__(self) -> None:
        if not self.nome or not self.nome.strip():
            raise ValueError("Nome completo é obrigatório para registrar o contato.")
        if not self.whatsapp or not self.whatsapp.strip():
            raise ValueError("WhatsApp é obrigatório para registrar o contato.")
