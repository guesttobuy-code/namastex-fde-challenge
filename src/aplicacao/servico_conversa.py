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
from aplicacao.portas.portal_de_linguagem import PortalDeLinguagem
from aplicacao.servico_status_conversa import registrar_mudanca_de_status
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio import politica, redator_pii, validacao
from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.decisao import Decisao, MotivoHandoff, TipoDecisao
from dominio.estado_conversa import EstadoDaConversa
from dominio.eventos_trilha import Decisao as DecisaoTrilha
from dominio.eventos_trilha import Handoff, MensagemEnviada, MensagemRecebida, TentativaDeCotacao
from dominio.intencao import Intencao
from dominio.redator import montar_mensagem
from dominio.resultado_cotacao import ResultadoDaCotacao
from dominio.status_conversa import StatusDaConversa, proxima_transicao_automatica


@dataclass(frozen=True)
class TurnoDaConversa:
    """O que aconteceu num turno: a decisão tomada, o resultado de cotação (se houve tentativa) e
    o texto pronto para mostrar ao lead."""

    decisao: Decisao
    resultado: ResultadoDaCotacao | None
    texto: str


def montar_estado(conversation_id: str, dados: dict) -> EstadoDaConversa:
    """`dados`: o que já foi coletado do lead (idade, veiculo_ano, plano_id, cep, data_inicio, mais
    nome/whatsapp/email/veiculo_modelo — issue #46, PR 2 de 2). Só valida FORMATO
    (`dominio.validacao`) — elegibilidade é decidida pela `/quote`, nunca aqui. `nome`/`whatsapp`/
    `email` ficam só em `EstadoDaConversa` (para o chat lembrar entre turnos) — nunca vão para
    `_contexto_coletado`/a trilha, isso é feito só por `ServicoDeContato` (ADR-0005).

    CEP passa por `validacao.normalizar_cep` (issue #68, decisão da coordenação) ANTES de entrar
    no estado — nunca o valor cru. Um CEP sem hífen (`"01310100"`) vira `"01310-100"` (o único
    formato que `dominio.redator_pii` sabe mascarar); um CEP inválido vira `None`, que
    `campos_obrigatorios_faltantes` (chamada abaixo, já com o valor normalizado) volta a pedir ao
    lead — dono único do formato aceito e do normalizado (LEI 11), nunca uma segunda regra aqui."""
    cep_normalizado = validacao.normalizar_cep(dados.get("cep"))
    dados_com_cep_normalizado = {**dados, "cep": cep_normalizado}
    faltantes = validacao.campos_obrigatorios_faltantes(dados_com_cep_normalizado)
    return EstadoDaConversa(
        conversation_id=conversation_id,
        idade=dados.get("idade"),
        veiculo_ano=dados.get("veiculo_ano"),
        plano_id=dados.get("plano_id"),
        cep=cep_normalizado,
        data_inicio=dados.get("data_inicio"),
        campos_faltantes=faltantes,
        nome=dados.get("nome"),
        whatsapp=dados.get("whatsapp"),
        email=dados.get("email"),
        veiculo_modelo=dados.get("veiculo_modelo"),
    )


