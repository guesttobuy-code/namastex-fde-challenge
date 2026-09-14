from interfaces.painel.agrupar import (
    agrupar_por_conversa,
    agrupar_tentativas_em_cotacoes,
    classe_chip_do_estado,
    estado_da_conversa,
    numeros_de_tentativa_ausentes,
    rotulo_de_exibicao,
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


def test_estado_le_o_ultimo_status_alterado_quando_existe():
    """Issue #57, P14 (condição 1 do veredito): `estado_da_conversa` não infere mais de
    `decisao`/`handoff` quando a trilha JÁ tem `status_alterado` — lê direto o campo `para`."""
    eventos = [
        {"evento": "decisao", "tipo": "coletar_informacao"},
        {"evento": "status_alterado", "de": None, "para": "com_o_agente"},
        {"evento": "decisao", "tipo": "encaminhar"},
        {"evento": "handoff", "reason_code": "quote_timeout"},
        {"evento": "status_alterado", "de": "com_o_agente", "para": "aguardando_corretor"},
    ]
    assert estado_da_conversa(eventos) == "aguardando_corretor"


def test_estado_reconstroi_pelo_ultimo_decisao_quando_a_trilha_e_antiga():
    """Trilha SEM `status_alterado` (gravada antes desta frente, ex. `examples/*.jsonl`) — a
    reconstrução usa a MESMA tabela do domínio (dominio.status_conversa), não uma regra própria."""
    eventos = [
        {"evento": "decisao", "tipo": "coletar_informacao"},
        {"evento": "decisao", "tipo": "encaminhar"},
        {"evento": "handoff", "reason_code": "quote_timeout"},
    ]
    assert estado_da_conversa(eventos) == "aguardando_corretor"


def test_estado_le_o_ultimo_decisao_quando_nao_ha_status_alterado():
    eventos = [
        {"evento": "decisao", "tipo": "coletar_informacao"},
        {"evento": "decisao", "tipo": "explicar_cotacao"},
    ]
    assert estado_da_conversa(eventos) == "cotada"


def test_estado_sem_nenhum_sinal_e_com_o_agente():
    assert estado_da_conversa([{"evento": "mensagem_recebida"}]) == "com_o_agente"


def test_rotulo_de_exibicao_traduz_os_5_status_oficiais():
    assert rotulo_de_exibicao("com_o_agente") == "Com o agente"
    assert rotulo_de_exibicao("cotada") == "Cotada"
    assert rotulo_de_exibicao("aguardando_corretor") == "Aguardando corretor"
    assert rotulo_de_exibicao("em_atendimento_humano") == "Em atendimento humano"
    assert rotulo_de_exibicao("encerrada") == "Encerrada"


def test_classe_chip_cobre_todo_estado_conhecido():
    for estado in ("com_o_agente", "cotada", "aguardando_corretor", "em_atendimento_humano", "encerrada"):
        assert classe_chip_do_estado(estado)


def test_classe_chip_de_estado_desconhecido_cai_em_neutra():
    assert classe_chip_do_estado("estado que não existe") == "neutra"


def test_agrupar_tentativas_em_cotacoes_junta_pelo_reset_do_numero_da_tentativa():
    """Medido na trilha real do #35: cada tentativa tem o seu PRÓPRIO `quote_attempt_id"
    (infra/cliente_quote.py:163, "correlação, não idempotência") — agrupar por id juntaria zero
    tentativas por grupo. `numero_da_tentativa == 1` é o único sinal confiável de cotação nova."""
    eventos = [
        {"evento": "tentativa_de_cotacao", "quote_attempt_id": "a1", "numero_da_tentativa": 1},
        {"evento": "mensagem_recebida"},
        {"evento": "tentativa_de_cotacao", "quote_attempt_id": "a2", "numero_da_tentativa": 2},
        {"evento": "tentativa_de_cotacao", "quote_attempt_id": "a3", "numero_da_tentativa": 1},
    ]

    grupos = agrupar_tentativas_em_cotacoes(eventos)

    assert [e["numero_da_tentativa"] for e in grupos[0]] == [1, 2]
    assert [e["numero_da_tentativa"] for e in grupos[1]] == [1]


def test_agrupar_tentativas_em_cotacoes_de_lista_vazia():
    assert agrupar_tentativas_em_cotacoes([]) == []


def test_numeros_de_tentativa_ausentes_detecta_o_buraco_no_meio():
    """Achado da coordenação: a ESPECIFICACAO.md não tem `cotacao_id`, só `numero_da_tentativa` —
    o painel infere o grupo pela ordem. Uma trilha parcial (1, 3, sem o 2) não pode desaparecer
    nessa inferência: o buraco é da tentativa que falta, não do agrupamento."""
    grupo = [
        {"numero_da_tentativa": 1},
        {"numero_da_tentativa": 3},
    ]
    assert numeros_de_tentativa_ausentes(grupo) == [2]


def test_numeros_de_tentativa_ausentes_de_grupo_completo_e_vazio():
    grupo = [{"numero_da_tentativa": 1}, {"numero_da_tentativa": 2}, {"numero_da_tentativa": 3}]
    assert numeros_de_tentativa_ausentes(grupo) == []


def test_numeros_de_tentativa_ausentes_de_grupo_vazio():
    assert numeros_de_tentativa_ausentes([]) == []
