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
from aplicacao.servico_status_conversa import registrar_mudanca_de_status
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio import redator_pii
from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.decisao import MotivoHandoff
from dominio.estado_conversa import EstadoDaConversa
from dominio.eventos_trilha import Handoff, MensagemEnviada, MensagemRecebida
from dominio.ficha_objecao import (
    MarcadorInvalido,
    preencher_marcadores,
    validar_frases_proibidas,
    validar_resposta_orientada,
    vocabulario_de_marcadores,
)
from dominio.intencao import Intencao
from dominio.nomes_cobertura import nome_legivel
from dominio.preco_cotado import PrecoCotado
from dominio.redator import valor_br
from dominio.status_conversa import StatusDaConversa

from .portas.portal_de_linguagem import PortalDeLinguagem
from .portas.portal_de_resposta_orientada import PortalDeRespostaOrientada
from .servico_conhecimento import ServicoDeConhecimento

ORIGEM_TEXTO_FIXO = "texto_fixo:encaminhamento_resposta_orientada"

# issue #58, veredito da auditoria do PR #75, bloqueante B3: antes, mensagem livre que não era
# objeção de preço reconhecida (ou sem cotação ainda) devolvia `None` — o lead ficava sem NENHUMA
# resposta na tela (`tratado: false` fazia o front apagar a bolha). Acontecia SEMPRE sem chave
# (o extrator determinístico devolve `informar_dados` fixo) e em qualquer pergunta fora de escopo
# com chave. Agora sempre responde algo, nunca deixa o campo mudo.
_TEXTO_FORA_DE_ESCOPO = (
    'Por aqui eu consigo tirar dúvidas sobre o preço desta cotação. Para outras perguntas, toque '
    'em "Falar com um corretor".'
)
ORIGEM_TEXTO_FORA_DE_ESCOPO = "texto_fixo:fora_do_escopo_resposta_orientada"

# LEI 11 (dono único): a mesma string identifica, na trilha, "este turno respondeu uma objeção de
# preço" — usada tanto para GRAVAR `mensagem_enviada.regra_aplicada` quanto para CONTAR, no
# próximo turno, quantas vezes isso já aconteceu (item 6 da #58, `_tentativas_de_objecao_ja_feitas`).
_REGRA_OBJECAO_DE_PRECO = "resposta_orientada:objecao_de_preco"

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


def _tentativas_de_objecao_ja_feitas(trilha: ServicoDeTrilha | None, conversation_id: str) -> int:
    """Item 6 da #58: conta, na TRILHA desta conversa, quantos turnos JÁ responderam uma objeção
    de preço (`mensagem_enviada.regra_aplicada == _REGRA_OBJECAO_DE_PRECO`) — o turno ATUAL não
    conta ainda, só chamado antes de decidir a resposta dele. `trilha=None` (chamador não gravou
    nada, ex. teste sem trilha): sempre 0 — sem histórico, não há como esgotar."""
    if trilha is None:
        return 0
    eventos = trilha.eventos_da_conversa(conversation_id)
    return sum(
        1 for e in eventos if e.get("evento") == "mensagem_enviada" and e.get("regra_aplicada") == _REGRA_OBJECAO_DE_PRECO
    )


def montar_contexto(
    preco: PrecoCotado,
    planos: Iterable[dict],
    servico_conhecimento: ServicoDeConhecimento,
    configuracao: ConfiguracaoComercial,
    texto_do_lead: str = "",
) -> dict:
    """Contexto que vai para o LLM. Fichas de objeção filtradas para só as PUBLICADAS (issue #43
    — rascunho nunca vira contexto de resposta ao lead) — filtro feito aqui, não reimplementado em
    outro lugar. `texto_do_lead` (issue #58, veredito da auditoria do PR #75, bloqueante B2): quem
    chama já passou por `redator_pii.redigir_texto` — este módulo nunca lê o texto bruto — e ele
    entra no contexto como DADO (a mesma disciplina de `frases_do_lead`/`resposta_orientada` das
    fichas, nunca como instrução); sem ele o LLM não tinha como escolher a ficha certa e sempre
    respondia com a primeira publicada."""
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
        "texto_do_lead": texto_do_lead,
        "configuracao_comercial": {
            "encaminhar_lead_fora_do_padrao": configuracao.encaminhar_lead_fora_do_padrao,
        },
    }


