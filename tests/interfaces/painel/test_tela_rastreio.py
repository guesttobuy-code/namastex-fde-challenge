"""Tela Rastreio: as duas invariantes que não se negociam (escape sempre, buraco nunca vazio) e a
renderização honesta da história de retry sobre a fixture de trilha real (conftest.py)."""

from interfaces.painel import tela_rastreio


def _html(eventos, **kw):
    return tela_rastreio.render(eventos, caminho_ui_css=kw.get("caminho_ui_css"))


def test_mensagem_do_lead_com_script_nao_executa_no_html():
    eventos = [{
        "evento": "mensagem_recebida", "conversation_id": "conv_x", "id": "msg_01",
        "instante": "2026-09-12T10:00:00", "texto": "<img src=x onerror=alert(1)>",
    }]

    html = _html(eventos)

    assert "<img src=x onerror=alert(1)>" not in html
    assert "&lt;img src=x onerror=alert(1)&gt;" in html


def test_regra_aplicada_ausente_vira_buraco_visivel_nao_string_vazia():
    eventos = [{
        "evento": "mensagem_enviada", "conversation_id": "conv_x", "id": "msg_02",
        "instante": "2026-09-12T10:00:01", "texto": "oi",
        "decisao_id": "dec_1", "origem_do_texto": "redator_deterministico:x",
        # regra_aplicada deliberadamente ausente
    }]

    html = _html(eventos)

    assert "ausente na trilha" in html
    assert "regra_aplicada" in html


def test_conversa_cotada_mostra_as_tres_tentativas_de_retry(trilha_fixture):
    html = _html(trilha_fixture)

    assert html.count('class="tent ') == 4  # 3 na conv_a41f (retry) + 1 na conv_b93c
    assert "272.87" in html
    assert "conv_a41f" in html
    assert "conv_b93c" in html


def test_conversa_com_handoff_mostra_reason_code(trilha_fixture):
    html = _html(trilha_fixture)

    assert "quote_indisponivel" in html
    assert "O sistema de cota" in html  # mensagem_ao_lead, escapada mas legível


def test_sem_conversas_mostra_buraco_em_vez_de_pagina_vazia():
    html = _html([])
    assert "ausente na trilha" in html
