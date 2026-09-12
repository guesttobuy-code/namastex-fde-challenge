from infra.exportador_trilha import exportar_execucao
from infra.trilha_jsonl import RepositorioDeTrilhaMemoria


def test_exportar_execucao_lista_os_eventos_da_conversa_em_ordem():
    repositorio = RepositorioDeTrilhaMemoria()
    repositorio.registrar(
        {"evento": "mensagem_recebida", "conversation_id": "conv_1", "id": "msg_01", "instante": "t1"}
    )
    repositorio.registrar(
        {
            "evento": "mensagem_enviada",
            "conversation_id": "conv_1",
            "id": "msg_02",
            "instante": "t2",
            "decisao_id": "dec_01",
            "regra_aplicada": "oferta_padrao",
        }
    )
    repositorio.registrar(
        {"evento": "mensagem_recebida", "conversation_id": "conv_2", "id": "msg_99", "instante": "t9"}
    )

    log = exportar_execucao("conv_1", repositorio)

    assert "conv_1" in log
    assert "msg_01" in log
    assert "msg_02" in log
    assert "decisao=dec_01" in log
    assert "msg_99" not in log, "evento de outra conversa não pode vazar no log exportado"
