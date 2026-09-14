"""As duas regras que não se negociam do escopo #13: escape sempre, buraco visível nunca vazio."""

from interfaces.painel.campos import buraco, campo, esc, lista, texto_da_resposta


def test_esc_escapa_tag_perigosa():
    saida = esc("<img src=x onerror=alert(1)>")
    assert "<img" not in saida
    assert "&lt;img" in saida


def test_esc_de_none_vira_string_vazia():
    assert esc(None) == ""


def test_campo_ausente_vira_buraco_visivel_nunca_string_vazia():
    saida = campo({}, "regra_aplicada")
    assert saida != ""
    assert "ausente na trilha" in saida
    assert "regra_aplicada" in saida


def test_campo_vazio_tambem_vira_buraco_nao_string_vazia_lisa():
    saida = campo({"regra_aplicada": ""}, "regra_aplicada")
    assert "ausente na trilha" in saida


def test_campo_presente_e_escapado():
    saida = campo({"texto": "<script>alert(1)</script>"}, "texto")
    assert "<script>" not in saida
    assert "&lt;script&gt;" in saida


def test_buraco_escapa_o_nome_do_campo():
    saida = buraco("<x>")
    assert "<x>" not in saida


def test_lista_vazia_vira_buraco():
    assert "ausente" in lista(())
    assert "ausente" in lista(None)


def test_lista_escapa_cada_item():
    saida = lista(("<b>qa_01</b>", "estado.veiculo_ano"))
    assert "<b>" not in saida
    assert "&lt;b&gt;" in saida
    assert "estado.veiculo_ano" in saida


def test_texto_da_resposta_com_chave_vazia_nao_vira_buraco():
    """issue #93: evento REAL de `examples/trilha_conv-453a5245.jsonl`, linha `msg_coleta_3_recebida`
    — o lead apertou Enter sem responder um campo opcional (plano). `texto=""` é resposta vazia
    EXPLÍCITA, nunca o buraco reservado para falha real de gravação."""
    evento = {
        "evento": "mensagem_recebida", "conversation_id": "conv-453a5245", "id": "msg_coleta_3_recebida",
        "instante": "2026-09-14T04:34:33.561133+00:00", "texto": "", "sender_role": "lead",
    }
    saida = texto_da_resposta(evento)
    assert "ausente na trilha" not in saida
    assert saida == '<span class="vazio">(sem resposta — seguiu o padrão)</span>'


def test_texto_da_resposta_com_chave_ausente_continua_buraco():
    """Chave `texto` de fato ausente (falha real de gravação) continua o buraco — só a string
    vazia PRESENTE vira resposta explícita."""
    saida = texto_da_resposta({"evento": "mensagem_recebida"})
    assert "ausente na trilha" in saida


def test_texto_da_resposta_com_texto_de_verdade_e_igual_a_campo():
    evento = {"texto": "80"}
    assert texto_da_resposta(evento) == campo(evento, "texto")