def extrair_dados_da_mensagem(
    portal: PortalDeLinguagem, texto_bruto: str, estado_atual: EstadoDaConversa
) -> EstadoDaConversa:
    """Extrai o que der do texto livre do lead (issue #9, F6) — ADITIVO sobre `estado_atual`,
    nunca apaga um campo já confirmado só porque esta mensagem não repetiu.

    O CEP é PII: extraído do texto BRUTO (`dominio.redator_pii.extrair_cep`) ANTES do
    mascaramento. Só depois o texto MASCARADO (`redigir_texto`) vai para `portal.extrair` — o
    portal nunca vê o CEP, mascarado ou não. A saída do portal só entra no estado depois de passar
    por `dominio.validacao` (formato) — saída inválida ou de tipo errado é descartada em silêncio
    de campo (mantém o que já havia), nunca vira `ValueError` que travaria a conversa."""
    cep_extraido = redator_pii.extrair_cep(texto_bruto)
    texto_mascarado = redator_pii.redigir_texto(texto_bruto)
    saida = portal.extrair(texto_mascarado, estado_atual)

    cep = cep_extraido if cep_extraido and validacao.cep_valido(cep_extraido) else estado_atual.cep
    idade = saida.idade if isinstance(saida.idade, int) else estado_atual.idade
    veiculo_ano = saida.veiculo_ano if isinstance(saida.veiculo_ano, int) else estado_atual.veiculo_ano
    plano_id = saida.plano_id if isinstance(saida.plano_id, str) and saida.plano_id else estado_atual.plano_id
    data_inicio = (
        saida.data_inicio if validacao.data_iso_valida(saida.data_inicio) else estado_atual.data_inicio
    )

    dados = {"idade": idade, "veiculo_ano": veiculo_ano, "plano_id": plano_id, "cep": cep, "data_inicio": data_inicio}
    return EstadoDaConversa(
        conversation_id=estado_atual.conversation_id,
        idade=idade,
        veiculo_ano=veiculo_ano,
        plano_id=plano_id,
        cep=cep,
        data_inicio=data_inicio,
        campos_faltantes=validacao.campos_obrigatorios_faltantes(dados),
        ambiguidades=saida.ambiguidades,
        ultimo_intent=intencao_reconhecida(saida.intent) or estado_atual.ultimo_intent,
        status=estado_atual.status,
    )


def intencao_reconhecida(valor: str | None) -> Intencao | None:
    """Converte a string livre que o `PortalDeLinguagem` extrai (issue #9, F6, fora da fronteira
    desta frente) para o Enum fechado `Intencao` (issue #42). Valor que não bate com nenhum membro
    é descartado em silêncio de campo — mesmo padrão de `idade`/`veiculo_ano` nesta função —, nunca
    vira `ValueError` que travaria a conversa. Pública (issue #58, LEI 11): dono único da conversão
    string->Enum, reaproveitada por quem classifica mensagem livre fora do fluxo de coleta."""
    if valor is None:
        return None
    try:
        return Intencao(valor)
    except ValueError:
        return None


def _payload_da_quote(estado: EstadoDaConversa) -> dict:
    return {
        "plano_id": estado.plano_id or "essencial",
        "idade": estado.idade,
        "veiculo_ano": estado.veiculo_ano,
        "cep": estado.cep,
        "data_inicio": estado.data_inicio,
    }


# issue #42, texto aprovado pelo dono (13/09/2026): os 4 motivos que a `/quote` recusa hoje
# (quote-service/data/plans.json:33,39 e quote_logic.py:27,37), traduzidos em português correto,
# com acento e minúscula — os números do motivo vêm da `/quote` e nunca são escritos por LLM.
_TRADUCAO_MOTIVO_RECUSA = {
    "Idade acima do limite de aceitacao (75 anos).": "idade acima do limite de aceitação (75 anos)",
    "Veiculo com mais de 20 anos nao e aceito.": "veículo com mais de 20 anos não é aceito",
    "Idade fora das faixas aceitas.": "idade fora das faixas aceitas",
    "Idade do veiculo fora das faixas aceitas.": "idade do veículo fora das faixas aceitas",
}


def _motivo_da_recusa_traduzido(motivo: str) -> str:
    """Motivo desconhecido (fora da tabela) aparece como veio da `/quote`, sem o ponto final —
    decisão do dono (#42), para não inventar tradução de um motivo que não foi revisado."""
    if motivo in _TRADUCAO_MOTIVO_RECUSA:
        return _TRADUCAO_MOTIVO_RECUSA[motivo]
    return motivo[:-1] if motivo.endswith(".") else motivo


