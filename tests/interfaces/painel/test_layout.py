from interfaces.painel import tela_conversas
from interfaces.painel.layout import _ITENS_MENU, css_embutido, pagina


def test_css_embutido_le_o_ui_css_real_do_desenho():
    css = css_embutido()
    assert ":root{" in css
    assert "--magenta" in css


def test_pagina_marca_o_item_ativo_do_menu():
    html = pagina(titulo="X", pagina_ativa="/painel/rastreio.html", corpo="<p>oi</p>")
    assert 'href="/painel/rastreio.html" aria-current="page"' in html


def test_menu_tem_grupo_insumos_com_a_base_de_conhecimento():
    html = pagina(titulo="X", pagina_ativa="/", corpo="")
    assert "Insumos" in html
    assert '<a href="/conhecimento">' in html
    assert "Base de conhecimento" in html


def test_pagina_escapa_o_titulo():
    html = pagina(titulo="<script>alert(1)</script>", pagina_ativa="/", corpo="")
    assert "<title>AutoSeguro · &lt;script&gt;alert(1)&lt;/script&gt;</title>" in html


def test_botao_desabilitado_recebe_estilo_visivel():
    html = pagina(titulo="X", pagina_ativa="/", corpo="")
    assert "button[disabled]" in html


def test_titulo_da_tela_bate_com_o_rotulo_do_menu():
    """Achado B2 da auditoria do PR #47 (issue #46): o item do menu ficou ativo em
    "Histórico de atendimentos" enquanto a página ainda dizia "Conversas" — os dois vinham de
    lugares diferentes e um foi renomeado sem o outro. Trava contra a próxima vez: lê o RÓTULO
    real do item `/painel/index.html` em `_ITENS_MENU` (dono único do menu) e confere que o
    `<h1>` da tela é exatamente esse rótulo, não uma string redigitada aqui. (Fica em
    `test_layout.py`, não em `test_tela_conversas.py`: achado à parte — companion-red-green
    perde o `conftest.py` de `tests/interfaces/painel/` quando `test_tela_conversas.py` e
    `tests/interfaces/test_servidor.py` entram juntos na mesma chamada explícita de pytest;
    reportado como achado de ferramenta, não é bug desta tela.)"""
    rotulo_do_menu = next(
        rotulo
        for _, itens in _ITENS_MENU
        for arquivo, _, rotulo, _ in itens
        if arquivo == "/painel/index.html"
    )
    html = tela_conversas.render([])
    assert f"<h1>{rotulo_do_menu}</h1>" in html


def test_css_extra_da_tela_traz_o_segundo_bloco_de_estilo_do_mock():
    from interfaces.painel.layout import css_extra_da_tela
    extra = css_extra_da_tela("rastreio.html")
    assert ".tent" in extra
    assert ".prova" in extra
    # o primeiro bloco (ui.css repetido) não deve vir junto
    assert ":root{" not in extra
