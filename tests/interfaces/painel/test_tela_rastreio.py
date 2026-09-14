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


def test_mensagem_recebida_com_texto_vazio_nao_vira_buraco():
    """issue #93: evento REAL de `examples/trilha_conv-198a633b.jsonl` (`msg_coleta_4_recebida`)
    — resposta vazia explícita (Enter no campo opcional), nunca o buraco de falha de gravação."""
    eventos = [{
        "evento": "mensagem_recebida", "conversation_id": "conv-198a633b", "id": "msg_coleta_4_recebida",
        "instante": "2026-09-14T02:51:44.070706+00:00", "texto": "", "sender_role": "lead",
    }]

    html = _html(eventos)

    assert "ausente na trilha: texto" not in html
    assert "(sem resposta — seguiu o padrão)" in html


def test_mensagem_recebida_sender_role_sistema_mostra_resumo_nao_lead():
    """issue #93: evento REAL `msg_ce3e6950` (`sender_role="sistema"`) é o resumo sintético da
    coleta (issue #39) — nunca deve sair rotulado como fala do lead."""
    eventos = [{
        "evento": "mensagem_recebida", "conversation_id": "conv-198a633b", "id": "msg_ce3e6950",
        "instante": "2026-09-14T02:51:44.071200+00:00",
        "texto": "idade=80; veiculo_ano=2020; cep=[REDIGIDO]; plano_id=None; data_inicio=None",
        "sender_role": "sistema",
    }]

    html = _html(eventos)

    assert "Resumo dos dados coletados" in html
    assert "idade=80; veiculo_ano=2020" not in html
    assert '<span class="quem">lead</span>' not in html


def test_numeracao_com_buraco_no_meio_mostra_buraco_visivel_na_posicao_certa():
    """Achado da coordenação: sem `cotacao_id` na ESPECIFICACAO, o grupo é inferido pela ordem de
    `numero_da_tentativa` — uma trilha parcial (1, 3, sem o 2) não pode juntar em silêncio o que
    veio depois com o que veio antes."""
    eventos = [
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_gap", "id": "t1",
         "numero_da_tentativa": 1, "http_status": 503, "classificacao": "indisponivel",
         "latencia_ms": 40, "quote_attempt_id": "t1"},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_gap", "id": "t3",
         "numero_da_tentativa": 3, "http_status": 200, "classificacao": "sucesso",
         "latencia_ms": 50, "quote_attempt_id": "t3"},
    ]

    html = _html(eventos)

    assert html.count('class="tent') >= 3  # 1ª real + 2ª buraco + 3ª real (mais o wrapper .tentativas)
    assert "ausente na trilha" in html
    assert "2ª" in html