# issue #57 (P9), decisão da coordenação (13/09/2026): "quero contratar" e "quero falar com um
# atendente" mostram o MESMO texto ao lead — texto novo exigiria aprovação do dono, que não estava
# disponível. Uma única constante para os `case` que precisam dela (LEI 11 — nunca duas strings
# iguais copiadas à mão, que divergiriam no primeiro ajuste feito só numa delas). Também
# reaproveitada por `aplicacao.servico_resposta_orientada` (issue #58) quando a IA não consegue
# responder uma objeção de preço com segurança — mesmo texto de encaminhamento ao corretor.
_TEXTO_ENCAMINHAMENTO_PARA_CORRETOR = "Logo um corretor vai entrar em contato para te dar todo o suporte."


def _texto_da_decisao(decisao: Decisao, resultado: ResultadoDaCotacao | None) -> str:
    match decisao.tipo:
        case TipoDecisao.COLETAR_INFORMACAO:
            return "Preciso de mais alguns dados antes de cotar."
        case TipoDecisao.EXPLICAR_COTACAO:
            return montar_mensagem(resultado.preco)
        case TipoDecisao.ENCERRAR:
            # Achado #52: este ramo devolvia o motivo CRU da `/quote`. Decisão do dono (#41):
            # "explica o motivo e encerra com educação" — mesma tabela de tradução do ramo
            # ENCAMINHAR (linha abaixo), sem a parte do corretor (config desligada = sem handoff).
            # Frase aceita pela coordenação, 13/09/2026.
            return (
                "Sinto muito, pelas regras da seguradora não consigo cotar online neste caso: "
                f"{_motivo_da_recusa_traduzido(resultado.motivo)}."
            )
        case TipoDecisao.ENCAMINHAR:
            # O reason_code NUNCA vai no texto ao lead (achado da auditoria do PR #35): é
            # identificador interno do operador, e vazaria pro WhatsApp do cliente. Ele continua
            # em `decisao.reason_code` (evento `handoff`) e em `_regra_aplicada` — só não aqui.
            match decisao.reason_code:
                case MotivoHandoff.LEAD_QUER_CONTRATAR:
                    # Texto do dono (#41), ajustado na auditoria do PR #44 (R1: maiúscula e ponto).
                    return _TEXTO_ENCAMINHAMENTO_PARA_CORRETOR
                case MotivoHandoff.LEAD_PEDIU_HUMANO:
                    # issue #57 (P9): mesmo texto de LEAD_QUER_CONTRATAR, decisão da coordenação —
                    # texto ao lead exige aprovação do dono, indisponível no momento desta frente.
                    return _TEXTO_ENCAMINHAMENTO_PARA_CORRETOR
                case MotivoHandoff.RECUSA_REGRA_DE_ACEITACAO:
                    motivo = _motivo_da_recusa_traduzido(resultado.motivo)
                    return (
                        "Sinto muito, pelas regras da seguradora não consigo cotar online neste "
                        f"caso: {motivo}. Um corretor pode avaliar outras opções para você e vai "
                        "entrar em contato."
                    )
                case _:
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


def registrar_status_do_turno(
    trilha: ServicoDeTrilha, conversation_id: str, decisao: Decisao, resultado: ResultadoDaCotacao | None
) -> StatusDaConversa:
    """Calcula o status automático do turno (`dominio.status_conversa.proxima_transicao_automatica`,
    dono único — LEI 11, MESMA tabela usada pelas transições manuais) e grava
    `MudancaDeStatus(origem="automatico")` via `aplicacao.servico_status_conversa.registrar_mudanca_de_status`
    — o mesmo gravador que `aplicacao.servico_resposta_orientada.processar_mensagem_livre` usa
    quando a IA esgota as tentativas (issue #58, S8), pra não ter dois lugares decidindo COMO um
    `MudancaDeStatus` é gravado.

    Chamada por UMA linha no fim de `conduzir_conversa` (issue #57, PR 2 de 2, condição 2 do
    veredito do PLANO — liberada depois do merge da #58)."""
    novo_status = proxima_transicao_automatica(decisao, resultado)
    registrar_mudanca_de_status(trilha, conversation_id, novo_status, origem="automatico")
    return novo_status


