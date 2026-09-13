"""Caso de uso `montar_e_responder` (issue #58, frente `ia-responde`): quando o lead levanta uma
objeção de preço, monta o contexto (ficha da cotação + catálogo de planos + fichas de objeção
PUBLICADAS + configuração comercial), pede ao LLM uma resposta orientada por marcadores, valida no
domínio (`dominio.ficha_objecao`) e preenche os marcadores com valores reais. Nunca decide preço,
nunca inventa número — a fonte de todo valor monetário é `PrecoCotado`, a mesma garantia de
`dominio.redator`.

O caminho que GERA a resposta (`montar_contexto`/`montar_e_responder`) nunca recebe
`EstadoDaConversa` — só `PrecoCotado` e o catálogo de planos, nunca nome/WhatsApp/e-mail (mesma
disciplina de `aplicacao.servico_contato`: se um campo não é lido, não pode vazar). O caminho que
CLASSIFICA a mensagem (`processar_mensagem_livre`) recebe `estado` só para repassar ao
`PortalDeLinguagem.extrair` — mesmo padrão já usado por `servico_conversa.extrair_dados_da_mensagem`
— e nenhum dos dois adaptadores de extração hoje envia `estado_atual` ao LLM (ambos fazem
`del estado_atual`); se um dia passarem a usar, a garantia de não vazar PII é do adaptador de
EXTRAÇÃO, não deste módulo."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime, timezone

from aplicacao.servico_conversa import _TEXTO_ENCAMINHAMENTO_PARA_CORRETOR, intencao_reconhecida
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio import redator_pii
from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.decisao import MotivoHandoff
from dominio.estado_conversa import EstadoDaConversa
from dominio.eventos_trilha import Handoff, MensagemEnviada, MensagemRecebida
from dominio.ficha_objecao import (
    MarcadorInvalido,
    preencher_marcadores,
    validar_resposta_orientada,
    vocabulario_de_marcadores,
)
from dominio.intencao import Intencao
from dominio.nomes_cobertura import nome_legivel
from dominio.preco_cotado import PrecoCotado
from dominio.redator import valor_br

from .portas.portal_de_linguagem import PortalDeLinguagem
from .portas.portal_de_resposta_orientada import PortalDeRespostaOrientada
from .servico_conhecimento import ServicoDeConhecimento

ORIGEM_TEXTO_FIXO = "texto_fixo:encaminhamento_resposta_orientada"

_MAX_TENTATIVAS = 2


def _agora_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _novo_id(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex}"


def _ficha_da_cotacao_para_contexto(preco: PrecoCotado) -> dict:
    return {
        "plano_nome": preco.plano_nome,
        "premio_mensal": preco.premio_mensal,
        "franquia": preco.franquia,
        "coberturas": [nome_legivel(c) for c in preco.coberturas],
        "carencia": preco.carencia,
        "pro_rata": preco.pro_rata,
    }


def _valor_monetario_br(valor: float) -> str:
    """`valor_br` só formata o número (`3.000,00`); marcador monetário precisa do símbolo, para o
    LLM não ter que saber escrever "R$" por conta própria no meio da frase."""
    return f"R$ {valor_br(valor)}"


def _valores_dos_marcadores(preco: PrecoCotado, planos: Iterable[dict]) -> dict[str, str]:
    """Todo marcador que `vocabulario_de_marcadores(planos)` reconhece tem um valor aqui — senão
    `preencher_marcadores` recusaria um marcador válido por falta de dado (nunca deveria
    acontecer; se acontecer, é o fallback quem cobre)."""
    valores = {
        "premio_mensal": _valor_monetario_br(preco.premio_mensal),
        "franquia": _valor_monetario_br(preco.franquia),
        "plano_nome": preco.plano_nome,
        "coberturas": ", ".join(nome_legivel(c) for c in preco.coberturas),
    }
    for plano in planos:
        id_do_plano = plano.get("id")
        franquia_do_plano = plano.get("franquia")
        if id_do_plano and franquia_do_plano is not None:
            valores[f"franquia_{id_do_plano}"] = _valor_monetario_br(float(franquia_do_plano))
    if preco.carencia:
        valores["carencia_dias"] = str(preco.carencia.get("dias", ""))
    if preco.pro_rata:
        valores["parcela_proporcional"] = _valor_monetario_br(preco.pro_rata["valor_primeiro_pagamento"])
    return valores


def montar_contexto(
    preco: PrecoCotado,
    planos: Iterable[dict],
    servico_conhecimento: ServicoDeConhecimento,
    configuracao: ConfiguracaoComercial,
) -> dict:
    """Contexto que vai para o LLM. Fichas de objeção filtradas para só as PUBLICADAS (issue #43
    — rascunho nunca vira contexto de resposta ao lead) — filtro feito aqui, não reimplementado em
    outro lugar."""
    planos = list(planos)
    fichas_publicadas = [
        f for f in servico_conhecimento.listar_objecoes() if f.get("status") == "publicado"
    ]
    return {
        "ficha_da_cotacao": _ficha_da_cotacao_para_contexto(preco),
        "planos": [
            {"id": p.get("id"), "nome": p.get("nome"), "franquia": p.get("franquia")} for p in planos
        ],
        "fichas_de_objecao": fichas_publicadas,
        "configuracao_comercial": {
            "encaminhar_lead_fora_do_padrao": configuracao.encaminhar_lead_fora_do_padrao,
        },
    }


def montar_e_responder(
    *,
    portal: PortalDeRespostaOrientada,
    preco: PrecoCotado,
    planos: Iterable[dict] = (),
    servico_conhecimento: ServicoDeConhecimento,
    configuracao: ConfiguracaoComercial,
) -> tuple[str, str, MotivoHandoff | None]:
    """Devolve `(texto, origem_do_texto, motivo_handoff)`. `motivo_handoff` é `None` numa resposta
    válida; `MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL` quando não há ficha publicada para
    basear a resposta (nem chama o LLM à toa) ou quando as `_MAX_TENTATIVAS` reprovam na validação
    de marcador ("Pronto quando" da #58) — nunca um número fabricado nem um `{{marcador}}` visível
    ao lead; encaminha para o corretor em vez disso, mesmo texto de `LEAD_QUER_CONTRATAR`
    (decisão da coordenação — reaproveita `_TEXTO_ENCAMINHAMENTO_PARA_CORRETOR`, LEI 11)."""
    planos = list(planos)
    contexto = montar_contexto(preco, planos, servico_conhecimento, configuracao)

    if not contexto["fichas_de_objecao"]:
        return _TEXTO_ENCAMINHAMENTO_PARA_CORRETOR, ORIGEM_TEXTO_FIXO, MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL

    vocabulario = vocabulario_de_marcadores(p["id"] for p in planos if p.get("id"))
    valores = _valores_dos_marcadores(preco, planos)

    for _tentativa in range(_MAX_TENTATIVAS):
        bruto = portal.responder(contexto)
        if bruto is None:  # porta indisponível (sem chave, rede, timeout, esquema) — tentativa reprovada
            continue
        try:
            validar_resposta_orientada(bruto, vocabulario)
            return preencher_marcadores(bruto, valores), portal.origem_do_texto, None
        except MarcadorInvalido:
            continue

    return _TEXTO_ENCAMINHAMENTO_PARA_CORRETOR, ORIGEM_TEXTO_FIXO, MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL


def processar_mensagem_livre(
    *,
    portal_de_linguagem: PortalDeLinguagem,
    portal_de_resposta: PortalDeRespostaOrientada,
    texto_bruto: str,
    estado: EstadoDaConversa,
    preco_atual: PrecoCotado | None,
    planos: Iterable[dict] = (),
    servico_conhecimento: ServicoDeConhecimento,
    configuracao: ConfiguracaoComercial,
    trilha: ServicoDeTrilha | None = None,
) -> tuple[str, str, Intencao] | None:
    """Classifica uma mensagem livre do lead (fora do fluxo estruturado de coleta) e desvia para
    `montar_e_responder` quando a intenção reconhecida é `Intencao.OBJECAO_DE_PRECO` **e** já
    existe uma cotação para explicar (`preco_atual`). Devolve `None` para qualquer outra
    intenção/sem intenção reconhecida, ou objeção sem cotação ainda — quem chama decide o que
    fazer (o fluxo guiado normal continua sendo a rota, este caso de uso é aditivo).

    Mesma disciplina de privacidade de `aplicacao.servico_conversa.extrair_dados_da_mensagem`:
    texto BRUTO nunca vai ao portal de linguagem sem passar por `redator_pii.redigir_texto`.

    `trilha`, se passado, grava `mensagem_recebida` (a pergunta do lead, mascarada), depois
    `mensagem_enviada` (a resposta) e, quando a resposta é um encaminhamento, `handoff` — mesma
    disciplina de `aplicacao.servico_conversa.conduzir_conversa` (trilha é responsabilidade de
    QUEM ORQUESTRA, nunca da porta nem do adaptador)."""
    if trilha is not None:
        trilha.registrar_evento(
            MensagemRecebida(
                evento="mensagem_recebida",
                conversation_id=estado.conversation_id,
                id=_novo_id("msg"),
                instante=_agora_iso(),
                texto=texto_bruto,
            )
        )

    texto_mascarado = redator_pii.redigir_texto(texto_bruto)
    saida = portal_de_linguagem.extrair(texto_mascarado, estado)
    intencao = intencao_reconhecida(saida.intent)

    if intencao != Intencao.OBJECAO_DE_PRECO or preco_atual is None:
        return None

    texto, origem, motivo_handoff = montar_e_responder(
        portal=portal_de_resposta,
        preco=preco_atual,
        planos=planos,
        servico_conhecimento=servico_conhecimento,
        configuracao=configuracao,
    )

    if trilha is not None:
        trilha.registrar_evento(
            MensagemEnviada(
                evento="mensagem_enviada",
                conversation_id=estado.conversation_id,
                id=_novo_id("msg"),
                instante=_agora_iso(),
                texto=texto,
                # Sem `Decisao` formal aqui (este fluxo não passa por `dominio.politica.decidir`) —
                # id próprio só para correlação na trilha, nunca confundido com um id de decisão.
                decisao_id=_novo_id("resposta_orientada"),
                regra_aplicada="resposta_orientada:objecao_de_preco",
                origem_do_texto=origem,
                quote_attempt_id=preco_atual.quote_attempt_id,
            )
        )
        if motivo_handoff is not None:
            trilha.registrar_evento(
                Handoff(
                    evento="handoff",
                    conversation_id=estado.conversation_id,
                    id=_novo_id("ho"),
                    instante=_agora_iso(),
                    reason_code=motivo_handoff.value,
                    mensagem_ao_lead=texto,
                )
            )

    return texto, origem, intencao
