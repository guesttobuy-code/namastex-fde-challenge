"""Política de decisão pura — recebe estado e resultado, devolve decisão. Sem relógio, sem rede,
sem LLM."""
from __future__ import annotations

from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.decisao import Decisao, MotivoHandoff, TipoDecisao
from dominio.estado_conversa import EstadoDaConversa
from dominio.intencao import Intencao
from dominio.resultado_cotacao import ResultadoDaCotacao, StatusCotacao


# issue #42/#57, sinais explícitos do lead — incondicionais, antes de qualquer outro ramo.
# Ordem de inserção = precedência (QUER_CONTRATAR primeiro, decisão da coordenação, 13/09/2026):
# `EstadoDaConversa.ultimo_intent` guarda um valor só, os dois nunca coexistem no mesmo turno hoje
# — a ordem aqui não resolve empate nenhum, só documenta a precedência para o dia em que o dado
# deixar de ser de valor único.
_MOTIVO_POR_INTENT_EXPLICITO = {
    Intencao.QUER_CONTRATAR: MotivoHandoff.LEAD_QUER_CONTRATAR,
    Intencao.QUER_FALAR_COM_HUMANO: MotivoHandoff.LEAD_PEDIU_HUMANO,
}


def _decisao_por_intent_explicito(estado: EstadoDaConversa) -> Decisao | None:
    motivo = _MOTIVO_POR_INTENT_EXPLICITO.get(estado.ultimo_intent)
    return Decisao(TipoDecisao.ENCAMINHAR, reason_code=motivo) if motivo is not None else None


def decidir(
    estado: EstadoDaConversa,
    resultado: ResultadoDaCotacao | None,
    configuracao: ConfiguracaoComercial = ConfiguracaoComercial(),
) -> Decisao:
    decisao_explicita = _decisao_por_intent_explicito(estado)
    if decisao_explicita is not None:
        return decisao_explicita
    if estado.campos_faltantes:
        return Decisao(TipoDecisao.COLETAR_INFORMACAO)
    if resultado is None:
        return Decisao(TipoDecisao.COTAR)
    # R5 (issue #16): erro_de_payload e timeout viram ENCAMINHAR, diferenciados só pelo motivo —
    # nenhum dos dois é culpa do lead, e nos dois um humano precisa saber que não deu para cotar.
    match resultado.status:
        case StatusCotacao.SUCESSO:
            return Decisao(TipoDecisao.EXPLICAR_COTACAO)
        case StatusCotacao.RECUSA_DE_NEGOCIO:
            # issue #42, decisão do dono (#41): decisão comercial da seguradora, configurável.
            if configuracao.encaminhar_lead_fora_do_padrao:
                return Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.RECUSA_REGRA_DE_ACEITACAO)
            return Decisao(TipoDecisao.ENCERRAR)
        case StatusCotacao.INDISPONIVEL:
            return Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_INDISPONIVEL)
        case StatusCotacao.TIMEOUT:
            return Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_TIMEOUT)
        case StatusCotacao.ERRO_DE_PAYLOAD:
            return Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_ERRO_DE_PAYLOAD)
        case _:
            raise AssertionError(f"StatusCotacao sem decisao mapeada: {resultado.status!r}")
