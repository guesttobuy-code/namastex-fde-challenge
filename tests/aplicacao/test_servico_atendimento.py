"""Vermelho-antes do caso de uso do atendimento contínuo (issue #86, PR a): mensagem do corretor
(só depois de "Assumir"), mensagem do lead em espera (grava e decide, via função injetada, se
responde automaticamente) e listar mensagens novas a partir de um id.

`status_atual`/`resposta_automatica_permitida` são recebidos por parâmetro de propósito — a
ligação real com `dominio.status_conversa` só existe depois do merge da #57 PR 2; até lá, os
testes usam dublês de 2 linhas (nunca importam um módulo que não está em `main`)."""

from __future__ import annotations

import pytest

from aplicacao.servico_atendimento import (
    AtendimentoNaoIniciado,
    enviar_mensagem_do_corretor,
    listar_mensagens_desde,
    registrar_mensagem_do_lead_em_espera,
)
from aplicacao.servico_trilha import ServicoDeTrilha
from infra.trilha_jsonl import RepositorioDeTrilhaMemoria


def _sempre_permite(status_atual):  # dublê de 2 linhas — "sem silêncio", A10
    return True


def _nunca_permite(status_atual):  # dublê de 2 linhas — "sempre silenciado", A2/A9
    return False


def _trilha() -> tuple[ServicoDeTrilha, RepositorioDeTrilhaMemoria]:
    repositorio = RepositorioDeTrilhaMemoria()
    return ServicoDeTrilha(repositorio), repositorio


# ── enviar_mensagem_do_corretor: só depois de "Assumir" (A4/A5) ────────────


def test_corretor_responde_com_sucesso_quando_em_atendimento_humano():
    trilha, repositorio = _trilha()
    id_msg = enviar_mensagem_do_corretor(
        trilha, "conv-1", "Oi, sou o corretor, posso ajudar?", status_atual="em_atendimento_humano"
    )
    eventos = repositorio.eventos_da_conversa("conv-1")
    enviada = next(e for e in eventos if e["id"] == id_msg)
    assert enviada["evento"] == "mensagem_enviada"
    assert enviada["sender_role"] == "corretor"
    assert enviada["texto"] == "Oi, sou o corretor, posso ajudar?"


@pytest.mark.parametrize("status_atual", [None, "aguardando_corretor", "cotada", "encerrada"])
def test_corretor_nao_pode_responder_antes_de_assumir(status_atual):
    trilha, repositorio = _trilha()
    with pytest.raises(AtendimentoNaoIniciado, match="Assumir"):
        enviar_mensagem_do_corretor(trilha, "conv-1", "oi", status_atual=status_atual)
    assert repositorio.eventos_da_conversa("conv-1") == []  # nunca grava a tentativa recusada


# ── registrar_mensagem_do_lead_em_espera: grava e decide via função injetada (A2/A9/A10) ──


def test_mensagem_do_lead_grava_sender_role_lead_e_devolve_id():
    trilha, repositorio = _trilha()
    id_msg, _ = registrar_mensagem_do_lead_em_espera(
        trilha, "conv-1", "ainda estou aqui",
        status_atual="aguardando_corretor", resposta_automatica_permitida=_nunca_permite,
    )
    eventos = repositorio.eventos_da_conversa("conv-1")
    recebida = next(e for e in eventos if e["id"] == id_msg)
    assert recebida["evento"] == "mensagem_recebida"
    assert recebida["sender_role"] == "lead"
    assert recebida["texto"] == "ainda estou aqui"


def test_mensagem_do_lead_silenciada_quando_a_funcao_injetada_devolve_false():
    trilha, _ = _trilha()
    _id, deve_responder = registrar_mensagem_do_lead_em_espera(
        trilha, "conv-1", "achei caro",
        status_atual="em_atendimento_humano", resposta_automatica_permitida=_nunca_permite,
    )
    assert deve_responder is False


def test_mensagem_do_lead_nao_silenciada_quando_a_funcao_injetada_devolve_true():
    trilha, _ = _trilha()
    _id, deve_responder = registrar_mensagem_do_lead_em_espera(
        trilha, "conv-1", "achei caro",
        status_atual="com_o_agente", resposta_automatica_permitida=_sempre_permite,
    )
    assert deve_responder is True


def test_mensagem_do_lead_sempre_grava_mesmo_quando_silenciada():
    """A regra de silêncio decide se HÁ resposta automática — nunca se a mensagem do lead é
    guardada. A2: a mensagem tem que chegar ao corretor mesmo sem resposta nenhuma."""
    trilha, repositorio = _trilha()
    registrar_mensagem_do_lead_em_espera(
        trilha, "conv-1", "alguém aí?",
        status_atual="aguardando_corretor", resposta_automatica_permitida=_nunca_permite,
    )
    eventos = repositorio.eventos_da_conversa("conv-1")
    assert any(e["evento"] == "mensagem_recebida" and e["texto"] == "alguém aí?" for e in eventos)


# ── listar_mensagens_desde: função pura, sobre eventos já lidos (A2/A6) ────


def _evento(evento: str, id: str) -> dict:
    return {"evento": evento, "id": id, "conversation_id": "conv-1", "instante": "2026-09-14T00:00:00"}


def test_listar_mensagens_desde_sem_id_devolve_tudo_na_ordem():
    eventos = [_evento("mensagem_recebida", "m1"), _evento("decisao", "d1"), _evento("mensagem_enviada", "m2")]
    assert [e["id"] for e in listar_mensagens_desde(eventos)] == ["m1", "m2"]


def test_listar_mensagens_desde_um_id_devolve_so_as_novas():
    eventos = [
        _evento("mensagem_recebida", "m1"), _evento("mensagem_enviada", "m2"),
        _evento("mensagem_recebida", "m3"), _evento("mensagem_enviada", "m4"),
    ]
    assert [e["id"] for e in listar_mensagens_desde(eventos, depois_de_id="m2")] == ["m3", "m4"]


def test_listar_mensagens_desde_id_que_nao_existe_mais_devolve_tudo_sem_levantar():
    eventos = [_evento("mensagem_recebida", "m1")]
    assert [e["id"] for e in listar_mensagens_desde(eventos, depois_de_id="id-sumiu")] == ["m1"]


def test_listar_mensagens_desde_ignora_eventos_que_nao_sao_mensagem():
    eventos = [_evento("mensagem_recebida", "m1"), _evento("handoff", "h1"), _evento("status_alterado", "s1")]
    assert [e["id"] for e in listar_mensagens_desde(eventos)] == ["m1"]
