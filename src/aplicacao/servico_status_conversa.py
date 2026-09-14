"""Casos de uso do status da conversa (issue #57, P14, PR 2 de 2): `registrar_mudanca_de_status` é
o dono único (LEI 11) de COMO um `MudancaDeStatus` é gravado na trilha — usada pelo turno
automático (`aplicacao.servico_conversa.registrar_status_do_turno`, chamado de `conduzir_conversa`)
E pela resposta orientada (`aplicacao.servico_resposta_orientada.processar_mensagem_livre`, issue
#58, S8 — a IA esgota as tentativas e encaminha, fora do fluxo de `conduzir_conversa`), além das
transições MANUAIS abaixo (`assumir`/`encerrar`, os botões da tela de conversas). Todas as decisões
de QUAL status ("pode assumir?", "que status vem depois desta decisão?") continuam 100% no domínio
(`dominio.status_conversa`) — esta camada só sabe COMO gravar, nunca decide."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.eventos_trilha import MudancaDeStatus
from dominio.status_conversa import StatusDaConversa, pode_assumir, pode_encerrar, status_atual_da_conversa


class TransicaoDeStatusInvalida(ValueError):
    """A transição pedida (assumir/encerrar) não é permitida a partir do status atual da conversa."""


def _agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _novo_id(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex[:8]}"


def registrar_mudanca_de_status(
    trilha: ServicoDeTrilha, conversation_id: str, novo_status: StatusDaConversa, *, origem: str
) -> None:
    """Grava `MudancaDeStatus` na trilha. `de` é lido da PRÓPRIA trilha (nunca recebido por
    parâmetro) — um único lugar decide "qual era o status anterior", nunca dois lugares que
    poderiam divergir. `origem`: `"automatico"` (a cada turno) ou `"manual"` (botão)."""
    status_anterior = status_atual_da_conversa(trilha.eventos_da_conversa(conversation_id))
    trilha.registrar_evento(
        MudancaDeStatus(
            evento="status_alterado",
            conversation_id=conversation_id,
            id=_novo_id("status"),
            instante=_agora_iso(),
            de=status_anterior.value if status_anterior is not None else None,
            para=novo_status.value,
            origem=origem,
        )
    )


def assumir(conversation_id: str, trilha: ServicoDeTrilha) -> StatusDaConversa:
    """"Assumir" (botão do corretor na tela de conversas): só válido a partir de AGUARDANDO_CORRETOR."""
    status_atual = status_atual_da_conversa(trilha.eventos_da_conversa(conversation_id))
    if not pode_assumir(status_atual):
        raise TransicaoDeStatusInvalida(f"não é possível assumir a partir de {status_atual!r}")
    novo_status = StatusDaConversa.EM_ATENDIMENTO_HUMANO
    registrar_mudanca_de_status(trilha, conversation_id, novo_status, origem="manual")
    return novo_status


def encerrar(conversation_id: str, trilha: ServicoDeTrilha) -> StatusDaConversa:
    """"Encerrar" (botão do corretor): válido a partir de AGUARDANDO_CORRETOR ou EM_ATENDIMENTO_HUMANO
    (o corretor pode encerrar sem ter assumido antes)."""
    status_atual = status_atual_da_conversa(trilha.eventos_da_conversa(conversation_id))
    if not pode_encerrar(status_atual):
        raise TransicaoDeStatusInvalida(f"não é possível encerrar a partir de {status_atual!r}")
    novo_status = StatusDaConversa.ENCERRADA
    registrar_mudanca_de_status(trilha, conversation_id, novo_status, origem="manual")
    return novo_status
