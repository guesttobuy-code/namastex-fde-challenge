import re

from dominio.contato_lead import ContatoLead

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


# ── motivo/contato do handoff (S12) — migrado de `test_tela_fila_humana.py` (removida na
# pré-auditoria do PR #87): o que a Fila humana mostrava por conversa agora mora aqui.


def test_card_com_contato_mostra_nome_e_whatsapp(trilha_fixture):
    contatos = {"conv_b93c": ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584")}

    html = tela_conversas.render(trilha_fixture, contatos=contatos)

    assert "Ursula Souza" in html
    assert "+55 21 97224-2584" in html


def test_card_sem_contato_mostra_nao_informado(trilha_fixture):
    html = tela_conversas.render(trilha_fixture, contatos={})

    assert "não informado" in html


def test_card_sem_o_parametro_contatos_mostra_nao_informado_e_nao_quebra():
    """`contatos=None` (default, chamador que ainda não passa o parâmetro — aditivo) não quebra."""
    eventos = [{
        "evento": "handoff", "conversation_id": "conv_sem_contato", "id": "ho_01",
        "instante": "2026-09-13T10:00:00", "reason_code": "quote_indisponivel",
        "mensagem_ao_lead": "Vou te encaminhar para um corretor.", "contexto_coletado": {"idade": 30},
    }]

    html = tela_conversas.render(eventos)

    assert "não informado" in html
    assert "conv_sem_contato" in html


def test_campo_ausente_no_contexto_coletado_vira_nao_informado():
    """Bug original (Análise de impacto da #46, migrado de `test_tela_fila_humana.py`): um campo
    ausente do `contexto_coletado` não pode virar string vazia (`esc(None)`), escondendo o buraco.

    Revisado pelo achado UI-B3 da pré-auditoria em navegador do PR #87: `_contexto_coletado`
    (`aplicacao.servico_conversa`) grava as 6 chaves SEMPRE, mesmo quando o lead nunca chegou a
    informar aquele campo — `None` aqui é "ainda não coletado", não perda de dado da trilha. O
    marcador `⚠ ausente na trilha` fica reservado pra quando o evento `contexto_coletado` inteiro
    falta (`test_card_sem_o_parametro_contatos_mostra_nao_informado_e_nao_quebra` cobre esse caso);
    um campo individual `None` dentro dele mostra "não informado", como qualquer outro dado que o
    lead legitimamente não deu."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv_y", "id": "m1",
         "instante": "2026-09-13T09:59:00", "texto": "quero cotar"},
        {"evento": "handoff", "conversation_id": "conv_y", "id": "ho_01",
         "instante": "2026-09-13T10:00:00", "reason_code": "quote_indisponivel",
         "mensagem_ao_lead": "Vou te encaminhar para um corretor.",
         "contexto_coletado": {"idade": None, "veiculo_ano": 2021}},
    ]

    html = tela_conversas.render(eventos)

    assert "idade: ," not in html
    assert "Idade: não informado" in html
    assert "ausente na trilha" not in html
    assert "Ano do carro: 2021" in html


# ── UI-B3, achado da pré-auditoria em navegador do PR #87: rótulo técnico cru no cartão do
# corretor (`veiculo_ano=`, `plano_id`, data ISO), e "ausente na trilha" pra campo que o lead
# simplesmente nunca informou (não é falha de gravação).


def test_contexto_coletado_usa_rotulos_legiveis_data_br_e_nome_do_plano():
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv_ctx", "id": "m1",
         "instante": "2026-09-13T09:59:00", "texto": "quero falar com um corretor"},
        {"evento": "handoff", "conversation_id": "conv_ctx", "id": "ho_01",
         "instante": "2026-09-13T10:00:00", "reason_code": "lead_pediu_humano",
         "mensagem_ao_lead": "Vou te encaminhar para um corretor.",
         "contexto_coletado": {
             "idade": 35, "veiculo_ano": 2019, "cep": "[REDIGIDO]",
             "plano_id": "completo", "data_inicio": "2026-10-01", "veiculo_modelo": None,
         }},
    ]

    html = tela_conversas.render(eventos)

    assert "veiculo_ano=" not in html
    assert "plano_id" not in html
    assert "Ano do carro: 2019" in html
    assert "CEP: [REDIGIDO]" in html
    assert "Plano: Completo" in html
    assert "Início da vigência: 01/10/2026" in html
    assert "Modelo do carro: não informado" in html
    assert "⚠" not in html


# ── UI-B4, achado da pré-auditoria em navegador do PR #87: o resumo sintético do estado coletado
# (issue #39, `sender_role="sistema"`) desenhado como se fosse texto do lead.


def test_mensagem_de_sistema_nao_vira_balao_de_lead():
    eventos = [{
        "evento": "mensagem_recebida", "conversation_id": "conv_sistema", "id": "m_sys",
        "instante": "2026-09-13T10:00:00",
        "texto": "idade=35; veiculo_ano=2019; cep=[REDIGIDO]; plano_id=completo; data_inicio=2026-10-01",
        "sender_role": "sistema",
    }]

    html = tela_conversas.render(eventos)

    assert 'class="msg lead"' not in html
    assert "idade=35" not in html
    assert 'class="estado-interno">Resumo dos dados coletados</div>' in html


def test_mensagem_de_lead_sem_sender_role_continua_balao_de_lead():
    """Evento antigo, gravado antes de `sender_role` existir na trilha — `.get("sender_role",
    "lead")` trata a ausência da chave como lead, nunca como sistema por padrão."""
    eventos = [{
        "evento": "mensagem_recebida", "conversation_id": "conv_legado", "id": "m_legado",
        "instante": "2026-09-13T10:00:00", "texto": "quero cotar",
    }]

    html = tela_conversas.render(eventos)

    assert 'class="msg lead"' in html
    assert "quero cotar" in html
