from interfaces.painel import tela_cotacoes


def test_uma_linha_por_tentativa_nao_por_cotacao(trilha_fixture):
    html = tela_cotacoes.render(trilha_fixture)

    # 3 tentativas da mesma cotação (conv_a41f) + 1 da outra (conv_b93c) = 4 linhas, cada uma com
    # o SEU PRÓPRIO quote_attempt_id (medido na trilha real: id não é compartilhado entre retries).
    assert "qa_7d31_t1·1" in html
    assert "qa_7d31_t2·2" in html
    assert "qa_7d31_t3·3" in html
    assert "qa_1188·1" in html  # conv_b93c: id do evento difere do quote_attempt_id de propósito


def test_kpis_calculados_sobre_a_fixture(trilha_fixture):
    html = tela_cotacoes.render(trilha_fixture)

    # 2 cotações (conv_a41f com 3 tentativas, conv_b93c com 1); só a de conv_a41f teve sucesso -> 50,0%
    assert "50.0%" in html


def test_sem_tentativas_mostra_buraco():
    html = tela_cotacoes.render([])
    assert "ausente na trilha" in html
    assert "tentativa_de_cotacao" in html


def test_absorvidas_por_retry_conta_falha_seguida_de_sucesso_na_mesma_cotacao():
    """Achado da auditoria do PR #37: `taxa_falha = falhas / total_tentativas` rotulado
    "absorvidas por retry" mistura dois conceitos diferentes. Absorvida é a falha que teve sucesso
    DEPOIS, na MESMA cotação — não qualquer falha. Cenário real do PR: uma cotação 500·500·500
    (nunca absorvida, terminou em handoff) e outra 502·502·200 (as duas falhas foram absorvidas).
    Total: 5 falhas, 2 absorvidas -> 40%, não 71,4% (5/7)."""
    eventos = [
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_1", "id": "a1",
         "quote_attempt_id": "a1", "numero_da_tentativa": 1, "http_status": 500,
         "classificacao": "indisponivel", "latencia_ms": 10, "orcamento_restante_ms": 9000},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_1", "id": "a2",
         "quote_attempt_id": "a2", "numero_da_tentativa": 2, "http_status": 500,
         "classificacao": "indisponivel", "latencia_ms": 10, "orcamento_restante_ms": 8000},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_1", "id": "a3",
         "quote_attempt_id": "a3", "numero_da_tentativa": 3, "http_status": 500,
         "classificacao": "indisponivel", "latencia_ms": 10, "orcamento_restante_ms": 7000},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_2", "id": "b1",
         "quote_attempt_id": "b1", "numero_da_tentativa": 1, "http_status": 502,
         "classificacao": "indisponivel", "latencia_ms": 10, "orcamento_restante_ms": 9000},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_2", "id": "b2",
         "quote_attempt_id": "b2", "numero_da_tentativa": 2, "http_status": 502,
         "classificacao": "indisponivel", "latencia_ms": 10, "orcamento_restante_ms": 8000},
        {"evento": "tentativa_de_cotacao", "conversation_id": "conv_2", "id": "b3",
         "quote_attempt_id": "b3", "numero_da_tentativa": 3, "http_status": 200,
         "classificacao": "sucesso", "latencia_ms": 10, "orcamento_restante_ms": 7000},
    ]

    html = tela_cotacoes.render(eventos)

    assert "40.0%" in html
    assert "2 de 5" in html
    assert "71.4%" not in html


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
