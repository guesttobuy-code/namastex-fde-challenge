"""Vermelho-antes do caso de uso do contato (issue #46, PR 2 de 2, ADR-0005): `ServicoDeContato`
orquestra domínio (`ContatoLead`, que valida nome/whatsapp obrigatórios) + porta, mesma disciplina
de `ServicoDeConhecimento` (#43). Dublê em memória — nunca toca disco."""

from __future__ import annotations

import pytest

from aplicacao.servico_contato import ServicoDeContato
from dominio.contato_lead import ContatoLead
from infra.repositorio_contato_json import RepositorioDeContatoMemoria


def _servico() -> ServicoDeContato:
    return ServicoDeContato(RepositorioDeContatoMemoria())


def test_salvar_persiste_e_devolve_o_contato_lead():
    servico = _servico()
    contato = servico.salvar("conv-1", nome="Ursula Souza", whatsapp="+55 21 97224-2584")
    assert contato == ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584")


def test_salvar_aceita_email_opcional():
    servico = _servico()
    contato = servico.salvar(
        "conv-1", nome="Ursula Souza", whatsapp="+55 21 97224-2584", email="ursula@example.com"
    )
    assert contato.email == "ursula@example.com"


def test_obter_devolve_o_que_foi_salvo():
    servico = _servico()
    servico.salvar("conv-1", nome="Ursula Souza", whatsapp="+55 21 97224-2584")
    assert servico.obter("conv-1") == ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584")


def test_obter_conversation_id_sem_contato_devolve_none():
    servico = _servico()
    assert servico.obter("nao-existe") is None


def test_salvar_sem_nome_e_recusado_e_nada_e_persistido():
    servico = _servico()
    with pytest.raises(ValueError, match="Nome completo"):
        servico.salvar("conv-1", nome="", whatsapp="+55 21 97224-2584")
    assert servico.obter("conv-1") is None


def test_salvar_sem_whatsapp_e_recusado_e_nada_e_persistido():
    servico = _servico()
    with pytest.raises(ValueError, match="WhatsApp"):
        servico.salvar("conv-1", nome="Ursula Souza", whatsapp="")
    assert servico.obter("conv-1") is None
