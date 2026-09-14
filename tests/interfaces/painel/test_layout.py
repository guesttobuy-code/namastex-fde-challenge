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


# ── UI-B1/UI-B2, achado da pré-auditoria em navegador do PR #87: medição real com
# `getComputedStyle` mostrou `display:flex` nas três seções com `hidden` e `background:rgb(240,240,240)`
# nos botões Assumir/Encerrar — a regra CSS que faria as duas coisas funcionarem nunca foi servida.


def test_atributo_hidden_tem_regra_css_de_verdade():
    """Sem esta regra, `hidden` fica só um atributo inerte no HTML — o navegador continua
    desenhando o elemento (medido com `getComputedStyle` na tela de conversas, S13)."""
    html = pagina(titulo="X", pagina_ativa="/", corpo="")
    assert "[hidden]{display:none!important}" in html


def test_classe_botao_tem_estilo_definido():
    """`.botao`/`.botao.principal` (usadas por Assumir/Encerrar em `tela_conversas`) precisam de
    uma regra própria — sem ela o navegador aplica o padrão dele (`background:rgb(240,240,240)`,
    medido na auditoria)."""
    html = pagina(titulo="X", pagina_ativa="/", corpo="")
    assert ".botao{" in html
    assert ".botao.principal{" in html


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


def test_menu_nao_tem_mais_o_item_avaliacao():
    """issue #115 (decisão do dono: "exclua essa tela que não tem função ainda"): a tela Avaliação
    só mostrava "eval/casos.jsonl não encontrado" — sai do menu, do gerador e do código."""
    rotulos = [rotulo for _, itens in _ITENS_MENU for _, _, rotulo, _ in itens]
    assert "Avaliação" not in rotulos

    html = pagina(titulo="X", pagina_ativa="/", corpo="")
    assert "avaliacao.html" not in html
    assert "Avaliação" not in html


def test_item_relatorio_fica_no_grupo_atendimento_logo_abaixo_de_fila_humana():
    """Decisão da coordenação (issue #59, PR 2/2): "Relatório" é ferramenta do corretor para
    acompanhar e priorizar leads, não diagnóstico técnico — fica em "Atendimento", não em
    "Observabilidade" (correção de um PLANO anterior que propunha o grupo errado)."""
    grupo_atendimento = next(itens for grupo, itens in _ITENS_MENU if grupo == "Atendimento")
    rotulos = [rotulo for _, _, rotulo, _ in grupo_atendimento]
    assert rotulos.index("Relatório") == rotulos.index("Fila humana") + 1

    html = pagina(titulo="X", pagina_ativa="/", corpo="")
    assert '<a href="/painel/relatorio.html">' in html
    assert "Relatório" in html


def test_css_extra_da_tela_traz_o_segundo_bloco_de_estilo_do_mock():
    from interfaces.painel.layout import css_extra_da_tela
    extra = css_extra_da_tela("rastreio.html")
    assert ".tent" in extra
    assert ".prova" in extra
    # o primeiro bloco (ui.css repetido) não deve vir junto
    assert ":root{" not in extra
