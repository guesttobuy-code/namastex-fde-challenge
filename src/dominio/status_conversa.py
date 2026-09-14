"""Status da conversa (issue #57, P14) — vocabulário fechado dos 5 status aprovados pelo dono e
as transições permitidas. Dono único (LEI 11): antes desta frente, `interfaces.painel.agrupar`
inferia um rótulo de apresentação próprio a partir da última `decisao`/`handoff` — dois lugares
decidindo "que status é esse". A partir de agora só este módulo decide; `agrupar.py` só traduz
para texto de tela.

Puro, sem IO — não importa `aplicacao`, `infra` nem `interfaces` (contrato do `.importlinter`).
"""
from __future__ import annotations

from enum import Enum

from dominio.decisao import Decisao, TipoDecisao
from dominio.resultado_cotacao import ResultadoDaCotacao


class StatusDaConversa(str, Enum):
    COM_O_AGENTE = "com_o_agente"
    COTADA = "cotada"
    AGUARDANDO_CORRETOR = "aguardando_corretor"
    EM_ATENDIMENTO_HUMANO = "em_atendimento_humano"
    ENCERRADA = "encerrada"


# Transições permitidas por status atual — dono único (LEI 11) de "que troca é válida". `None`
# (conversa sem status ainda) aceita qualquer destino: é a primeira transição da conversa.
_TRANSICOES_PERMITIDAS: dict[StatusDaConversa, frozenset[StatusDaConversa]] = {
    StatusDaConversa.COM_O_AGENTE: frozenset({
        StatusDaConversa.COM_O_AGENTE,
        StatusDaConversa.COTADA,
        StatusDaConversa.AGUARDANDO_CORRETOR,
        StatusDaConversa.ENCERRADA,
    }),
    StatusDaConversa.COTADA: frozenset({
        StatusDaConversa.COTADA,
        StatusDaConversa.COM_O_AGENTE,
        StatusDaConversa.AGUARDANDO_CORRETOR,
        StatusDaConversa.ENCERRADA,
    }),
    StatusDaConversa.AGUARDANDO_CORRETOR: frozenset({
        StatusDaConversa.AGUARDANDO_CORRETOR,
        StatusDaConversa.EM_ATENDIMENTO_HUMANO,
        StatusDaConversa.ENCERRADA,
    }),
    StatusDaConversa.EM_ATENDIMENTO_HUMANO: frozenset({
        StatusDaConversa.EM_ATENDIMENTO_HUMANO,
        StatusDaConversa.ENCERRADA,
    }),
    StatusDaConversa.ENCERRADA: frozenset({StatusDaConversa.ENCERRADA}),
}

# Transições MANUAIS (botão) permitidas por status atual — subconjunto das automáticas. "Assumir"
# só faz sentido a partir de AGUARDANDO_CORRETOR; "Encerrar" a partir de AGUARDANDO_CORRETOR ou
# EM_ATENDIMENTO_HUMANO (decisão da coordenação no veredito do PLANO do PR 2: corretor pode
# encerrar sem assumir).
_ORIGENS_PERMITIDAS_PARA_ASSUMIR = frozenset({StatusDaConversa.AGUARDANDO_CORRETOR})
_ORIGENS_PERMITIDAS_PARA_ENCERRAR = frozenset({
    StatusDaConversa.AGUARDANDO_CORRETOR,
    StatusDaConversa.EM_ATENDIMENTO_HUMANO,
})


def transicao_permitida(de: StatusDaConversa | None, para: StatusDaConversa) -> bool:
    """`de=None` (conversa sem status ainda) sempre aceita — é a primeira transição."""
    if de is None:
        return True
    return para in _TRANSICOES_PERMITIDAS.get(de, frozenset())


def pode_assumir(de: StatusDaConversa | None) -> bool:
    return de in _ORIGENS_PERMITIDAS_PARA_ASSUMIR


def pode_encerrar(de: StatusDaConversa | None) -> bool:
    return de in _ORIGENS_PERMITIDAS_PARA_ENCERRAR


