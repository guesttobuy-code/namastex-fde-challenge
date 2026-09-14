import json
import re
from pathlib import Path

from dominio.contato_lead import ContatoLead

from interfaces.painel import tela_conversas

_RAIZ = Path(__file__).resolve().parents[3]


def _carregar_trilha_real(nome_arquivo: str) -> list[dict]:
    caminho = _RAIZ / "examples" / nome_arquivo
    return [json.loads(linha) for linha in caminho.read_text(encoding="utf-8").splitlines() if linha.strip()]


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


# ── UI-B5, efeito colateral do conserto do UI-B4 (achado da coordenação testando o PR #87): sem
# fallback, a prévia da lista virava `⚠ ausente na trilha` pra TODA conversa do chat guiado, cuja
# única `mensagem_recebida` é o resumo `sistema` (agora, corretamente, excluído da prévia).


def test_previa_de_conversa_so_com_resumo_sistema_mostra_o_status_nao_o_buraco():
    """Chat guiado: a única `mensagem_recebida` é o resumo sintético (issue #39) + o card de
    handoff — nenhuma mensagem de verdade do lead, nenhuma `mensagem_enviada`. A prévia cai no
    rótulo do status (`agrupar.rotulo_de_exibicao`), nunca no buraco técnico."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv_guiado", "id": "m_sys",
         "instante": "2026-09-13T10:00:00",
         "texto": "idade=35; veiculo_ano=2019; cep=[REDIGIDO]; plano_id=completo; data_inicio=2026-10-01",
         "sender_role": "sistema"},
        {"evento": "handoff", "conversation_id": "conv_guiado", "id": "ho_01",
         "instante": "2026-09-13T10:00:01", "reason_code": "lead_pediu_humano",
         "mensagem_ao_lead": "Vou te encaminhar para um corretor.", "contexto_coletado": {}},
    ]

    html = tela_conversas.render(eventos)

    assert '<span class="previa">Aguardando corretor</span>' in html


def test_previa_de_conversa_cotada_mostra_o_resumo_da_cotacao():
    """Issue #59 (PR 2/2): a prévia lê `plano_nome`/`premio_mensal` da ÚLTIMA `tentativa_de_cotacao`
    com sucesso (campo estruturado) — nunca mais casa regex contra o texto do redator (achado da
    pré-auditoria do #87: extrair de texto livre é frágil, quebra se o template mudar)."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv_cotada", "id": "m_sys",
         "instante": "2026-09-13T10:00:00", "texto": "idade=35", "sender_role": "sistema"},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_cotada", "id": "qa_01",
         "instante": "2026-09-13T10:00:01", "classificacao": "sucesso",
         "plano_nome": "Completo", "premio_mensal": 241.38},
        {"evento": "mensagem_enviada", "conversation_id": "conv_cotada", "id": "m_env",
         "instante": "2026-09-13T10:00:01",
         "texto": "Plano Completo: R$ 241,38/mês, franquia R$ 3.000,00. Coberturas: colisão, roubo.",
         "decisao_id": "dec_01", "regra_aplicada": "explicar_cotacao", "origem_do_texto": "redator_deterministico:v1"},
        {"evento": "decisao", "conversation_id": "conv_cotada", "id": "dec_01",
         "instante": "2026-09-13T10:00:01", "tipo": "explicar_cotacao"},
    ]

    html = tela_conversas.render(eventos)

    assert "ausente na trilha" not in html
    assert '<span class="previa">Completo · R$ 241,38/mês</span>' in html


