"""Agrupamento puro de eventos da trilha por conversa — nenhuma regra de negócio, só leitura e
rótulo de apresentação a partir do vocabulário que o domínio já publica (`dominio.decisao`).
"""

from __future__ import annotations

from dominio.decisao import TipoDecisao

ROTULO_POR_TIPO_DECISAO = {
    TipoDecisao.EXPLICAR_COTACAO.value: "cotada",
    TipoDecisao.ENCERRAR.value: "recusada",
    TipoDecisao.ENCAMINHAR.value: "handoff",
    TipoDecisao.COTAR.value: "cotando",
    TipoDecisao.COLETAR_INFORMACAO.value: "coletando dados",
}


def agrupar_por_conversa(eventos: list[dict]) -> dict[str, list[dict]]:
    """Agrupa na ordem de chegada — dentro da conversa, e entre conversas (primeira aparição)."""
    por_conversa: dict[str, list[dict]] = {}
    for evento in eventos:
        conversation_id = evento.get("conversation_id") or "?"
        por_conversa.setdefault(conversation_id, []).append(evento)
    return por_conversa


def estado_da_conversa(eventos_da_conversa: list[dict]) -> str:
    """Estado de apresentação, lido do último evento `decisao` ou `handoff` — nunca calculado.

    Um `handoff` sempre vence porque é o desfecho declarado da conversa; na ausência de um, o
    último `decisao` manda. Sem nenhum dos dois, a conversa ainda está em andamento.
    """
    if any(evento.get("evento") == "handoff" for evento in eventos_da_conversa):
        return "handoff"
    decisoes = [e for e in eventos_da_conversa if e.get("evento") == "decisao"]
    if decisoes:
        return ROTULO_POR_TIPO_DECISAO.get(decisoes[-1].get("tipo"), "em andamento")
    return "em andamento"


_CLASSE_CHIP_POR_ESTADO = {
    "cotada": "cotada", "handoff": "handoff", "recusada": "recusada",
    "cotando": "andamento", "coletando dados": "andamento", "em andamento": "neutra",
}


def classe_chip_do_estado(estado: str) -> str:
    """Classe CSS do `.chip` (já em `docs/design/ui.css`) para o estado de apresentação da conversa."""
    return _CLASSE_CHIP_POR_ESTADO.get(estado, "neutra")


def tentativas_de_cotacao(eventos_da_conversa: list[dict]) -> list[dict]:
    return [e for e in eventos_da_conversa if e.get("evento") == "tentativa_de_cotacao"]


def agrupar_tentativas_por_cotacao(eventos: list[dict]) -> dict[str, list[dict]]:
    """Agrupa `tentativa_de_cotacao` por `quote_attempt_id` — a história do retry de UMA cotação
    é o conjunto de tentativas com o mesmo id, ordenadas por `numero_da_tentativa` na trilha."""
    por_cotacao: dict[str, list[dict]] = {}
    for evento in eventos:
        if evento.get("evento") != "tentativa_de_cotacao":
            continue
        quote_attempt_id = evento.get("quote_attempt_id") or "?"
        por_cotacao.setdefault(quote_attempt_id, []).append(evento)
    return por_cotacao