def registrar_pergunta_de_coleta(
    trilha: ServicoDeTrilha, conversation_id: str, indice: int, texto: str, *,
    origem_do_texto: str, regra_aplicada: str = "coleta:pergunta",
) -> None:
    """Grava a pergunta que o agente fez durante a coleta (campo a campo ou texto livre) — pela
    aplicacao, nunca da interface direto (issue #51/#55: dono único da escrita da trilha).

    `regra_aplicada` tem default para o caminho campo a campo (pergunta fixa, sem regra por trás);
    o caminho texto livre passa a sua própria (`portal_de_linguagem:extrair`, preservando o valor
    que a trilha já gravava antes desta função existir)."""
    trilha.registrar_evento(
        MensagemEnviada(
            evento="mensagem_enviada",
            conversation_id=conversation_id,
            id=f"msg_coleta_{indice}_enviada",
            instante=_agora_iso(),
            texto=texto,
            decisao_id=f"dec_coleta_{indice}",
            regra_aplicada=regra_aplicada,
            origem_do_texto=origem_do_texto,
        )
    )


def registrar_resposta_de_coleta(trilha: ServicoDeTrilha, conversation_id: str, indice: int, texto: str) -> None:
    """Grava a resposta que o lead deu durante a coleta — o texto REAL que ele escreveu, nunca um
    resumo sintético (issue #51: hoje só o caminho texto-livre grava isto; campo a campo não grava nada)."""
    trilha.registrar_evento(
        MensagemRecebida(
            evento="mensagem_recebida",
            conversation_id=conversation_id,
            id=f"msg_coleta_{indice}_recebida",
            instante=_agora_iso(),
            texto=texto,
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
    # PROIBIDO (ADR-0005, issue #46, decisão C.1): nunca acrescentar nome/whatsapp/email aqui — eles
    # nunca podem aparecer em claro na trilha. `veiculo_modelo` não é PII na mesma categoria ("fica
    # registrado para o corretor", item B.3.5 da issue) e pode ir. O único caminho de escrita do
    # contato é `aplicacao.servico_contato.ServicoDeContato`, fora da trilha por completo.
    return {
        "idade": estado.idade,
        "veiculo_ano": estado.veiculo_ano,
        "cep": estado.cep,
        "plano_id": estado.plano_id,
        "data_inicio": estado.data_inicio,
        "veiculo_modelo": estado.veiculo_modelo,
    }


def conduzir_conversa(
    portal: PortalDeCotacao,
    estado: EstadoDaConversa,
    trilha: ServicoDeTrilha | None = None,
    configuracao: ConfiguracaoComercial = ConfiguracaoComercial(),
) -> TurnoDaConversa:
    """Roda a conversa até uma decisão terminal (tudo que não é COLETAR_INFORMACAO nem COTAR).
    `politica.decidir(estado, None)` devolve COTAR quando não falta nada e ainda não tentou; só
    então a porta é chamada — e o resultado real decide de novo, nunca inventado aqui.

    `trilha`, se passado, grava `mensagem_recebida`, `tentativa_de_cotacao` (uma por tentativa
    HTTP), `decisao`, `mensagem_enviada` e `handoff` — nesta ordem, cada um via
    `ServicoDeTrilha.registrar_evento` (que redige PII sozinho).

    `configuracao` (issue #42): decisão comercial da seguradora sobre o que fazer com a recusa da
    `/quote` — esta camada só repassa o valor a `dominio.politica.decidir`; quem carrega o valor
    real de `conhecimento/` é a infraestrutura (F13, #43), fora desta frente."""
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
                sender_role="sistema",
            )
        )

    decisao = politica.decidir(estado, None, configuracao)
    resultado: ResultadoDaCotacao | None = None
    if decisao.tipo == TipoDecisao.COTAR:
        on_tentativa = (lambda o: _registrar_tentativa(trilha, estado.conversation_id, o)) if trilha else None
        resultado = portal.cotar(_payload_da_quote(estado), estado.conversation_id, on_tentativa=on_tentativa)
        decisao = politica.decidir(estado, resultado, configuracao)

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
        registrar_status_do_turno(trilha, estado.conversation_id, decisao, resultado)

    return TurnoDaConversa(decisao=decisao, resultado=resultado, texto=texto)
