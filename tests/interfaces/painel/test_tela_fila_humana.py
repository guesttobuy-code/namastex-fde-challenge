import re

from dominio.contato_lead import ContatoLead
from dominio.decisao import MotivoHandoff

from interfaces.painel import tela_fila_humana
from interfaces.painel.tela_fila_humana import _DESCRICAO_MOTIVO


def test_handoff_da_fixture_aparece_com_motivo_e_contexto(trilha_fixture):
    html = tela_fila_humana.render(trilha_fixture)

    assert "conv_b93c" in html
    assert "quote_indisponivel" in html
    assert "HB20 2021" in html


def test_botoes_de_acao_ficam_desabilitados_com_motivo(trilha_fixture):
    html = tela_fila_humana.render(trilha_fixture)

    assert "disabled" in html
    assert "requer servidor" in html


def test_regra_de_regras_a_lista_exibida_e_exatamente_a_do_enum():
    """Escopo #13, prova exigida: a lista de reason_code na tela é igual a
    `[m.value for m in MotivoHandoff]` — se alguém acrescentar um motivo ao Enum, a tela acompanha
    sem edição."""
    html = tela_fila_humana.render([])

    exibidos = set(re.findall(r'<div class="regra"><code>([^<]+)</code>', html))

    assert exibidos == {m.value for m in MotivoHandoff}


def test_todo_motivohandoff_tem_descricao_registrada():
    """Pedido da coordenação (issue #42): sem este teste, um `MotivoHandoff` novo sem entrada em
    `_DESCRICAO_MOTIVO` cai em silêncio no fallback "sem descrição registrada" — nenhum outro
    teste pegava esse silêncio antes desta issue."""
    sem_descricao = {m.value for m in MotivoHandoff} - set(_DESCRICAO_MOTIVO.keys())
    assert not sem_descricao, f"MotivoHandoff sem entrada em _DESCRICAO_MOTIVO: {sem_descricao}"


def test_sem_handoff_mostra_buraco():
    eventos = [{"evento": "mensagem_recebida", "conversation_id": "conv_x", "id": "msg_01"}]
    html = tela_fila_humana.render(eventos)
    assert "ausente na trilha" in html


def test_campo_ausente_no_contexto_coletado_vira_buraco_nao_branco():
    """Bug confirmado na Análise de impacto da #46: `_cartao` usa `esc(v)` para cada valor do
    `contexto_coletado`, e `esc(None)` devolve string vazia — um campo ausente (ex.: `idade`
    nunca coletada) aparecia como `idade: ,` (branco), escondendo o buraco em vez de mostrá-lo
    (ESPECIFICACAO.md §3, regra 2 de `campos.py`). Nasce vermelho antes do fix `esc(v)` ->
    `campo(contexto, k)`."""
    eventos = [{
        "evento": "handoff", "conversation_id": "conv_y", "id": "ho_01",
        "instante": "2026-09-13T10:00:00", "reason_code": "quote_indisponivel",
        "mensagem_ao_lead": "Vou te encaminhar para um corretor.",
        "contexto_coletado": {"idade": None, "veiculo_ano": 2021},
    }]

    html = tela_fila_humana.render(eventos)

    assert "idade: ," not in html
    assert "ausente na trilha" in html
    assert "veiculo_ano: 2021" in html


# ── contato do lead (issue #46, PR 2 de 2, ADR-0005, item C.3) ─────────────


def test_card_com_contato_mostra_nome_e_whatsapp(trilha_fixture):
    contatos = {"conv_b93c": ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584")}

    html = tela_fila_humana.render(trilha_fixture, contatos=contatos)

    assert "Ursula Souza" in html
    assert "+55 21 97224-2584" in html
    assert "não informado" not in html


def test_card_sem_contato_mostra_nao_informado(trilha_fixture):
    html = tela_fila_humana.render(trilha_fixture, contatos={})

    assert "não informado" in html


def test_card_sem_o_parametro_contatos_mostra_nao_informado():
    """`contatos=None` (default, chamador que ainda não passa o parâmetro — aditivo) não quebra:
    a Fila humana continua funcionando, só sem nome/WhatsApp — mesmo comportamento de hoje."""
    eventos = [{
        "evento": "handoff", "conversation_id": "conv_sem_contato", "id": "ho_01",
        "instante": "2026-09-13T10:00:00", "reason_code": "quote_indisponivel",
        "mensagem_ao_lead": "Vou te encaminhar para um corretor.",
        "contexto_coletado": {"idade": 30},
    }]

    html = tela_fila_humana.render(eventos)

    assert "não informado" in html
    assert "conv_sem_contato" in html


def test_card_de_handoff_que_nao_e_lead_quer_contratar_tambem_mostra_o_contato_quando_existe(trilha_fixture):
    """Decisão desta frente (ver docstring do módulo): o contato aparece em QUALQUER handoff, não
    só `lead_quer_contratar` — `conv_b93c` na fixture tem `reason_code=quote_indisponivel`, e o
    resto do card (motivo, contexto coletado) continua exatamente como antes (nada quebrou)."""
    contatos = {"conv_b93c": ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584")}

    html = tela_fila_humana.render(trilha_fixture, contatos=contatos)

    assert "quote_indisponivel" in html
    assert "HB20 2021" in html  # contexto_coletado da fixture, intacto
    assert "Ursula Souza" in html
