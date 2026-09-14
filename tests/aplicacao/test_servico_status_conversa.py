"""`assumir`/`encerrar` (issue #57, P14, PR 2 de 2) validam a transição contra `dominio.status_conversa`
antes de gravar — nunca gravam uma transição que a tabela do domínio não permite."""

import pytest

from aplicacao.portas.repositorio_de_trilha import RepositorioDeTrilha
from aplicacao.servico_status_conversa import TransicaoDeStatusInvalida, assumir, encerrar
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.status_conversa import StatusDaConversa


class _RepositorioEspiao(RepositorioDeTrilha):
    def __init__(self, eventos_existentes: list[dict] | None = None):
        self.gravados: list[dict] = list(eventos_existentes or [])

    def registrar(self, evento: dict) -> None:
        self.gravados.append(evento)

    def eventos_da_conversa(self, conversation_id: str) -> list[dict]:
        return [e for e in self.gravados if e["conversation_id"] == conversation_id]


def _status_evento(conversation_id: str, para: str) -> dict:
    return {
        "evento": "status_alterado",
        "conversation_id": conversation_id,
        "id": "st_0",
        "instante": "2026-09-13T10:00:00",
        "de": None,
        "para": para,
        "origem": "automatico",
    }


def test_assumir_a_partir_de_aguardando_corretor_grava_em_atendimento_humano():
    repositorio = _RepositorioEspiao([_status_evento("conv_1", "aguardando_corretor")])
    trilha = ServicoDeTrilha(repositorio)

    novo_status = assumir("conv_1", trilha)

    assert novo_status == StatusDaConversa.EM_ATENDIMENTO_HUMANO
    (gravado,) = [e for e in repositorio.gravados if e["evento"] == "status_alterado" and e["origem"] == "manual"]
    assert gravado["de"] == "aguardando_corretor"
    assert gravado["para"] == "em_atendimento_humano"
    assert gravado["origem"] == "manual"


def test_assumir_fora_de_aguardando_corretor_e_recusado():
    repositorio = _RepositorioEspiao([_status_evento("conv_1", "com_o_agente")])
    trilha = ServicoDeTrilha(repositorio)

    with pytest.raises(TransicaoDeStatusInvalida):
        assumir("conv_1", trilha)

    assert repositorio.gravados == [_status_evento("conv_1", "com_o_agente")]


@pytest.mark.parametrize("status_inicial", ["aguardando_corretor", "em_atendimento_humano"])
def test_encerrar_a_partir_de_aguardando_corretor_ou_em_atendimento_humano(status_inicial):
    repositorio = _RepositorioEspiao([_status_evento("conv_1", status_inicial)])
    trilha = ServicoDeTrilha(repositorio)

    novo_status = encerrar("conv_1", trilha)

    assert novo_status == StatusDaConversa.ENCERRADA


def test_encerrar_fora_das_origens_permitidas_e_recusado():
    repositorio = _RepositorioEspiao([_status_evento("conv_1", "cotada")])
    trilha = ServicoDeTrilha(repositorio)

    with pytest.raises(TransicaoDeStatusInvalida):
        encerrar("conv_1", trilha)


def test_encerrar_conversa_ja_encerrada_e_recusado():
    repositorio = _RepositorioEspiao([_status_evento("conv_1", "encerrada")])
    trilha = ServicoDeTrilha(repositorio)

    with pytest.raises(TransicaoDeStatusInvalida):
        encerrar("conv_1", trilha)
