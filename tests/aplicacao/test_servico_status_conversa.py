"""`assumir`/`encerrar` (issue #57, P14, PR 2 de 2) validam a transição contra `dominio.status_conversa`
antes de gravar — nunca gravam uma transição que a tabela do domínio não permite."""

import pytest

from aplicacao.portas.repositorio_de_trilha import RepositorioDeTrilha
from aplicacao.servico_status_conversa import TransicaoDeStatusInvalida, assumir, encerrar, registrar_mudanca_de_status
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


# ── B1, achado da pré-auditoria do PR #87: registrar_mudanca_de_status aplica a tabela de
# transições na GRAVAÇÃO, não só no domínio — sem isso, um turno automático depois de "Encerrar"
# gravava encerrada -> cotada.


def test_registrar_mudanca_de_status_nao_grava_quando_de_e_para_sao_iguais():
    """Dois turnos seguidos no mesmo status (ex.: dois turnos de coleta, ambos COM_O_AGENTE) não
    podem virar dois eventos `status_alterado` — um por turno poluiria a trilha à toa."""
    repositorio = _RepositorioEspiao([_status_evento("conv_1", "com_o_agente")])
    trilha = ServicoDeTrilha(repositorio)

    registrar_mudanca_de_status(trilha, "conv_1", StatusDaConversa.COM_O_AGENTE, origem="automatico")

    assert repositorio.gravados == [_status_evento("conv_1", "com_o_agente")]


def test_registrar_mudanca_de_status_automatica_fora_da_tabela_nao_grava_nem_levanta_erro():
    """Transição automática (turno do lead) fora da tabela do domínio: não pode derrubar o turno
    com uma exceção — o lead não escolheu nada de errado. Só não grava."""
    repositorio = _RepositorioEspiao([_status_evento("conv_1", "encerrada")])
    trilha = ServicoDeTrilha(repositorio)

    registrar_mudanca_de_status(trilha, "conv_1", StatusDaConversa.COTADA, origem="automatico")

    assert repositorio.gravados == [_status_evento("conv_1", "encerrada")]


def test_registrar_mudanca_de_status_manual_fora_da_tabela_levanta_transicao_invalida():
    repositorio = _RepositorioEspiao([_status_evento("conv_1", "encerrada")])
    trilha = ServicoDeTrilha(repositorio)

    with pytest.raises(TransicaoDeStatusInvalida):
        registrar_mudanca_de_status(trilha, "conv_1", StatusDaConversa.COTADA, origem="manual")

    assert repositorio.gravados == [_status_evento("conv_1", "encerrada")]
