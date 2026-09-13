"""Costura da trilha no caso de uso principal (issue #7/#6, depois do merge da F4/#31). Prova, com
`RepositorioDeTrilhaMemoria` + `ServicoDeTrilha` DE VERDADE (não um espião nem um dublê próprio),
que `conduzir_conversa` grava os eventos e campos que `docs/design/ESPECIFICACAO.md` promete para o
painel — e que passa por `ServicoDeTrilha`, que redige PII sozinho (nunca chamamos o repositório
direto nem reimplementamos a regex)."""
from __future__ import annotations

import json

from aplicacao.servico_conversa import conduzir_conversa, montar_estado
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.decisao import MotivoHandoff
from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao
from infra.cliente_quote import ClienteQuoteHTTP, FakePortalDeCotacao, FakeTransporteQuote, RelogioFake, RespostaBruta
from infra.trilha_jsonl import RepositorioDeTrilhaMemoria

DADOS_COMPLETOS = {"idade": 30, "veiculo_ano": 2020, "cep": "01310-100", "plano_id": "completo"}

CAMPOS_MENSAGEM_ENVIADA_DA_ESPECIFICACAO = {
    "decisao_id",
    "regra_aplicada",
    "origem_do_texto",
    "dados_usados",
    "quote_attempt_id",
}

_PRECO = PrecoCotado(
    quote_attempt_id="attempt-1",
    conversation_id="conv-trilha",
    plano_id="completo",
    plano_nome="Completo",
    premio_mensal=245.67,
    franquia=3000.0,
    coberturas=("colisao", "roubo", "furto", "terceiros", "vidros"),
    moeda="BRL",
)


def test_conversa_de_sucesso_grava_mensagem_recebida_tentativa_decisao_e_mensagem_enviada():
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(_PRECO)])
    estado = montar_estado("conv-trilha", DADOS_COMPLETOS)

    conduzir_conversa(portal, estado, trilha=trilha)

    eventos = repositorio.eventos_da_conversa("conv-trilha")
    tipos = [e["evento"] for e in eventos]
    assert tipos == ["mensagem_recebida", "decisao", "mensagem_enviada"]
    # FakePortalDeCotacao não simula tentativas HTTP individuais (ver seu docstring) — quem prova
    # tentativa_de_cotacao por tentativa é o teste com ClienteQuoteHTTP real, abaixo.


def test_mensagem_enviada_tem_todos_os_campos_da_especificacao_preenchidos():
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(_PRECO)])
    estado = montar_estado("conv-trilha", DADOS_COMPLETOS)

    conduzir_conversa(portal, estado, trilha=trilha)

    (mensagem,) = [e for e in repositorio.eventos_da_conversa("conv-trilha") if e["evento"] == "mensagem_enviada"]
    faltando = CAMPOS_MENSAGEM_ENVIADA_DA_ESPECIFICACAO - set(mensagem)
    assert not faltando, f"faltam campos da ESPECIFICACAO.md: {faltando}"
    for campo in CAMPOS_MENSAGEM_ENVIADA_DA_ESPECIFICACAO:
        assert mensagem[campo], f"campo {campo!r} existe mas está vazio"


def test_mensagem_com_valor_monetario_tem_quote_attempt_id_de_tentativa_correspondente():
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(_PRECO)])
    estado = montar_estado("conv-trilha", DADOS_COMPLETOS)

    conduzir_conversa(portal, estado, trilha=trilha)

    (mensagem,) = [e for e in repositorio.eventos_da_conversa("conv-trilha") if e["evento"] == "mensagem_enviada"]
    assert "R$" in mensagem["texto"]
    assert mensagem["quote_attempt_id"] == _PRECO.quote_attempt_id


def test_cep_nao_aparece_em_claro_na_trilha_mensagem_recebida():
    """A trilha grava o resumo dos dados coletados (inclui o CEP) — quem mascara é o
    ServicoDeTrilha, sozinho. Este teste prova que o CEP em claro nunca chega ao repositório."""
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(_PRECO)])
    estado = montar_estado("conv-trilha", DADOS_COMPLETOS)

    conduzir_conversa(portal, estado, trilha=trilha)

    (recebida,) = [e for e in repositorio.eventos_da_conversa("conv-trilha") if e["evento"] == "mensagem_recebida"]
    assert "01310-100" not in recebida["texto"], f"CEP em claro na trilha: {recebida!r}"


def test_handoff_grava_reason_code_e_contexto_quando_encaminha():
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.indisponivel("upstream respondeu 502")])
    estado = montar_estado("conv-trilha", DADOS_COMPLETOS)

    conduzir_conversa(portal, estado, trilha=trilha)

    eventos = repositorio.eventos_da_conversa("conv-trilha")
    assert "handoff" in [e["evento"] for e in eventos]
    (handoff,) = [e for e in eventos if e["evento"] == "handoff"]
    assert handoff["reason_code"] == MotivoHandoff.QUOTE_INDISPONIVEL.value
    assert handoff["contexto_coletado"]["idade"] == 30


