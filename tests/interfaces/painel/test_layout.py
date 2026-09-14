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
    # R2 da auditoria do PR #47 (issue #46): o `<title>` também tem que bater com o rótulo do
    # menu, não só o `<h1>` — mesmo achado, segunda etiqueta que pode divergir da primeira.
    assert f"<title>AutoSeguro · {rotulo_do_menu}</title>" in html


def test_item_fila_humana_aponta_para_o_filtro_aguardando_corretor_sem_sumir():
    """S10 do roteiro de aceite (issue #57, PR 2 de 2): o item "Fila humana" NÃO some do menu —
    decisão do dono ("não some, vira atalho") — só o `href` muda pro Histórico já filtrado.
    Afirma o `href`, não a ausência do item (pega quem tentar remover em vez de redirecionar,
    exatamente a regressão nomeada no PLANO)."""
    rotulo, icone = next(
        (rotulo, icone)
        for _, itens in _ITENS_MENU
        for arquivo, icone, rotulo, _ in itens
        if rotulo == "Fila humana"
    )
    assert rotulo == "Fila humana"
    assert icone == "🙋"
    html = pagina(titulo="X", pagina_ativa="/", corpo="")
    assert '<a href="/painel/index.html?status=aguardando_corretor">' in html
    assert "Fila humana" in html


def test_css_extra_da_tela_traz_o_segundo_bloco_de_estilo_do_mock():
    from interfaces.painel.layout import css_extra_da_tela
    extra = css_extra_da_tela("rastreio.html")
    assert ".tent" in extra
    assert ".prova" in extra
    # o primeiro bloco (ui.css repetido) não deve vir junto
    assert ":root{" not in extra
