import re

from interfaces.painel import tela_conversas


def test_mensagem_com_html_e_escapada():
    """A tela ganhou um `<script>` LEGÍTIMO nesta frente (filtro/botões, issue #57, P14) — o teste
    não pode mais checar "nenhum <script> na página inteira"; passa a injetar o payload numa
    mensagem do LEAD (conteúdo não confiável) e confere que ele sai escapado, não executável."""
    eventos = [{
        "evento": "mensagem_recebida", "conversation_id": "conv_xss", "id": "m1",
        "instante": "2026-09-12T10:00:00", "texto": "<script>alert(1)</script>",
    }]
    html = tela_conversas.render(eventos)
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html


def test_conversas_da_fixture_aparecem_com_estado(trilha_fixture):
    """Issue #57 (P14): os rótulos mudaram para os 5 status oficiais — `conv_a41f` (decisão
    `explicar_cotacao`) é "Cotada"; `conv_b93c` (`handoff` sem `decisao` correspondente na
    fixture, achado ao atualizar esta trilha) reconstrói para "Aguardando corretor"."""
    html = tela_conversas.render(trilha_fixture)
    assert "conv_a41f" in html
    assert "conv_b93c" in html
    assert "Cotada" in html
    assert "Aguardando corretor" in html
    assert 'data-status="cotada"' in html
    assert 'data-status="aguardando_corretor"' in html


def test_sem_eventos_mostra_buraco():
    html = tela_conversas.render([])
    assert "ausente na trilha" in html


def test_apenas_uma_conversa_fica_visivel_por_vez(trilha_fixture):
    """S13 (pedido do dono ao testar a tela): caixa de entrada de verdade — lista à esquerda, UMA
    conversa por vez à direita, `hidden` nas outras. Testa o HTML gerado pelo servidor (antes do
    JS rodar), que é quem decide a seleção INICIAL."""
    html = tela_conversas.render(trilha_fixture)
    secoes = re.findall(r'<section class="painel conversa"[^>]*>', html)
    assert len(secoes) == 2
    ocultas = [s for s in secoes if "hidden" in s]
    assert len(ocultas) == 1


def test_conversa_mais_recente_fica_visivel_por_padrao(trilha_fixture):
    """"Mais recente" = última a aparecer na trilha (`agrupar_por_conversa` preserva a ordem de
    primeira aparição) — `conv_b93c` vem depois de `conv_a41f` em `construir_trilha_fixture`."""
    html = tela_conversas.render(trilha_fixture)
    secao_recente = re.search(r'<section class="painel conversa" id="conv_b93c"[^>]*>', html).group()
    assert "hidden" not in secao_recente
    secao_antiga = re.search(r'<section class="painel conversa" id="conv_a41f"[^>]*>', html).group()
    assert "hidden" in secao_antiga


def test_item_da_conversa_selecionada_tem_a_classe_selecionado(trilha_fixture):
    html = tela_conversas.render(trilha_fixture)
    assert 'class="item selecionado" data-status="aguardando_corretor" data-alvo="conv_b93c"' in html
    assert 'class="item" data-status="cotada" data-alvo="conv_a41f"' in html


def test_botoes_assumir_e_encerrar_habilitados_conforme_o_status(trilha_fixture):
    """`conv_b93c` está em Aguardando corretor: Assumir E Encerrar são transições válidas dali
    (`dominio.status_conversa.pode_assumir`/`pode_encerrar`) — nenhum dos dois vem `disabled`."""
    html = tela_conversas.render(trilha_fixture)
    assert "onclick=\"transicaoDeStatus('conv_b93c', '/api/conversa/assumir')\">Assumir</button>" in html
    assert "disabled onclick=\"transicaoDeStatus('conv_b93c', '/api/conversa/assumir')\">" not in html
    assert "onclick=\"transicaoDeStatus('conv_b93c', '/api/conversa/encerrar')\">Encerrar</button>" in html
    assert "disabled onclick=\"transicaoDeStatus('conv_b93c', '/api/conversa/encerrar')\">" not in html
