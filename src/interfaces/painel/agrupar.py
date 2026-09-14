"""Agrupamento puro de eventos da trilha por conversa — nenhuma regra de negócio, só leitura e
rótulo de apresentação a partir do vocabulário que o domínio já publica (`dominio.status_conversa`,
issue #57, P14 — substituiu `dominio.decisao` como fonte do estado nesta frente).
"""

from __future__ import annotations

from dominio.status_conversa import StatusDaConversa, status_atual_da_conversa

# Rótulo de EXIBIÇÃO — o corretor lê isto na tela. Distinto do valor RAW (`StatusDaConversa.value`,
# ex. "aguardando_corretor") que `estado_da_conversa()` devolve: o raw é o que vira `data-status`
# pro filtro client-side (S10 do roteiro de aceite, #57) e a CHAVE de `classe_chip_do_estado`
# abaixo — nunca o inverso, senão o filtro teria que normalizar acento/maiúscula do texto exibido.
ROTULO_DE_EXIBICAO = {
    StatusDaConversa.COM_O_AGENTE.value: "Com o agente",
    StatusDaConversa.COTADA.value: "Cotada",
    StatusDaConversa.AGUARDANDO_CORRETOR.value: "Aguardando corretor",
    StatusDaConversa.EM_ATENDIMENTO_HUMANO.value: "Em atendimento humano",
    StatusDaConversa.ENCERRADA.value: "Encerrada",
}

# Chip: reaproveita os 5 tokens de cor já existentes em `docs/design/ui.css` (ok/alerta/falha/
# neutra/viva) — nenhuma classe nova. Julgamento de apresentação (não especificado pelo PLAN):
# COM_O_AGENTE/EM_ATENDIMENTO_HUMANO = "viva" (conversa ativa, alguém agindo agora), COTADA = "ok"
# (ponto positivo), AGUARDANDO_CORRETOR = "alerta" (precisa de ação humana), ENCERRADA = "neutra".
_CLASSE_CHIP_POR_STATUS = {
    StatusDaConversa.COM_O_AGENTE.value: "viva",
    StatusDaConversa.COTADA.value: "ok",
    StatusDaConversa.AGUARDANDO_CORRETOR.value: "alerta",
    StatusDaConversa.EM_ATENDIMENTO_HUMANO.value: "viva",
    StatusDaConversa.ENCERRADA.value: "neutra",
}


def agrupar_por_conversa(eventos: list[dict]) -> dict[str, list[dict]]:
    """Agrupa na ordem de chegada — dentro da conversa, e entre conversas (primeira aparição)."""
    por_conversa: dict[str, list[dict]] = {}
    for evento in eventos:
        conversation_id = evento.get("conversation_id") or "?"
        por_conversa.setdefault(conversation_id, []).append(evento)
    return por_conversa


def estado_da_conversa(eventos_da_conversa: list[dict]) -> str:
    """Valor RAW do status (`StatusDaConversa.value`, ex. `"aguardando_corretor"`) — dono único é
    `dominio.status_conversa` (LEI 11, condição 1 do veredito do PLANO do PR 2 da issue #57):
    último evento `status_alterado` se existir; senão reconstrói pelo último `decisao` (trilhas
    ANTIGAS, sem esse evento — `examples/*.jsonl` gravados antes desta frente). Conversa sem
    NENHUM sinal ainda (só `mensagem_recebida`, nem uma `decisao`) cai em COM_O_AGENTE — o estado
    inicial antes da primeira decisão automática."""
    status = status_atual_da_conversa(eventos_da_conversa)
    return (status or StatusDaConversa.COM_O_AGENTE).value


def rotulo_de_exibicao(estado: str) -> str:
    """Traduz o valor RAW (chave de filtro/`data-status`) pro texto que o corretor lê na tela."""
    return ROTULO_DE_EXIBICAO.get(estado, estado)


def classe_chip_do_estado(estado: str) -> str:
    """Classe CSS do `.chip` (já em `docs/design/ui.css`) para o estado RAW da conversa."""
    return _CLASSE_CHIP_POR_STATUS.get(estado, "neutra")


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