def _limite_de_tentativas(contexto: dict) -> int | None:
    """Item 6 da #58 ("tentativas antes do corretor" da ficha, decisão registrada no PR #75 —
    "fora daquele PR, vai para a #57 PR 2"): cada ficha PUBLICADA tem seu próprio
    `tentativas_antes_do_corretor` (obrigatório, 1..5, validado em `FichaDeObjecao.publicar`).

    LIMITE CONHECIDO, sinalizado aqui (LEI 2 — não-chute): o LLM recebe TODAS as fichas publicadas
    juntas no mesmo contexto e escreve texto livre — o código nunca sabe com certeza QUAL ficha
    embasou a resposta (a saída não é estruturada; mudar isso é escopo maior, fora do que a #58
    pediu). Sem esse dado, não dá pra contar tentativas POR ficha com segurança. Decisão desta
    frente: usar o MENOR `tentativas_antes_do_corretor` entre as fichas que estavam no contexto —
    a leitura mais conservadora (nunca deixa o lead passar do limite mais apertado de nenhuma
    ficha envolvida). `None` só quando não há ficha publicada (caso já tratado antes de chamar
    esta função)."""
    limites = [
        f.get("tentativas_antes_do_corretor")
        for f in contexto["fichas_de_objecao"]
        if f.get("tentativas_antes_do_corretor")
    ]
    return min(limites) if limites else None


def _dados_usados_das_fichas(contexto: dict) -> tuple[str, ...]:
    """issue #58, veredito da auditoria do PR #75, bloqueante B5: a trilha precisa registrar quais
    peças da base de conhecimento alimentaram a resposta. O LLM não devolve qual ficha escolheu
    (a saída é texto livre, não um campo estruturado — mudar isso é escopo maior que o veredito
    pede), então este módulo registra TODAS as fichas publicadas que entraram no contexto — o
    mesmo padrão de `aplicacao.servico_conversa._dados_usados` (lista o que alimentou a decisão,
    não só o que "venceu")."""
    return tuple(f"ficha:{f.get('id')}@{f.get('versao')}" for f in contexto["fichas_de_objecao"])


