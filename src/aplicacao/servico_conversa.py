"""Caso de uso principal — conduz uma conversa do começo ao fim: coleta -> cota -> decide ->
responde ou encaminha (F5/#8, absorvido nesta frente por decisão do dono, issue #6).

Orquestra `dominio` + `PortalDeCotacao`; não reimplementa nenhuma regra (LEI 11 — dono único): a
decisão é de `dominio.politica`, o preço só existe se vier da porta (`PortalDeCotacao.cotar`), o
texto de cotação é de `dominio.redator` — que recusa qualquer coisa que não seja `PrecoCotado`
(a garantia de "preço só existe se veio da API").
"""
from __future__ import annotations

from dataclasses import dataclass

from aplicacao.portas.portal_de_cotacao import PortalDeCotacao
from dominio import politica, validacao
from dominio.decisao import Decisao, TipoDecisao
from dominio.estado_conversa import EstadoDaConversa
from dominio.redator import montar_mensagem
from dominio.resultado_cotacao import ResultadoDaCotacao


@dataclass(frozen=True)
class TurnoDaConversa:
    """O que aconteceu num turno: a decisão tomada, o resultado de cotação (se houve tentativa) e
    o texto pronto para mostrar ao lead."""

    decisao: Decisao
    resultado: ResultadoDaCotacao | None
    texto: str


def montar_estado(conversation_id: str, dados: dict) -> EstadoDaConversa:
    """`dados`: o que já foi coletado do lead (idade, veiculo_ano, plano_id, cep, data_inicio).
    Só valida FORMATO (`dominio.validacao`) — elegibilidade é decidida pela `/quote`, nunca aqui."""
    faltantes = validacao.campos_obrigatorios_faltantes(dados)
    return EstadoDaConversa(
        conversation_id=conversation_id,
        idade=dados.get("idade"),
        veiculo_ano=dados.get("veiculo_ano"),
        plano_id=dados.get("plano_id"),
        cep=dados.get("cep"),
        data_inicio=dados.get("data_inicio"),
        campos_faltantes=faltantes,
    )


def _payload_da_quote(estado: EstadoDaConversa) -> dict:
    return {
        "plano_id": estado.plano_id or "essencial",
        "idade": estado.idade,
        "veiculo_ano": estado.veiculo_ano,
        "cep": estado.cep,
        "data_inicio": estado.data_inicio,
    }


def _texto_da_decisao(decisao: Decisao, resultado: ResultadoDaCotacao | None) -> str:
    match decisao.tipo:
        case TipoDecisao.COLETAR_INFORMACAO:
            return "Preciso de mais alguns dados antes de cotar."
        case TipoDecisao.EXPLICAR_COTACAO:
            return montar_mensagem(resultado.preco)
        case TipoDecisao.ENCERRAR:
            return resultado.motivo
        case TipoDecisao.ENCAMINHAR:
            return (
                "Não consegui fechar sua cotação agora — vou encaminhar para um atendente "
                f"(motivo: {decisao.reason_code.value})."
            )
        case _:
            raise AssertionError(f"TipoDecisao sem texto mapeado neste caso de uso: {decisao.tipo!r}")


def conduzir_conversa(portal: PortalDeCotacao, estado: EstadoDaConversa) -> TurnoDaConversa:
    """Roda a conversa até uma decisão terminal (tudo que não é COLETAR_INFORMACAO nem COTAR).
    `politica.decidir(estado, None)` devolve COTAR quando não falta nada e ainda não tentou; só
    então a porta é chamada — e o resultado real decide de novo, nunca inventado aqui."""
    decisao = politica.decidir(estado, None)
    resultado: ResultadoDaCotacao | None = None
    if decisao.tipo == TipoDecisao.COTAR:
        resultado = portal.cotar(_payload_da_quote(estado), estado.conversation_id)
        decisao = politica.decidir(estado, resultado)
    return TurnoDaConversa(decisao=decisao, resultado=resultado, texto=_texto_da_decisao(decisao, resultado))
