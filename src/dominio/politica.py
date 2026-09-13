"""Política de decisão pura — recebe estado e resultado, devolve decisão. Sem relógio, sem rede,
sem LLM."""
from __future__ import annotations

from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.decisao import Decisao, MotivoHandoff, TipoDecisao
from dominio.estado_conversa import EstadoDaConversa
from dominio.intencao import Intencao
from dominio.resultado_cotacao import ResultadoDaCotacao, StatusCotacao


def decidir(
    estado: EstadoDaConversa,
    resultado: ResultadoDaCotacao | None,
    configuracao: ConfiguracaoComercial = ConfiguracaoComercial(),
) -> Decisao:
    # issue #42, decisão do dono: "quero contratar" é sinal explícito do lead, incondicional —
    # não espera dado completo nem cotação, e vem antes de qualquer outro ramo.
    if estado.ultimo_intent == Intencao.QUER_CONTRATAR:
        return Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.LEAD_QUER_CONTRATAR)
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
