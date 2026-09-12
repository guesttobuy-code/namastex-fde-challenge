"""Teste de fidelidade (acréscimo de escopo da coordenação na #7): lê a trilha de uma execução
completa e afirma que todo campo que `docs/design/ESPECIFICACAO.md` promete para a tela existe e
está preenchido. Campo que a tela mostra e a trilha não grava reprova aqui — é a amarra que impede o
mock (telas em `docs/design/`) de divergir da implementação.

Também prova a "reconstrução" do "Pronto quando" da #7: dá para dizer o que aconteceu em cada
mensagem e em cada cotação, com id e status, só lendo a trilha.
"""

from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.eventos_trilha import Decisao, Handoff, MensagemEnviada, MensagemRecebida, TentativaDeCotacao
from infra.trilha_jsonl import RepositorioDeTrilhaMemoria

CAMPOS_MENSAGEM_ENVIADA_DA_ESPECIFICACAO = {
    "decisao_id",
    "regra_aplicada",
    "origem_do_texto",
    "dados_usados",
    "quote_attempt_id",
}


def _conversa_completa() -> tuple[str, ServicoDeTrilha, RepositorioDeTrilhaMemoria]:
    conversation_id = "conv_fidelidade_01"
    repositorio = RepositorioDeTrilhaMemoria()
    servico = ServicoDeTrilha(repositorio)

    servico.registrar_evento(
        MensagemRecebida(
            evento="mensagem_recebida",
            conversation_id=conversation_id,
            id="msg_01",
            instante="2026-09-12T10:00:00",
            texto="Oi, quero um seguro pro meu Corolla 2008",
        )
    )
    servico.registrar_evento(
        TentativaDeCotacao(
            evento="tentativa_de_cotacao",
            conversation_id=conversation_id,
            id="qa_01",
            instante="2026-09-12T10:00:05",
            numero_da_tentativa=1,
            http_status=200,
            classificacao="sucesso",
            latencia_ms=280,
            orcamento_restante_ms=2720,
            quote_attempt_id="qa_01",
            premio_mensal=189.90,
            franquia=1200.0,
        )
    )
    servico.registrar_evento(
        Decisao(
            evento="decisao",
            conversation_id=conversation_id,
            id="dec_01",
            instante="2026-09-12T10:00:06",
            tipo="responder_com_preco",
        )
    )
    servico.registrar_evento(
        MensagemEnviada(
            evento="mensagem_enviada",
            conversation_id=conversation_id,
            id="msg_02",
            instante="2026-09-12T10:00:07",
            texto="Show! Consigo o plano Completo por R$ 189,90/mes.",
            decisao_id="dec_01",
            regra_aplicada="oferta_padrao",
            origem_do_texto="redator_deterministico:v1",
            dados_usados=("qa_01",),
            quote_attempt_id="qa_01",
        )
    )
    return conversation_id, servico, repositorio


def test_todo_campo_de_proveniencia_da_especificacao_existe_e_esta_preenchido():
    conversation_id, _servico, repositorio = _conversa_completa()

    eventos = repositorio.eventos_da_conversa(conversation_id)
    mensagens_enviadas = [e for e in eventos if e["evento"] == "mensagem_enviada"]
    assert mensagens_enviadas, "conversa completa tem que ter ao menos uma mensagem_enviada"

    for evento in mensagens_enviadas:
        faltando = CAMPOS_MENSAGEM_ENVIADA_DA_ESPECIFICACAO - set(evento)
        assert not faltando, f"evento {evento['id']} não tem os campos {faltando} da ESPECIFICACAO.md"
        for campo in CAMPOS_MENSAGEM_ENVIADA_DA_ESPECIFICACAO - {"quote_attempt_id"}:
            assert evento[campo], f"campo {campo!r} existe mas está vazio em {evento['id']}"


def test_mensagem_com_valor_monetario_tem_quote_attempt_id_correspondente():
    conversation_id, _servico, repositorio = _conversa_completa()

    eventos = repositorio.eventos_da_conversa(conversation_id)
    ids_de_cotacao_com_sucesso = {
        e["quote_attempt_id"]
        for e in eventos
        if e["evento"] == "tentativa_de_cotacao" and e["classificacao"] == "sucesso"
    }

    for evento in eventos:
        if evento["evento"] != "mensagem_enviada" or "R$" not in evento["texto"]:
            continue
        assert evento["quote_attempt_id"] in ids_de_cotacao_com_sucesso, (
            f"mensagem {evento['id']} tem preço no texto sem cotação de sucesso correspondente "
            "— é o mesmo invariante da F2/F5 (preço só existe com HTTP 200 correspondente)"
        )


def test_reconstrucao_da_conversa_por_id_e_status():
    conversation_id, _servico, repositorio = _conversa_completa()

    eventos = repositorio.eventos_da_conversa(conversation_id)

    reconstrucao = {e["id"]: e["evento"] for e in eventos}
    assert reconstrucao == {
        "msg_01": "mensagem_recebida",
        "qa_01": "tentativa_de_cotacao",
        "dec_01": "decisao",
        "msg_02": "mensagem_enviada",
    }
    (tentativa,) = [e for e in eventos if e["evento"] == "tentativa_de_cotacao"]
    assert tentativa["http_status"] == 200
    assert tentativa["classificacao"] == "sucesso"


def test_handoff_tem_reason_code_explicito_quando_a_conversa_nao_fecha():
    repositorio = RepositorioDeTrilhaMemoria()
    servico = ServicoDeTrilha(repositorio)
    servico.registrar_evento(
        Handoff(
            evento="handoff",
            conversation_id="conv_handoff_01",
            id="ho_01",
            instante="2026-09-12T10:05:00",
            reason_code="indisponivel_apos_retries",
            contexto_coletado={"veiculo": "Corolla 2008"},
            mensagem_ao_lead="Vou te transferir para um consultor.",
        )
    )

    (evento,) = repositorio.eventos_da_conversa("conv_handoff_01")
    assert evento["reason_code"], "todo handoff tem que ter reason_code explícito (âncora #3, premissa 5)"
