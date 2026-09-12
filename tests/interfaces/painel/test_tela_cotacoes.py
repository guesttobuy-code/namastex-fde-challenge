from interfaces.painel import tela_cotacoes


def test_uma_linha_por_tentativa_nao_por_cotacao(trilha_fixture):
    html = tela_cotacoes.render(trilha_fixture)

    assert html.count("qa_7d31·") == 3  # as 3 tentativas da mesma cotação, não 1 linha resumida
    assert "qa_1188·1" in html


def test_kpis_calculados_sobre_a_fixture(trilha_fixture):
    html = tela_cotacoes.render(trilha_fixture)

    # 2 cotações (qa_7d31, qa_1188); só qa_7d31 teve sucesso -> 50,0%
    assert "50.0%" in html


def test_sem_tentativas_mostra_buraco():
    html = tela_cotacoes.render([])
    assert "ausente na trilha" in html
    assert "tentativa_de_cotacao" in html


def test_timeout_com_http_status_zero_nao_mostra_zero_cru():
    """Medido na trilha real do #35: timeout devolve http_status=0 (sem resposta HTTP). Mostrar "0"
    sugeriria um código que não existe; a tela deriva o texto da classificação real."""
    eventos = [{
        "evento": "tentativa_de_cotacao", "conversation_id": "conv_x", "id": "qa_1",
        "quote_attempt_id": "qa_1", "numero_da_tentativa": 1, "http_status": 0,
        "classificacao": "timeout", "latencia_ms": 3617, "orcamento_restante_ms": 0,
    }]

    html = tela_cotacoes.render(eventos)

    assert ">0<" not in html
    assert "sem resposta (timeout)" in html
    assert "3617" in html  # latência > 3000ms não é tratada como erro
