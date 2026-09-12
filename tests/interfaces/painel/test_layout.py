from interfaces.painel.layout import css_embutido, pagina


def test_css_embutido_le_o_ui_css_real_do_desenho():
    css = css_embutido()
    assert ":root{" in css
    assert "--magenta" in css


def test_pagina_marca_o_item_ativo_do_menu():
    html = pagina(titulo="X", pagina_ativa="rastreio.html", corpo="<p>oi</p>")
    assert 'href="rastreio.html" aria-current="page"' in html


def test_pagina_escapa_o_titulo():
    html = pagina(titulo="<script>alert(1)</script>", pagina_ativa="index.html", corpo="")
    assert "<title>AutoSeguro · &lt;script&gt;alert(1)&lt;/script&gt;</title>" in html


def test_botao_desabilitado_recebe_estilo_visivel():
    html = pagina(titulo="X", pagina_ativa="index.html", corpo="")
    assert "button[disabled]" in html


def test_css_extra_da_tela_traz_o_segundo_bloco_de_estilo_do_mock():
    from interfaces.painel.layout import css_extra_da_tela
    extra = css_extra_da_tela("rastreio.html")
    assert ".tent" in extra
    assert ".prova" in extra
    # o primeiro bloco (ui.css repetido) não deve vir junto
    assert ":root{" not in extra
