"""Política de decisão pura — recebe estado e resultado, devolve decisão. Sem relógio, sem rede,
sem LLM."""
from __future__ import annotations

from dominio.decisao import Decisao, MotivoHandoff, TipoDecisao
from dominio.estado_conversa import EstadoDaConversa
from dominio.resultado_cotacao import ResultadoDaCotacao, StatusCotacao


def decidir(estado: EstadoDaConversa, resultado: ResultadoDaCotacao | None) -> Decisao:
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
            return Decisao(TipoDecisao.ENCERRAR)
        case StatusCotacao.INDISPONIVEL:
            return Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_INDISPONIVEL)
        case StatusCotacao.TIMEOUT:
            return Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_TIMEOUT)
        case StatusCotacao.ERRO_DE_PAYLOAD:
            return Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_ERRO_DE_PAYLOAD)
        case _:
            raise AssertionError(f"StatusCotacao sem decisao mapeada: {resultado.status!r}")
