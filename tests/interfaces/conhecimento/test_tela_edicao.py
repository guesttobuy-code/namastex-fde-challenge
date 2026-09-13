"""Tela Base de conhecimento (issue #46, PR 1 de 2): `render()` só costura a casca compartilhada
(`layout.pagina`) com o fragmento estático do editor — nunca decide layout/CSS por conta própria
(LEI 11, dono único do menu é `interfaces.painel.layout`)."""

from interfaces.conhecimento import tela_edicao


def test_render_chama_layout_pagina_com_os_parametros_certos(monkeypatch):
    capturado = {}

    def _pagina_fake(*, titulo, pagina_ativa, corpo, css_extra="", **_kw):
        capturado["titulo"] = titulo
        capturado["pagina_ativa"] = pagina_ativa
        capturado["corpo"] = corpo
        capturado["css_extra"] = css_extra
        return "<html-fake>"

    monkeypatch.setattr("interfaces.conhecimento.tela_edicao.pagina", _pagina_fake)

    html = tela_edicao.render()

    assert html == "<html-fake>"
    assert capturado["titulo"] == "Base de conhecimento"
    assert capturado["pagina_ativa"] == "/conhecimento"
    assert "/api/objecoes" in capturado["corpo"]  # o fragmento do editor, intacto
    assert capturado["css_extra"]  # css_extra_da_tela("conhecimento.html") leu algo do mock


def test_render_le_o_fragmento_do_editor_do_disco_com_o_script_intacto():
    html = tela_edicao.render()

    assert "campo-id" in html
    assert "campo-tentativas" in html
    assert "carregarConfiguracaoComercial" in html
    assert "/api/configuracao-comercial" in html
