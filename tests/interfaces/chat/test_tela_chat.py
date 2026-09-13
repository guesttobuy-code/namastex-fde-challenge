"""Tela Conversas — o chat centralizado (issue #46, PR 2 de 2): `render()` só costura a casca
compartilhada (`layout.pagina`) com o fragmento estático do chat — nunca decide layout/fluxo por
conta própria (LEI 11, dono único do menu é `interfaces.painel.layout`). Espelha
`tests/interfaces/conhecimento/test_tela_edicao.py` (mesmo padrão de tela dinâmica)."""

from interfaces.chat import tela_chat


def test_render_chama_layout_pagina_com_os_parametros_certos(monkeypatch):
    capturado = {}

    def _pagina_fake(*, titulo, pagina_ativa, corpo, **_kw):
        capturado["titulo"] = titulo
        capturado["pagina_ativa"] = pagina_ativa
        capturado["corpo"] = corpo
        return "<html-fake>"

    monkeypatch.setattr("interfaces.chat.tela_chat.pagina", _pagina_fake)

    html = tela_chat.render()

    assert html == "<html-fake>"
    assert capturado["titulo"] == "Conversas"
    assert capturado["pagina_ativa"] == "/"
    assert "btn-comecar" in capturado["corpo"]  # o fragmento do chat, intacto


def test_render_le_o_fragmento_do_chat_do_disco_com_o_script_intacto():
    html = tela_chat.render()

    assert "btn-comecar" in html
    assert "/api/chat/cotar" in html
    assert "/api/chat/contato" in html
    assert "/api/chat/contratar" in html
    assert "/api/planos" in html
    assert "/docs/design/paises.json" in html


def test_render_tem_os_textos_exatos_aprovados_pela_issue_46():
    """Os textos aprovados (issue #46, B.2 e B.3.4) não podem ser redigitados — nasce vermelho se
    alguém reescrever a mensagem com outras palavras."""
    html = tela_chat.render()

    assert (
        "Seus dados são usados só para esta cotação e para um corretor falar com você, "
        "conforme a LGPD." in html
    )
    assert (
        "Que bom que você está pesquisando um seguro! A cotação e a contratação precisam ser "
        "feitas por um adulto, com 18 anos ou mais. Chame seu pai, sua mãe ou o responsável para "
        "fazer a cotação com os dados dele. Leva poucos minutos, e a gente fica esperando vocês "
        "por aqui." in html
    )


def test_render_esta_dentro_da_casca_compartilhada():
    html = tela_chat.render()

    assert "<h1>Conversas</h1>" in html
    assert "<title>AutoSeguro · Conversas</title>" in html
    assert 'aria-current="page"' in html
