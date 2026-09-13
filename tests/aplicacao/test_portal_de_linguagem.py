"""A porta `PortalDeLinguagem` (issue #9) tem exatamente dois adaptadores: o determinístico
(padrão) e o OpenRouter (com transporte fake aqui, sem rede). Este teste prova que os dois cumprem
a mesma forma: `extrair(texto_mascarado, estado_atual) -> SaidaDeLinguagem`, com `origem_do_texto`
próprio — no padrão de `tests/aplicacao/test_portal_de_cotacao.py`."""

from __future__ import annotations

import json

from dominio.estado_conversa import EstadoDaConversa
from dominio.saida_de_linguagem import SaidaDeLinguagem
from infra.adaptador_de_linguagem import (
    AdaptadorDeLinguagemDeterministico,
    AdaptadorDeLinguagemOpenRouter,
    RespostaBrutaLLM,
)

ESTADO = EstadoDaConversa(conversation_id="conv-abc")
TEXTO = "tenho 30 anos e um sandero 2022"


def _transporte_openrouter_fake(payload, chave, timeout):
    corpo = {
        "choices": [{"message": {"content": json.dumps({
            "idade": 30, "veiculo_ano": 2022, "plano_id": None, "data_inicio": None,
            "intent": "informar_dados", "ambiguidades": [],
        })}}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": 10, "cost": 0.0001},
    }
    return RespostaBrutaLLM(status_code=200, corpo=corpo)


def test_deterministico_e_openrouter_cumprem_a_mesma_forma_da_porta():
    deterministico = AdaptadorDeLinguagemDeterministico()
    openrouter = AdaptadorDeLinguagemOpenRouter(chave="x", transporte=_transporte_openrouter_fake)

    for portal in (deterministico, openrouter):
        saida = portal.extrair(TEXTO, ESTADO)
        assert isinstance(saida, SaidaDeLinguagem)
        assert isinstance(portal.origem_do_texto, str) and portal.origem_do_texto

    assert deterministico.extrair(TEXTO, ESTADO).idade == 30
    assert openrouter.extrair(TEXTO, ESTADO).idade == 30
    assert deterministico.origem_do_texto != openrouter.origem_do_texto