def test_previa_de_conversa_cotada_trilha_antiga_sem_plano_nome_cai_no_status():
    """Trilha antiga (gravada antes do campo `plano_nome` existir): sem `tentativa_de_cotacao`
    estruturada, a prévia não inventa resumo nem quebra — cai no rótulo do status, mesmo
    comportamento de qualquer conversa sem resumo extraível."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv_antiga", "id": "m_sys",
         "instante": "2026-09-13T10:00:00", "texto": "idade=35", "sender_role": "sistema"},
        {"evento": "mensagem_enviada", "conversation_id": "conv_antiga", "id": "m_env",
         "instante": "2026-09-13T10:00:01",
         "texto": "Plano Completo: R$ 241,38/mês, franquia R$ 3.000,00. Coberturas: colisão, roubo.",
         "decisao_id": "dec_01", "regra_aplicada": "explicar_cotacao", "origem_do_texto": "redator_deterministico:v1"},
        {"evento": "decisao", "conversation_id": "conv_antiga", "id": "dec_01",
         "instante": "2026-09-13T10:00:01", "tipo": "explicar_cotacao"},
    ]

    html = tela_conversas.render(eventos)

    assert '<span class="previa">Completo · R$ 241,38/mês</span>' not in html
    assert '<span class="previa">Cotada</span>' in html


def test_previa_de_conversa_com_duas_cotacoes_usa_a_ultima_com_sucesso():
    """Lead troca de plano e cota de novo — a prévia mostra a ÚLTIMA cotação com sucesso, não a
    primeira (mesma disciplina de `tela_relatorio.plano_cotado_da_conversa`)."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv_troca", "id": "m_sys",
         "instante": "2026-09-13T10:00:00", "texto": "idade=35", "sender_role": "sistema"},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_troca", "id": "qa_01",
         "instante": "2026-09-13T10:00:01", "classificacao": "sucesso",
         "plano_nome": "Essencial", "premio_mensal": 119.90},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_troca", "id": "qa_02",
         "instante": "2026-09-13T10:05:00", "classificacao": "sucesso",
         "plano_nome": "Premium", "premio_mensal": 339.90},
        {"evento": "decisao", "conversation_id": "conv_troca", "id": "dec_01",
         "instante": "2026-09-13T10:05:00", "tipo": "explicar_cotacao"},
    ]

    html = tela_conversas.render(eventos)

    assert '<span class="previa">Premium · R$ 339,90/mês</span>' in html


def test_previa_de_conversa_sem_nenhum_evento_de_mensagem_continua_buraco():
    """A conversa não tem `mensagem_recebida` NEM `mensagem_enviada` — isso é perda de dado de
    verdade (falha de gravação), não falta de conteúdo pra resumir; o buraco técnico continua."""
    eventos = [{
        "evento": "handoff", "conversation_id": "conv_so_handoff", "id": "ho_01",
        "instante": "2026-09-13T10:00:00", "reason_code": "quote_indisponivel",
        "mensagem_ao_lead": "Vou te encaminhar para um corretor.", "contexto_coletado": {},
    }]

    html = tela_conversas.render(eventos)

    assert '<span class="previa"><span class="falta">⚠ ausente na trilha: mensagem_recebida</span></span>' in html


def _previa_de(eventos: list[dict]) -> str:
    html = tela_conversas.render(eventos)
    return re.search(r'<span class="previa">(.*?)</span>', html, re.DOTALL).group(1)


def test_previa_de_conversa_nunca_mostra_a_mensagem_do_lead():
    """issue #93 (2º ajuste, achado da coordenação): a mensagem do lead saiu de vez da prévia — uma
    resposta de formulário ("[REDIGIDO]", "80", "2020") não diz nada ao corretor na lista. A prévia
    agora é só (1) o resumo da cotação com sucesso, (2) o rótulo do status, (3) o buraco quando não
    há nenhum evento de mensagem — nunca o texto do lead. Trilha REAL completa de
    `examples/trilha_conv-453a5245.jsonl` (recusa por idade, `decisao tipo=encaminhar`): a prévia é
    o status "Aguardando corretor", não a última resposta do lead ("[REDIGIDO]", o CEP)."""
    eventos = _carregar_trilha_real("trilha_conv-453a5245.jsonl")

    assert _previa_de(eventos) == "Aguardando corretor"


def test_previa_de_conversa_indisponivel_mostra_aguardando_corretor():
    """Trilha REAL completa de `examples/trilha_conv-acca9633.jsonl` (`/quote` indisponível,
    `decisao tipo=encaminhar reason_code=quote_indisponivel`): mesma regra, mesmo resultado."""
    eventos = _carregar_trilha_real("trilha_conv-acca9633.jsonl")

    assert _previa_de(eventos) == "Aguardando corretor"


