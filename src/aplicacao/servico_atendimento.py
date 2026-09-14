"""Casos de uso do atendimento contínuo (issue #86, PR a): mensagem do corretor, mensagem do lead
em espera/atendimento, listar mensagens novas depois de um id.

A ligação real com `dominio.status_conversa` (`StatusDaConversa`,
`resposta_automatica_permitida`) entra depois do merge da #57 PR 2 — até lá, o status atual e a
função que decide se a resposta automática é permitida chegam por PARÂMETRO (o chamador injeta),
para este módulo não importar um módulo que ainda não existe em `main`. Troca de uma linha depois
do merge: quem chama passa a injetar a função/o status de verdade, nada aqui muda.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.eventos_trilha import MensagemEnviada, MensagemRecebida

# issue #86: valor literal, não importado de `dominio.status_conversa` (ainda não existe em
# `main`) — mesmo `.value` de `StatusDaConversa.EM_ATENDIMENTO_HUMANO`, lido em
# `claude/status-da-conversa` `46c68b2`. Trocar pelo Enum real depois do merge da #57 PR 2.
_STATUS_EM_ATENDIMENTO_HUMANO = "em_atendimento_humano"

_EVENTOS_DE_MENSAGEM = frozenset({"mensagem_recebida", "mensagem_enviada"})


class AtendimentoNaoIniciado(ValueError):
    """O corretor tentou responder antes de "Assumir" (A4) — status não é
    `em_atendimento_humano` ainda. Defesa no servidor, nunca só na tela (a mesma disciplina de
    `dominio.status_conversa.TransicaoDeStatusInvalida`, #57 PR 2)."""


def _agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _novo_id(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex[:8]}"


def enviar_mensagem_do_corretor(
    trilha: ServicoDeTrilha, conversation_id: str, texto: str, *, status_atual: str | None
) -> str:
    """Grava `MensagemEnviada` com `sender_role="corretor"` — só quando `status_atual` já é
    `em_atendimento_humano`. Devolve o `id` do evento gravado (A5/A6)."""
    if status_atual != _STATUS_EM_ATENDIMENTO_HUMANO:
        raise AtendimentoNaoIniciado(
            f'corretor não pode responder com status {status_atual!r} — precisa "Assumir" primeiro'
        )
    id_da_mensagem = _novo_id("msg")
    trilha.registrar_evento(
        MensagemEnviada(
            evento="mensagem_enviada",
            conversation_id=conversation_id,
            id=id_da_mensagem,
            instante=_agora_iso(),
            texto=texto,
            decisao_id=_novo_id("atendimento"),
            regra_aplicada="atendimento:corretor",
            origem_do_texto="corretor:manual",
            sender_role="corretor",
        )
    )
    return id_da_mensagem


def registrar_mensagem_do_lead_em_espera(
    trilha: ServicoDeTrilha,
    conversation_id: str,
    texto_bruto: str,
    *,
    status_atual: Any,
    resposta_automatica_permitida: Callable[[Any], bool],
) -> tuple[str, bool]:
    """Grava `MensagemRecebida` (`sender_role="lead"`, mascarada pela MESMA porta de sempre —
    `ServicoDeTrilha.registrar_evento` já redige, LEI 11) e devolve `(id_da_mensagem,
    deve_responder_automaticamente)`. `resposta_automatica_permitida` é INJETADA (A2/A9): até o
    merge da #57 PR 2, quem chama decide a regra; depois,
    `dominio.status_conversa.resposta_automatica_permitida` de verdade, sem mudar esta função."""
    id_da_mensagem = _novo_id("msg")
    trilha.registrar_evento(
        MensagemRecebida(
            evento="mensagem_recebida",
            conversation_id=conversation_id,
            id=id_da_mensagem,
            instante=_agora_iso(),
            texto=texto_bruto,
            sender_role="lead",
        )
    )
    return id_da_mensagem, resposta_automatica_permitida(status_atual)


def listar_mensagens_desde(eventos: list[dict], depois_de_id: str | None = None) -> list[dict]:
    """Filtra `eventos` (já lidos da trilha por quem chama — nunca importa `infra`/`ServicoDeTrilha`
    aqui, função pura) para só `mensagem_recebida`/`mensagem_enviada`, na ordem em que aparecem, a
    partir do evento seguinte a `depois_de_id` (polling do console e da tela do lead — A2/A6).
    `depois_de_id=None`, ou um id que não existe mais nos eventos (conversa reiniciada), devolve o
    histórico inteiro — nunca levanta por um id que sumiu."""
    mensagens = [e for e in eventos if e.get("evento") in _EVENTOS_DE_MENSAGEM]
    if depois_de_id is None:
        return mensagens
    indice = next((i for i, e in enumerate(mensagens) if e.get("id") == depois_de_id), None)
    if indice is None:
        return mensagens
    return mensagens[indice + 1 :]