def _status_por_tipo_de_decisao(tipo: TipoDecisao) -> StatusDaConversa:
    """A ÚNICA tabela `TipoDecisao -> StatusDaConversa` do sistema — `proxima_transicao_automatica`
    (turno ao vivo) e a reconstrução de trilhas antigas (`interfaces.painel.agrupar`, condição 1
    do veredito do PLANO do PR 2) chamam esta mesma função, nunca duas tabelas."""
    match tipo:
        case TipoDecisao.EXPLICAR_COTACAO:
            return StatusDaConversa.COTADA
        case TipoDecisao.ENCAMINHAR:
            # Condição 3 do veredito: ENCAMINHAR de QUALQUER motivo vira "Aguardando corretor",
            # sem caso especial por reason_code — cobre motivos futuros (ex.: frente #58) sem
            # precisar editar esta função.
            return StatusDaConversa.AGUARDANDO_CORRETOR
        case TipoDecisao.ENCERRAR:
            # O fluxo automático (recusa de negócio sem encaminhar, config desligada) também
            # termina a conversa sozinho — decisão da coordenação no PLANO do PR 2.
            return StatusDaConversa.ENCERRADA
        case TipoDecisao.COLETAR_INFORMACAO | TipoDecisao.COTAR:
            return StatusDaConversa.COM_O_AGENTE
        case _:
            raise AssertionError(f"TipoDecisao sem status mapeado: {tipo!r}")


def proxima_transicao_automatica(decisao: Decisao, resultado: ResultadoDaCotacao | None) -> StatusDaConversa:
    """Deriva o status automático do turno a partir da `Decisao` de `dominio.politica.decidir`.

    `resultado` não participa do mapeamento (a `Decisao` já carrega tudo que ele decide) — o
    parâmetro existe para manter a assinatura simétrica ao chamador (`conduzir_conversa` já tem os
    dois em mãos) e para o dia em que uma condição futura precisar do resultado bruto."""
    del resultado
    return _status_por_tipo_de_decisao(decisao.tipo)


def status_reconstruido(tipo_do_ultimo_evento: TipoDecisao) -> StatusDaConversa:
    """Para conversas SEM evento `status_alterado` na trilha (trilhas antigas, geradas antes desta
    frente) — condição 1 do veredito do PLANO do PR 2: reconstrói pela MESMA tabela de
    `proxima_transicao_automatica`, nunca uma segunda regra em `interfaces.painel.agrupar`."""
    return _status_por_tipo_de_decisao(tipo_do_ultimo_evento)


def status_atual_da_conversa(eventos_da_conversa: list[dict]) -> StatusDaConversa | None:
    """A partir dos eventos CRUS da trilha (formato JSONL, `dict`) de UMA conversa: o último
    `status_alterado` (campo `para`) se existir; senão reconstrói pelo ÚLTIMO evento entre
    `decisao` e `handoff` (condição 1 do veredito, que cita os dois — em `conduzir_conversa` um
    `handoff` sempre nasce no mesmo turno que gravou `decisao` tipo `encaminhar` logo antes, mas
    trilhas fixture/antigas podem ter um `handoff` sem o `decisao` correspondente; um `handoff`
    isolado vale o mesmo que `TipoDecisao.ENCAMINHAR` — AGUARDANDO_CORRETOR por qualquer motivo,
    condição 3). `None` = conversa sem nenhum sinal ainda (não é erro; `transicao_permitida`/
    `pode_assumir`/`pode_encerrar` tratam `None` como "antes da primeira transição")."""
    ultimo_status: str | None = None
    for evento in eventos_da_conversa:
        if evento.get("evento") == "status_alterado":
            ultimo_status = evento.get("para")
    if ultimo_status is not None:
        return StatusDaConversa(ultimo_status)

    ultimo_sinal: dict | None = None
    for evento in eventos_da_conversa:
        if evento.get("evento") in ("decisao", "handoff"):
            ultimo_sinal = evento
    if ultimo_sinal is None:
        return None
    if ultimo_sinal["evento"] == "handoff":
        return StatusDaConversa.AGUARDANDO_CORRETOR
    return status_reconstruido(TipoDecisao(ultimo_sinal["tipo"]))
