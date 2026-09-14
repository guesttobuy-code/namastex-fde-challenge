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
from dominio.status_conversa import (
    StatusDaConversa,
    pode_assumir,
    pode_encerrar,
    status_atual_da_conversa,
    transicao_permitida,
)


class TransicaoDeStatusInvalida(ValueError):
    """A transição pedida (assumir/encerrar) não é permitida a partir do status atual da conversa."""


def _agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _novo_id(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex[:8]}"


def registrar_mudanca_de_status(
    trilha: ServicoDeTrilha,
    conversation_id: str,
    novo_status: StatusDaConversa,
    *,
    origem: str,
    eventos_anteriores: list[dict] | None = None,
) -> None:
    """Grava `MudancaDeStatus` na trilha. `de` vem de `eventos_anteriores` quando o CHAMADOR já
    escreveu outros eventos deste MESMO turno antes de chegar aqui (`conduzir_conversa`/
    `processar_mensagem_livre` gravam `decisao`/`mensagem_enviada`/`handoff` primeiro) — sem o
    snapshot, `status_atual_da_conversa` reconstruiria "o status anterior" a partir do PRÓPRIO
    `decisao`/`handoff` que este turno acabou de gravar, nunca do que já existia antes dele
    (achado ao testar o conserto do B1: dois turnos de coleta seguidos gravavam ZERO
    `status_alterado`, porque o segundo turno via o `decisao` do primeiro e concluía "já era esse
    status, não muda nada"). Quando `eventos_anteriores=None` (`assumir`/`encerrar` — nada mais é
    gravado antes), lê a trilha ao vivo — não há contaminação porque não há escrita concorrente.

    `origem`: `"automatico"` (a cada turno) ou `"manual"` (botão).

    Achado da pré-auditoria do PR #87 (B1): sem a checagem de tabela abaixo, um turno automático
    depois de "Encerrar" (ex.: o lead toca "Ver outro plano" na mesma conversa) gravava `encerrada
    -> cotada` — a tabela de transições só era testada no domínio, nunca aplicada na gravação de
    verdade. Duas guardas: (1) `de == para` não grava nada (turno normal repetindo o mesmo status
    não pode poluir a trilha com um evento por turno); (2) transição fora da tabela de
    `dominio.status_conversa.transicao_permitida` — automática: NÃO grava e não levanta erro (não
    pode derrubar o turno do lead, que não escolheu nada de errado); manual (botão): levanta
    `TransicaoDeStatusInvalida`, mesma família de erro que `assumir`/`encerrar` já usam."""
    eventos = eventos_anteriores if eventos_anteriores is not None else trilha.eventos_da_conversa(conversation_id)
    status_anterior = status_atual_da_conversa(eventos)
    if status_anterior == novo_status:
        return
    if not transicao_permitida(status_anterior, novo_status):
        if origem == "manual":
            raise TransicaoDeStatusInvalida(f"não é possível ir de {status_anterior!r} para {novo_status!r}")
        return
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