def test_uma_tentativa_de_cotacao_por_tentativa_http_de_verdade_nao_por_cotacao():
    """Com ClienteQuoteHTTP real (não o FakePortalDeCotacao) e um transporte falso que faz o
    primeiro 502 e depois 200: a trilha tem que ter DOIS eventos tentativa_de_cotacao — um por
    tentativa HTTP (ESPECIFICACAO.md §1), não um só pela cotação final."""
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)
    relogio = RelogioFake()
    resposta_502 = RespostaBruta(status_code=502, corpo={"error": "upstream_unavailable", "message": "..."})
    resposta_200 = RespostaBruta(
        status_code=200,
        corpo={
            "plano_id": "completo", "plano_nome": "Completo", "premio_mensal": 241.38,
            "franquia": 3000.0, "coberturas": ["colisao", "roubo"], "moeda": "BRL",
        },
    )
    transporte = FakeTransporteQuote(roteiro=[resposta_502, resposta_200], relogio=relogio)
    portal = ClienteQuoteHTTP("http://quote.invalido", transporte=transporte, relogio=relogio, dormir=relogio.avancar)
    estado = montar_estado("conv-trilha-2", DADOS_COMPLETOS)

    conduzir_conversa(portal, estado, trilha=trilha)

    tentativas = [e for e in repositorio.eventos_da_conversa("conv-trilha-2") if e["evento"] == "tentativa_de_cotacao"]
    assert len(tentativas) == 2, "cada tentativa HTTP grava o seu próprio evento"
    assert [t["numero_da_tentativa"] for t in tentativas] == [1, 2]
    assert [t["classificacao"] for t in tentativas] == ["indisponivel", "sucesso"]
    assert tentativas[0]["quote_attempt_id"] != tentativas[1]["quote_attempt_id"]
    assert tentativas[1]["premio_mensal"] == 241.38


def test_sem_trilha_conduzir_conversa_continua_funcionando_igual_a_antes():
    """trilha=None (o padrão) não deve mudar nenhum comportamento observável — compatibilidade
    com quem já chamava conduzir_conversa antes da costura desta frente."""
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(_PRECO)])
    estado = montar_estado("conv-sem-trilha", DADOS_COMPLETOS)

    turno = conduzir_conversa(portal, estado)

    assert turno.texto
    assert "Completo" in turno.texto


def test_nome_whatsapp_e_email_nunca_aparecem_em_claro_em_nenhum_evento_da_trilha():
    """Núcleo da decisão C.1 do ADR-0005 (issue #46): `nome`/`whatsapp`/`email` ficam só em
    `EstadoDaConversa` (para o chat lembrar entre turnos) e em `ContatoLead`
    (`aplicacao.servico_contato`) — NUNCA na trilha, nem em texto livre (mensagem_recebida,
    mensagem_enviada), nem em `contexto_coletado` do handoff. Prova por grep no JSON serializado de
    CADA evento gravado, não por "não deveria estar lá"."""
    nome = "Ursula Souza Alcantara"
    whatsapp = "+55 21 97224-2584"
    email = "ursula.alcantara@example.com"

    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.indisponivel("upstream respondeu 502")])
    estado = montar_estado(
        "conv-privacidade",
        {**DADOS_COMPLETOS, "nome": nome, "whatsapp": whatsapp, "email": email, "veiculo_modelo": "Onix"},
    )
    assert estado.nome == nome
    assert estado.whatsapp == whatsapp
    assert estado.email == email

    conduzir_conversa(portal, estado, trilha=trilha)

    eventos = repositorio.eventos_da_conversa("conv-privacidade")
    assert "handoff" in [e["evento"] for e in eventos], "cenário precisa chegar a um handoff para testar contexto_coletado"
    for evento in eventos:
        serializado = json.dumps(evento, ensure_ascii=False)
        assert nome not in serializado, f"nome vazou no evento {evento['evento']!r}: {serializado!r}"
        assert whatsapp not in serializado, f"whatsapp vazou no evento {evento['evento']!r}: {serializado!r}"
        assert email not in serializado, f"email vazou no evento {evento['evento']!r}: {serializado!r}"
    (handoff,) = [e for e in eventos if e["evento"] == "handoff"]
    assert handoff["contexto_coletado"]["veiculo_modelo"] == "Onix", (
        "veiculo_modelo NÃO é PII na mesma categoria (item B.3.5) e deve aparecer no contexto"
    )


def test_payload_enviado_a_quote_carrega_o_cep_real_nunca_o_redigido():
    """Achado da auditoria do PR #35: nada garante hoje que uma futura mudança não faça a
    redação da trilha vazar para o payload de saída — o que quebraria a /quote em silêncio (CEP
    [REDIGIDO] não bate no formato, handoff ou preço errado). Este teste espia o TRANSPORTE HTTP
    (não a trilha) e prova que o CEP que chega lá é o real, mesmo com a trilha ligada no mesmo
    fluxo."""
    payloads_capturados: list[dict] = []

    def transporte_espiao(payload: dict, timeout_segundos: float) -> RespostaBruta:
        payloads_capturados.append(payload)
        return RespostaBruta(
            status_code=200,
            corpo={
                "plano_id": "completo", "plano_nome": "Completo", "premio_mensal": 241.38,
                "franquia": 3000.0, "coberturas": ["colisao", "roubo"], "moeda": "BRL",
            },
        )

    cliente = ClienteQuoteHTTP("http://quote.invalido", transporte=transporte_espiao)
    repositorio = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio)
    estado = montar_estado("conv-payload-real", DADOS_COMPLETOS)

    conduzir_conversa(cliente, estado, trilha=trilha)

    assert len(payloads_capturados) == 1
    assert payloads_capturados[0]["cep"] == "01310-100"
    # e, ainda assim, a trilha grava redigido -- as duas coisas têm que ser verdade ao mesmo tempo.
    (recebida,) = [e for e in repositorio.eventos_da_conversa("conv-payload-real") if e["evento"] == "mensagem_recebida"]
    assert "01310-100" not in recebida["texto"]
