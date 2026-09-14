"""Os campos de cada evento batem com o nome usado em `docs/design/ESPECIFICACAO.md` — é o contrato
entre a trilha e as telas que a consomem (F5/F10). Mudar um nome aqui sem mudar lá quebra a tela em
silêncio; este teste é o que pega isso primeiro.
"""

from dominio.eventos_trilha import (
    CorrecaoRegistrada,
    Decisao,
    ErroMarcado,
    Handoff,
    MensagemEnviada,
    MensagemRecebida,
    MudancaDeStatus,
    TentativaDeCotacao,
)

COMUNS = {"evento", "conversation_id", "id", "instante"}


def test_mensagem_enviada_tem_os_campos_de_proveniencia_da_especificacao():
    evento = MensagemEnviada(
        evento="mensagem_enviada",
        conversation_id="conv_1",
        id="msg_02",
        instante="2026-09-12T10:00:00",
        texto="Show! Fica R$ 189,90/mes",
        decisao_id="dec_01",
        regra_aplicada="oferta_padrao",
        origem_do_texto="redator_deterministico:v1",
        dados_usados=("qa_7d31", "estado.veiculo_ano"),
        quote_attempt_id="qa_7d31",
    )
    campos = set(evento.to_dict())
    esperado = COMUNS | {
        "texto",
        "decisao_id",
        "regra_aplicada",
        "origem_do_texto",
        "dados_usados",
        "quote_attempt_id",
    }
    assert campos == esperado


def test_tentativa_de_cotacao_tem_status_latencia_e_classificacao():
    evento = TentativaDeCotacao(
        evento="tentativa_de_cotacao",
        conversation_id="conv_1",
        id="qa_7d31",
        instante="2026-09-12T10:00:00",
        numero_da_tentativa=1,
        http_status=200,
        classificacao="sucesso",
        latencia_ms=340,
        orcamento_restante_ms=2660,
        quote_attempt_id="qa_7d31",
    )
    campos = evento.to_dict()
    assert campos["http_status"] == 200
    assert campos["classificacao"] == "sucesso"
    assert campos["latencia_ms"] == 340


def test_handoff_guarda_reason_code_como_string_nunca_enum():
    evento = Handoff(
        evento="handoff",
        conversation_id="conv_1",
        id="ho_01",
        instante="2026-09-12T10:00:00",
        reason_code="erro_de_payload",
        contexto_coletado={"idade": 35},
        mensagem_ao_lead="Vou te transferir para um consultor.",
    )
    assert isinstance(evento.to_dict()["reason_code"], str)


def test_erro_marcado_copia_proveniencia_em_vez_de_referenciar():
    evento = ErroMarcado(
        evento="erro_marcado",
        conversation_id="conv_1",
        id="err_01",
        instante="2026-09-12T10:00:00",
        mensagem_id="msg_02",
        marcado_por="operador_1",
        proveniencia={"decisao_id": "dec_01", "regra_aplicada": "oferta_padrao"},
    )
    assert evento.to_dict()["proveniencia"] == {"decisao_id": "dec_01", "regra_aplicada": "oferta_padrao"}


def test_correcao_registrada_referencia_o_erro_e_o_alvo():
    evento = CorrecaoRegistrada(
        evento="correcao_registrada",
        conversation_id="conv_1",
        id="cor_01",
        instante="2026-09-12T10:00:00",
        erro_id="err_01",
        comportamento_esperado="não prometer prazo de retorno",
        alvo="politica_de_handoff",
        virou_caso=True,
        caso_id="caso_042",
    )
    campos = evento.to_dict()
    assert campos["alvo"] == "politica_de_handoff"
    assert campos["virou_caso"] is True


def test_mudanca_de_status_guarda_de_para_e_origem():
    evento = MudancaDeStatus(
        evento="status_alterado",
        conversation_id="conv_1",
        id="st_01",
        instante="2026-09-13T10:00:00",
        de="com_o_agente",
        para="aguardando_corretor",
        origem="automatico",
    )
    campos = evento.to_dict()
    assert campos["de"] == "com_o_agente"
    assert campos["para"] == "aguardando_corretor"
    assert campos["origem"] == "automatico"


def test_mudanca_de_status_aceita_de_none_na_primeira_transicao():
    evento = MudancaDeStatus(
        evento="status_alterado",
        conversation_id="conv_1",
        id="st_00",
        instante="2026-09-13T09:59:00",
        de=None,
        para="com_o_agente",
        origem="automatico",
    )
    assert evento.to_dict()["de"] is None


def test_mensagem_recebida_e_decisao_tem_os_campos_comuns():
    recebida = MensagemRecebida(
        evento="mensagem_recebida",
        conversation_id="conv_1",
        id="msg_01",
        instante="2026-09-12T09:59:00",
        texto="Oi, quero um seguro",
    )
    decisao = Decisao(
        evento="decisao",
        conversation_id="conv_1",
        id="dec_01",
        instante="2026-09-12T10:00:00",
        tipo="responder_com_preco",
    )
    assert COMUNS.issubset(recebida.to_dict())
    assert COMUNS.issubset(decisao.to_dict())
