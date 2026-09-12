from interfaces.painel.agrupar import (
    agrupar_por_conversa,
    agrupar_tentativas_por_cotacao,
    classe_chip_do_estado,
    estado_da_conversa,
)


def test_agrupar_por_conversa_preserva_ordem_de_chegada():
    eventos = [
        {"conversation_id": "conv_1", "id": "a"},
        {"conversation_id": "conv_2", "id": "b"},
        {"conversation_id": "conv_1", "id": "c"},
    ]

    agrupado = agrupar_por_conversa(eventos)

    assert list(agrupado.keys()) == ["conv_1", "conv_2"]
    assert [e["id"] for e in agrupado["conv_1"]] == ["a", "c"]


def test_agrupar_por_conversa_de_lista_vazia():
    assert agrupar_por_conversa([]) == {}


def test_estado_handoff_vence_mesmo_com_decisao_antes():
    eventos = [
        {"evento": "decisao", "tipo": "coletar_informacao"},
        {"evento": "handoff", "reason_code": "quote_timeout"},
    ]
    assert estado_da_conversa(eventos) == "handoff"


def test_estado_le_o_ultimo_decisao_quando_nao_ha_handoff():
    eventos = [
        {"evento": "decisao", "tipo": "coletar_informacao"},
        {"evento": "decisao", "tipo": "explicar_cotacao"},
    ]
    assert estado_da_conversa(eventos) == "cotada"


def test_estado_sem_decisao_nem_handoff_e_em_andamento():
    assert estado_da_conversa([{"evento": "mensagem_recebida"}]) == "em andamento"


def test_classe_chip_cobre_todo_estado_conhecido():
    for estado in ("cotada", "handoff", "recusada", "cotando", "coletando dados", "em andamento"):
        assert classe_chip_do_estado(estado)


def test_classe_chip_de_estado_desconhecido_cai_em_neutra():
    assert classe_chip_do_estado("estado que não existe") == "neutra"


def test_agrupar_tentativas_por_cotacao_junta_pelo_quote_attempt_id():
    eventos = [
        {"evento": "tentativa_de_cotacao", "quote_attempt_id": "qa_1", "numero_da_tentativa": 1},
        {"evento": "mensagem_recebida"},
        {"evento": "tentativa_de_cotacao", "quote_attempt_id": "qa_1", "numero_da_tentativa": 2},
        {"evento": "tentativa_de_cotacao", "quote_attempt_id": "qa_2", "numero_da_tentativa": 1},
    ]

    agrupado = agrupar_tentativas_por_cotacao(eventos)

    assert [e["numero_da_tentativa"] for e in agrupado["qa_1"]] == [1, 2]
    assert len(agrupado["qa_2"]) == 1
