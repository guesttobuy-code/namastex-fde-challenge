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
    assert "/api/chat/responder" in html
    assert "/api/planos" in html
    assert "/docs/design/paises.json" in html


def test_render_tem_o_campo_de_objecao_de_preco_com_o_texto_exato_aprovado():
    """Issue #58: texto aprovado pelo dono para o campo de objeção depois do card de preço — não
    pode ser redigitado."""
    html = tela_chat.render()
    assert "Ficou com alguma dúvida sobre o preço? Pode escrever aqui." in html
    assert "habilitarCampoDeObjecao" in html


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
    """Achado da auditoria do PR #62 (13/09/2026): a tela tinha um `.cabecalho` extra, com texto
    de programador ("ligado ao agente real via aplicacao.servico_conversa... /api/chat/*") visível
    para o lead — o protótipo aprovado não tem esse bloco. Removido; a casca (menu + `<title>`)
    continua provada pelo `<title>`/`aria-current`, e o título visível vira o `<h2>` do hero, igual
    ao protótipo."""
    html = tela_chat.render()

    assert "<title>AutoSeguro · Conversas</title>" in html
    assert 'aria-current="page"' in html
    assert "servico_conversa" not in html  # nada de vocabulário de programador na tela do lead
    assert "Faça aqui sua cotação" in html
    assert "sem cadastro · sem compromisso" in html
