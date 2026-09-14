"""Os dois adaptadores da porta `PortalDeRespostaOrientada` (issue #58, frente `ia-responde`). O
determinístico é o dublê usado quando `LLM_PROVEDOR=deterministico` (sem chave, sem rede); o
OpenRouter é medido com TRANSPORTE FALSO — nenhum teste desta suíte chama a API de verdade.
"""

from __future__ import annotations

from infra.adaptador_de_linguagem import (
    AdaptadorDeRespostaOrientadaDeterministico,
    AdaptadorDeRespostaOrientadaOpenRouter,
    RespostaBrutaLLM,
    criar_adaptador_de_resposta_orientada,
)

_CONTEXTO_MINIMO = {
    "ficha_da_cotacao": {"plano_nome": "Completo", "premio_mensal": 241.38, "franquia": 3000.0},
    "planos": [{"id": "completo", "nome": "Completo", "franquia": 3000}],
    "fichas_de_objecao": [],
    "configuracao_comercial": {"encaminhar_lead_fora_do_padrao": True},
}


# ─── determinístico ──────────────────────────────────────────────────────────


def test_determinstico_sempre_devolve_none_gerar_resposta_sem_llm_nao_e_seguro():
    """Decisão da coordenação (#58): sem chave, não dá pra gerar uma resposta com segurança —
    diferente da extração (regex dá conta), aqui o dublê sinaliza "indisponível", mesmo caminho de
    uma falha de rede, para `montar_e_responder` encaminhar ao corretor em vez de arriscar."""
    texto = AdaptadorDeRespostaOrientadaDeterministico().responder(_CONTEXTO_MINIMO)
    assert texto is None


def test_determinstico_tem_origem_propria():
    assert (
        AdaptadorDeRespostaOrientadaDeterministico().origem_do_texto
        == "extrator_deterministico:resposta_v1"
    )


def test_criar_adaptador_padrao_e_deterministico_sem_ler_chave():
    adaptador = criar_adaptador_de_resposta_orientada(env={})
    assert isinstance(adaptador, AdaptadorDeRespostaOrientadaDeterministico)


# ─── OpenRouter — transporte falso, sem rede ─────────────────────────────────


def _corpo_sucesso(texto: str) -> dict:
    return {
        "choices": [{"message": {"content": texto}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "cost": 0.0001},
    }


def test_openrouter_devolve_o_texto_do_transporte_fake():
    def transporte(payload, chave, timeout):
        assert chave == "chave-de-teste"
        return RespostaBrutaLLM(status_code=200, corpo=_corpo_sucesso("Sai por {{premio_mensal}}."))

    adaptador = AdaptadorDeRespostaOrientadaOpenRouter(chave="chave-de-teste", transporte=transporte)
    assert adaptador.responder(_CONTEXTO_MINIMO) == "Sai por {{premio_mensal}}."


def test_openrouter_manda_os_marcadores_disponiveis_no_conteudo_enviado():
    conteudos_enviados = []

    def transporte(payload, chave, timeout):
        conteudos_enviados.append(payload["messages"][1]["content"])
        return RespostaBrutaLLM(status_code=200, corpo=_corpo_sucesso("ok {{franquia}}"))

    adaptador = AdaptadorDeRespostaOrientadaOpenRouter(chave="x", transporte=transporte)
    adaptador.responder(_CONTEXTO_MINIMO)
    assert "franquia_completo" in conteudos_enviados[0]


def test_openrouter_timeout_devolve_none_nunca_levanta():
    def transporte(payload, chave, timeout):
        return RespostaBrutaLLM(status_code=None, corpo=None, excedeu_o_tempo=True)

    adaptador = AdaptadorDeRespostaOrientadaOpenRouter(chave="x", transporte=transporte)
    assert adaptador.responder(_CONTEXTO_MINIMO) is None


def test_openrouter_status_nao_200_devolve_none():
    def transporte(payload, chave, timeout):
        return RespostaBrutaLLM(status_code=401, corpo={"error": "invalid api key"})

    adaptador = AdaptadorDeRespostaOrientadaOpenRouter(chave="x", transporte=transporte)
    assert adaptador.responder(_CONTEXTO_MINIMO) is None


def test_openrouter_corpo_sem_choices_devolve_none_nunca_levanta():
    def transporte(payload, chave, timeout):
        return RespostaBrutaLLM(status_code=200, corpo={"usage": {}})

    adaptador = AdaptadorDeRespostaOrientadaOpenRouter(chave="x", transporte=transporte)
    assert adaptador.responder(_CONTEXTO_MINIMO) is None


def test_openrouter_texto_vazio_devolve_none():
    def transporte(payload, chave, timeout):
        return RespostaBrutaLLM(status_code=200, corpo=_corpo_sucesso("   "))

    adaptador = AdaptadorDeRespostaOrientadaOpenRouter(chave="x", transporte=transporte)
    assert adaptador.responder(_CONTEXTO_MINIMO) is None


def test_openrouter_tira_cerca_de_markdown_do_texto():
    def transporte(payload, chave, timeout):
        return RespostaBrutaLLM(status_code=200, corpo=_corpo_sucesso("```\nSai por {{premio_mensal}}.\n```"))

    adaptador = AdaptadorDeRespostaOrientadaOpenRouter(chave="x", transporte=transporte)
    assert adaptador.responder(_CONTEXTO_MINIMO) == "Sai por {{premio_mensal}}."


def test_criar_adaptador_openrouter_sem_chave_falha_alto():
    import pytest

    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        criar_adaptador_de_resposta_orientada(provedor="openrouter", env={})
