import pytest

from dominio.contato_lead import ContatoLead


def test_cria_com_sucesso_com_nome_whatsapp_e_email():
    contato = ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584", email="ursula@example.com")
    assert contato.nome == "Ursula Souza"
    assert contato.whatsapp == "+55 21 97224-2584"
    assert contato.email == "ursula@example.com"


def test_aceita_email_none():
    contato = ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584")
    assert contato.email is None


def test_rejeita_nome_vazio():
    with pytest.raises(ValueError, match="Nome completo"):
        ContatoLead(nome="", whatsapp="+55 21 97224-2584")


def test_rejeita_nome_so_espaco():
    with pytest.raises(ValueError, match="Nome completo"):
        ContatoLead(nome="   ", whatsapp="+55 21 97224-2584")


def test_rejeita_whatsapp_vazio():
    with pytest.raises(ValueError, match="WhatsApp"):
        ContatoLead(nome="Ursula Souza", whatsapp="")


def test_rejeita_whatsapp_so_espaco():
    with pytest.raises(ValueError, match="WhatsApp"):
        ContatoLead(nome="Ursula Souza", whatsapp="   ")
