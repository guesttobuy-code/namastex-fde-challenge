"""A porta `PortalDeCotacao` (issue #6) tem exatamente dois adaptadores: o real
(`ClienteQuoteHTTP`) e o dublê (`FakePortalDeCotacao`) — os dois vivem em `infra/cliente_quote.py`.
Este teste prova que os dois cumprem a mesma forma: `cotar(payload, conversation_id) ->
ResultadoDaCotacao`, com o mesmo comportamento observável para quem só conhece a porta."""
from __future__ import annotations

from dominio.resultado_cotacao import ResultadoDaCotacao, StatusCotacao
from infra.cliente_quote import ClienteQuoteHTTP, FakePortalDeCotacao, FakeTransporteQuote, RelogioFake, RespostaBruta

PAYLOAD = {"plano_id": "essencial", "idade": 25, "veiculo_ano": 2018}
CONVERSATION_ID = "conv-abc"


def test_fake_e_real_cumprem_a_mesma_forma_da_porta():
    resultado_esperado = ResultadoDaCotacao.indisponivel("upstream fora do ar (dublê)")
    fake = FakePortalDeCotacao(roteiro=[resultado_esperado])

    relogio = RelogioFake()
    resposta_200 = RespostaBruta(
        status_code=200,
        corpo={
            "plano_id": "essencial",
            "plano_nome": "Essencial",
            "premio_mensal": 119.9,
            "franquia": 4500.0,
            "coberturas": ["colisao", "roubo", "furto"],
            "moeda": "BRL",
        },
    )
    real = ClienteQuoteHTTP(
        "http://quote-service.invalido",
        transporte=FakeTransporteQuote(roteiro=[resposta_200], relogio=relogio),
        relogio=relogio,
        dormir=relogio.avancar,
    )

    for portal in (fake, real):
        resultado = portal.cotar(PAYLOAD, CONVERSATION_ID)
        assert isinstance(resultado, ResultadoDaCotacao)

    assert fake.cotar(PAYLOAD, CONVERSATION_ID).status == StatusCotacao.INDISPONIVEL
    assert real.cotar(PAYLOAD, CONVERSATION_ID).status == StatusCotacao.SUCESSO
