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


def agrupar_tentativas_em_cotacoes(eventos: list[dict]) -> list[list[dict]]:
    """Agrupa `tentativa_de_cotacao` consecutivas em cotações — cada grupo começa numa tentativa
    com `numero_da_tentativa == 1`.

    Medido na trilha real do PR #35 (`infra/cliente_quote.py:163`): cada tentativa recebe o seu
    PRÓPRIO `quote_attempt_id` ("correlação, não idempotência") — retries da MESMA cotação não
    compartilham id nenhum. Agrupar por `quote_attempt_id` (como a fixture de desenvolvimento
    sugeria) juntava zero tentativas por grupo contra a trilha real. `numero_da_tentativa == 1` é
    o único sinal confiável de "começou uma cotação nova" que a trilha grava."""
    grupos: list[list[dict]] = []
    for evento in eventos:
        if evento.get("evento") != "tentativa_de_cotacao":
            continue
        if evento.get("numero_da_tentativa") == 1 or not grupos:
            grupos.append([])
        grupos[-1].append(evento)
    return grupos


def numeros_de_tentativa_ausentes(grupo: list[dict]) -> list[int]:
    """A ESPECIFICACAO.md não tem um identificador da COTAÇÃO (só da tentativa) — o painel infere
    o grupo pela ordem de `numero_da_tentativa` na trilha (achado registrado, sugestão de
    `cotacao_id` para depois da entrega). Essa inferência não pode juntar em silêncio uma trilha
    parcial: se a numeração pular (1, 3 — sem o 2), o buraco é da tentativa que falta, não do
    agrupamento. Devolve os números que deveriam existir (1..máximo) e não aparecem no grupo."""
    numeros = {e.get("numero_da_tentativa") for e in grupo}
    numeros_validos = {n for n in numeros if isinstance(n, int)}
    if not numeros_validos:
        return []
    esperado = set(range(1, max(numeros_validos) + 1))
    return sorted(esperado - numeros_validos)