def test_previa_de_conversa_cotada_trilha_anterior_ao_plano_nome_mostra_o_status():
    """Trilha REAL de `examples/trilha_conv-2bdc86e8.jsonl` (sucesso, `decisao
    tipo=explicar_cotacao`), gravada ANTES do PR #94 — evento `tentativa_de_cotacao` congelado
    aqui (arquivo removido, substituído por `examples/trilha_conv-c2c205cd.jsonl` na regravação
    pós-#94): `_resumo_da_ultima_cotacao` deixou de casar `mensagem_enviada.texto` por regex (#94,
    issue #59 PR 2/2) e passou a exigir o campo ESTRUTURADO `plano_nome` na `tentativa_de_cotacao`
    — que esta trilha antiga não tem. Cai no rótulo do status ("Cotada"), nunca inventa o resumo.
    A trilha nova (`c2c205cd`) já grava `plano_nome` e mostra o resumo —
    `test_previa_de_conversa_cotada_mostra_o_resumo_da_cotacao` logo abaixo cobre esse caso."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv-2bdc86e8", "id": "msg_coleta_0_recebida",
         "instante": "2026-09-14T02:51:36.596647+00:00", "texto": "35", "sender_role": "lead"},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv-2bdc86e8",
         "id": "0d0e1bb0be90443c93c0c48fe48958d8", "instante": "2026-09-14T02:51:36.728337+00:00",
         "numero_da_tentativa": 1, "http_status": 200, "classificacao": "sucesso",
         "premio_mensal": 137.88, "franquia": 4500},
        {"evento": "decisao", "conversation_id": "conv-2bdc86e8", "id": "dec_229dfdb6",
         "instante": "2026-09-14T02:51:36.729207+00:00", "tipo": "explicar_cotacao"},
    ]

    assert _previa_de(eventos) == "Cotada"


def test_previa_de_conversa_cotada_mostra_o_resumo_da_cotacao():
    """Trilha REAL completa de `examples/trilha_conv-c2c205cd.jsonl` (regravada pós-#94, sucesso,
    `decisao tipo=explicar_cotacao`): `tentativa_de_cotacao` já grava `plano_nome`/`premio_mensal`
    estruturados — a prévia mostra o resumo da cotação, não o rótulo do status."""
    eventos = _carregar_trilha_real("trilha_conv-c2c205cd.jsonl")

    assert _previa_de(eventos) == "Essencial · R$ 137,88/mês"


def test_previa_de_conversa_com_plano_nome_estruturado_mostra_o_resumo():
    """issue #93 pós-#94: `_resumo_da_ultima_cotacao` lê `plano_nome`/`premio_mensal` da ÚLTIMA
    `tentativa_de_cotacao` com `classificacao=sucesso` — campo estruturado, não mais regex. Trilha
    sintética no formato novo."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "conv_plano", "id": "m_sys",
         "instante": "2026-09-13T10:00:00", "texto": "idade=35", "sender_role": "sistema"},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_plano", "id": "qa_01",
         "instante": "2026-09-13T10:00:01", "classificacao": "sucesso",
         "plano_nome": "Completo", "premio_mensal": 313.80},
        {"evento": "decisao", "conversation_id": "conv_plano", "id": "dec_01",
         "instante": "2026-09-13T10:00:01", "tipo": "explicar_cotacao"},
    ]

    assert _previa_de(eventos) == "Completo · R$ 313,80/mês"


def test_secao_conversa_mensagem_recebida_com_texto_vazio_nao_vira_buraco():
    """issue #93: mesmo achado do preview, agora no balão da conversa aberta (`_secao_conversa`,
    L294) — achado da coordenação: a caixa de entrada (primeira tela do avaliador) mostrava
    "ausente na trilha" pra cada resposta em branco de um campo opcional."""
    eventos = [{
        "evento": "mensagem_recebida", "conversation_id": "conv-453a5245", "id": "msg_coleta_3_recebida",
        "instante": "2026-09-14T04:34:33.561133+00:00", "texto": "", "sender_role": "lead",
    }]

    html = tela_conversas.render(eventos)

    assert "ausente na trilha: texto" not in html
    assert "(sem resposta — seguiu o padrão)" in html


def test_secao_conversa_sistema_usa_rotulo_compartilhado_de_campos():
    """issue #93: o rótulo do resumo sintético (L292) passa a vir de `campos.ROTULO_RESUMO_DO_SISTEMA`
    — um rótulo, um dono só (LEI 11) — em vez de uma string solta duplicada."""
    from interfaces.painel.campos import ROTULO_RESUMO_DO_SISTEMA

    eventos = [{
        "evento": "mensagem_recebida", "conversation_id": "conv-453a5245", "id": "msg_edcddae8",
        "instante": "2026-09-14T04:34:33.563825+00:00",
        "texto": "idade=80; veiculo_ano=2020; cep=[REDIGIDO]; plano_id=None; data_inicio=None",
        "sender_role": "sistema",
    }]

    html = tela_conversas.render(eventos)

    assert f'<div class="estado-interno">{ROTULO_RESUMO_DO_SISTEMA}</div>' in html
