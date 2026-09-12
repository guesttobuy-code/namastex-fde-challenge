"""Caso de uso principal — conduz uma conversa do começo ao fim: coleta -> cota -> decide ->
responde ou encaminha (F5/#8, absorvido nesta frente por decisão do dono, issue #6).

Orquestra `dominio` + `PortalDeCotacao`; não reimplementa nenhuma regra (LEI 11 — dono único): a
decisão é de `dominio.politica`, o preço só existe se vier da porta (`PortalDeCotacao.cotar`), o
texto de cotação é de `dominio.redator` — que recusa qualquer coisa que não seja `PrecoCotado`
(a garantia de "preço só existe se veio da API").

Trilha (issue #7, costurada nesta frente depois do merge da F4/#31 — ordem da coordenação): grava
UM evento por tentativa HTTP (não por cotação, ESPECIFICACAO.md §1) via `on_tentativa`, mais
`mensagem_recebida`/`decisao`/`mensagem_enviada`/`handoff` por turno. Tudo passa por
`ServicoDeTrilha.registrar_evento` — nunca chama `RepositorioDeTrilha` direto nem redige PII por
conta própria (o serviço já redige sozinho, I-1 do CONTRACT de `aplicacao`)."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from aplicacao.portas.portal_de_cotacao import PortalDeCotacao
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio import politica, validacao
from dominio.decisao import Decisao, TipoDecisao
from dominio.estado_conversa import EstadoDaConversa
from dominio.eventos_trilha import Decisao as DecisaoTrilha
from dominio.eventos_trilha import Handoff, MensagemEnviada, MensagemRecebida, TentativaDeCotacao
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
            # O reason_code NUNCA vai no texto ao lead (achado da auditoria do PR #35): é
            # identificador interno do operador, e vazaria pro WhatsApp do cliente. Ele continua
            # em `decisao.reason_code` (evento `handoff`) e em `_regra_aplicada` — só não aqui.
            return "Não consegui fechar sua cotação agora — vou encaminhar para um atendente."
        case _:
            raise AssertionError(f"TipoDecisao sem texto mapeado neste caso de uso: {decisao.tipo!r}")


def _agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _novo_id(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex[:8]}"


def _resumo_carencia(corpo: dict) -> str | None:
    car = corpo.get("carencia")
    if not car or not car.get("coberturas"):
        return None
    return f"{car.get('dias')} dias para: {', '.join(car['coberturas'])}"


def _valor_pro_rata(corpo: dict) -> float | None:
    pro_rata = corpo.get("primeiro_pagamento_pro_rata")
    return pro_rata.get("valor_primeiro_pagamento") if pro_rata else None


def _registrar_tentativa(trilha: ServicoDeTrilha, conversation_id: str, observada) -> None:
    """`observada` é um `infra.cliente_quote.TentativaObservada` — recebido por duck typing
    (aplicacao nunca importa infra, I-2 do CONTRACT); só lemos os atributos documentados na porta."""
    corpo = observada.resposta.corpo or {}
    e_sucesso = observada.classificacao == "sucesso"
    trilha.registrar_evento(
        TentativaDeCotacao(
            evento="tentativa_de_cotacao",
            conversation_id=conversation_id,
            id=observada.quote_attempt_id,
            instante=_agora_iso(),
            numero_da_tentativa=observada.numero_da_tentativa,
            http_status=observada.resposta.status_code or 0,
            classificacao=observada.classificacao,
            latencia_ms=observada.latencia_ms,
            orcamento_restante_ms=observada.orcamento_restante_ms,
            quote_attempt_id=observada.quote_attempt_id,
            premio_mensal=corpo.get("premio_mensal") if e_sucesso else None,
            franquia=corpo.get("franquia") if e_sucesso else None,
            coberturas=tuple(corpo.get("coberturas", ())) if e_sucesso else None,
            multiplicadores=corpo.get("multiplicadores") if e_sucesso else None,
            carencia=_resumo_carencia(corpo) if e_sucesso else None,
            pro_rata=_valor_pro_rata(corpo) if e_sucesso else None,
        )
    )


def _regra_aplicada(decisao: Decisao, resultado: ResultadoDaCotacao | None) -> str:
    origem = resultado.status.value.upper() if resultado is not None else "SEM_TENTATIVA"
    return f"politica.decidir:{origem}->{decisao.tipo.value.upper()}"


def _origem_do_texto(decisao: Decisao) -> str:
    if decisao.tipo == TipoDecisao.EXPLICAR_COTACAO:
        return "redator_deterministico:v1"
    if decisao.tipo == TipoDecisao.ENCERRAR:
        # o texto é o `motivo` que veio verbatim da /quote (CotacaoRecusada) — não é nosso redator.
        return "quote_service:motivo_recusa"
    # Achado da auditoria do PR #35: o texto fixo mora AQUI (aplicacao.servico_conversa), não na
    # CLI — a etiqueta tem que apontar pro arquivo que o dono precisa editar, não pra camada de
    # I/O que só exibe. ESPECIFICACAO.md §1 ganhou esta terceira forma de origem, por acréscimo.
    return "texto_fixo:aplicacao.servico_conversa@v1"


def _dados_usados(estado: EstadoDaConversa, resultado: ResultadoDaCotacao | None) -> tuple[str, ...]:
    if resultado is not None and resultado.preco is not None:
        return (resultado.preco.quote_attempt_id, "estado.idade", "estado.veiculo_ano", "estado.cep")
    if resultado is not None:
        return (f"tentativa:{resultado.status.value}",)
    return ()


def _contexto_coletado(estado: EstadoDaConversa) -> dict:
    return {
        "idade": estado.idade,
        "veiculo_ano": estado.veiculo_ano,
        "cep": estado.cep,
        "plano_id": estado.plano_id,
        "data_inicio": estado.data_inicio,
    }


def conduzir_conversa(
    portal: PortalDeCotacao, estado: EstadoDaConversa, trilha: ServicoDeTrilha | None = None
) -> TurnoDaConversa:
    """Roda a conversa até uma decisão terminal (tudo que não é COLETAR_INFORMACAO nem COTAR).
    `politica.decidir(estado, None)` devolve COTAR quando não falta nada e ainda não tentou; só
    então a porta é chamada — e o resultado real decide de novo, nunca inventado aqui.

    `trilha`, se passado, grava `mensagem_recebida`, `tentativa_de_cotacao` (uma por tentativa
    HTTP), `decisao`, `mensagem_enviada` e `handoff` — nesta ordem, cada um via
    `ServicoDeTrilha.registrar_evento` (que redige PII sozinho)."""
    if trilha is not None:
        trilha.registrar_evento(
            MensagemRecebida(
                evento="mensagem_recebida",
                conversation_id=estado.conversation_id,
                id=_novo_id("msg"),
                instante=_agora_iso(),
                texto=(
                    f"idade={estado.idade}; veiculo_ano={estado.veiculo_ano}; cep={estado.cep}; "
                    f"plano_id={estado.plano_id}; data_inicio={estado.data_inicio}"
                ),
            )
        )

    decisao = politica.decidir(estado, None)
    resultado: ResultadoDaCotacao | None = None
    if decisao.tipo == TipoDecisao.COTAR:
        on_tentativa = (lambda o: _registrar_tentativa(trilha, estado.conversation_id, o)) if trilha else None
        resultado = portal.cotar(_payload_da_quote(estado), estado.conversation_id, on_tentativa=on_tentativa)
        decisao = politica.decidir(estado, resultado)

    texto = _texto_da_decisao(decisao, resultado)

    if trilha is not None:
        decisao_id = _novo_id("dec")
        trilha.registrar_evento(
            DecisaoTrilha(
                evento="decisao",
                conversation_id=estado.conversation_id,
                id=decisao_id,
                instante=_agora_iso(),
                tipo=decisao.tipo.value,
                motivo=decisao.reason_code.value if decisao.reason_code else None,
            )
        )
        trilha.registrar_evento(
            MensagemEnviada(
                evento="mensagem_enviada",
                conversation_id=estado.conversation_id,
                id=_novo_id("msg"),
                instante=_agora_iso(),
                texto=texto,
                decisao_id=decisao_id,
                regra_aplicada=_regra_aplicada(decisao, resultado),
                origem_do_texto=_origem_do_texto(decisao),
                dados_usados=_dados_usados(estado, resultado),
                quote_attempt_id=resultado.preco.quote_attempt_id if resultado and resultado.preco else None,
            )
        )
        if decisao.tipo == TipoDecisao.ENCAMINHAR:
            trilha.registrar_evento(
                Handoff(
                    evento="handoff",
                    conversation_id=estado.conversation_id,
                    id=_novo_id("ho"),
                    instante=_agora_iso(),
                    reason_code=decisao.reason_code.value,
                    contexto_coletado=_contexto_coletado(estado),
                    mensagem_ao_lead=texto,
                )
            )

    return TurnoDaConversa(decisao=decisao, resultado=resultado, texto=texto)