def montar_e_responder(
    *,
    portal: PortalDeRespostaOrientada,
    preco: PrecoCotado,
    planos: Iterable[dict] = (),
    servico_conhecimento: ServicoDeConhecimento,
    configuracao: ConfiguracaoComercial,
    texto_do_lead: str = "",
    tentativas_ja_feitas: int = 0,
) -> tuple[str, str, MotivoHandoff | None, tuple[str, ...]]:
    """Devolve `(texto, origem_do_texto, motivo_handoff, dados_usados)`. `motivo_handoff` é `None`
    numa resposta válida; `MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL` quando não há ficha
    publicada para basear a resposta (nem chama o LLM à toa), quando as `_MAX_TENTATIVAS` reprovam
    na validação de marcador ou de frase proibida ("Pronto quando" da #58, bloqueante B4 do
    veredito da auditoria do PR #75), ou quando `tentativas_ja_feitas` já esgotou o
    `tentativas_antes_do_corretor` da ficha (item 6 da #58, decisão registrada no PR #75 — "vai
    para a #57 PR 2"; ver `_limite_de_tentativas`) — nunca um número fabricado, nem um
    `{{marcador}}` visível ao lead, nem uma promessa de desconto/ajuste/urgência; encaminha para o
    corretor em vez disso, mesmo texto de `LEAD_QUER_CONTRATAR` (decisão da coordenação — reaproveita
    `_TEXTO_ENCAMINHAMENTO_PARA_CORRETOR`, LEI 11). `texto_do_lead` (bloqueante B2) já vem
    mascarado — só repassado para `montar_contexto`, nunca lido aqui. `tentativas_ja_feitas`: quem
    chama (`processar_mensagem_livre`) conta na TRILHA quantas respostas de objeção esta conversa
    já recebeu — esta função fica sem I/O, só recebe o número pronto."""
    planos = list(planos)
    contexto = montar_contexto(preco, planos, servico_conhecimento, configuracao, texto_do_lead)

    if not contexto["fichas_de_objecao"]:
        return _TEXTO_ENCAMINHAMENTO_PARA_CORRETOR, ORIGEM_TEXTO_FIXO, MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL, ()

    dados_usados = _dados_usados_das_fichas(contexto)
    limite = _limite_de_tentativas(contexto)
    if limite is not None and tentativas_ja_feitas >= limite:
        return _TEXTO_ENCAMINHAMENTO_PARA_CORRETOR, ORIGEM_TEXTO_FIXO, MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL, dados_usados

    vocabulario = vocabulario_de_marcadores(p["id"] for p in planos if p.get("id"))
    valores = _valores_dos_marcadores(preco, planos)

    for _tentativa in range(_MAX_TENTATIVAS):
        bruto = portal.responder(contexto)
        if bruto is None:  # porta indisponível (sem chave, rede, timeout, esquema) — tentativa reprovada
            continue
        try:
            validar_resposta_orientada(bruto, vocabulario)
            validar_frases_proibidas(bruto)
            return preencher_marcadores(bruto, valores), portal.origem_do_texto, None, dados_usados
        except MarcadorInvalido:
            continue

    return _TEXTO_ENCAMINHAMENTO_PARA_CORRETOR, ORIGEM_TEXTO_FIXO, MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL, dados_usados


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
) -> tuple[str, str, Intencao | None]:
    """Classifica uma mensagem livre do lead (fora do fluxo estruturado de coleta) e desvia para
    `montar_e_responder` quando a intenção reconhecida é `Intencao.OBJECAO_DE_PRECO` **e** já
    existe uma cotação para explicar (`preco_atual`). Para qualquer outra intenção, sem intenção
    reconhecida, ou objeção sem cotação ainda: devolve o texto fixo `_TEXTO_FORA_DE_ESCOPO` (issue
    #58, veredito da auditoria do PR #75, bloqueante B3 — antes devolvia `None` e o lead ficava
    SEM NENHUMA resposta na tela; esta rota só é chamada pelo campo de objeção da tela, dedicado a
    dúvida de preço, não pelo fluxo guiado normal, então "não responder nada" nunca foi a opção
    certa aqui). Nunca devolve `None` — sempre há uma resposta para o front mostrar.

    Mesma disciplina de privacidade de `aplicacao.servico_conversa.extrair_dados_da_mensagem`:
    texto BRUTO nunca vai ao portal de linguagem sem passar por `redator_pii.redigir_texto`.

    `trilha`, se passado, grava `mensagem_recebida` (a pergunta do lead, mascarada), depois
    `mensagem_enviada` (a resposta, com `dados_usados` — issue #58, bloqueante B5) e, quando a
    resposta é um encaminhamento, `handoff` — mesma disciplina de
    `aplicacao.servico_conversa.conduzir_conversa` (trilha é responsabilidade de QUEM ORQUESTRA,
    nunca da porta nem do adaptador)."""
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

    if intencao == Intencao.OBJECAO_DE_PRECO and preco_atual is not None:
        texto, origem, motivo_handoff, dados_usados = montar_e_responder(
            portal=portal_de_resposta,
            preco=preco_atual,
            planos=planos,
            servico_conhecimento=servico_conhecimento,
            configuracao=configuracao,
            texto_do_lead=texto_mascarado,
            tentativas_ja_feitas=_tentativas_de_objecao_ja_feitas(trilha, estado.conversation_id),
        )
        regra_aplicada = _REGRA_OBJECAO_DE_PRECO
    else:
        texto, origem, motivo_handoff, dados_usados = _TEXTO_FORA_DE_ESCOPO, ORIGEM_TEXTO_FORA_DE_ESCOPO, None, ()
        regra_aplicada = "resposta_orientada:fora_de_escopo"

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
                regra_aplicada=regra_aplicada,
                origem_do_texto=origem,
                dados_usados=dados_usados,
                quote_attempt_id=preco_atual.quote_attempt_id if preco_atual is not None else None,
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
            # issue #57 (S8 do roteiro de aceite): este fluxo não passa por `conduzir_conversa`, e
            # não constrói `dominio.decisao.Decisao` (não há `politica.decidir` aqui) — por isso não
            # reusa `aplicacao.servico_conversa.registrar_status_do_turno`, que exige uma. Chama
            # `registrar_mudanca_de_status` direto, com a MESMA regra genérica da condição 3
            # (qualquer encaminhamento vira AGUARDANDO_CORRETOR, sem caso especial por motivo).
            registrar_mudanca_de_status(
                trilha, estado.conversation_id, StatusDaConversa.AGUARDANDO_CORRETOR, origem="automatico"
            )

    return texto, origem, intencao
