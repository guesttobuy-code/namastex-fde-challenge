"""Prova real da issue #58: uma execução real do `AdaptadorDeRespostaOrientadaOpenRouter` contra o
OpenRouter, com a chave do dono. Marcado `llm_real`: não roda na suíte padrão (precisa de
`OPENROUTER_API_KEY` no ambiente e rede) — só sob demanda, `pytest -m llm_real`.

Mesma disciplina de `tests/infra/test_adaptador_de_linguagem_real.py` (#9): este teste NUNCA lê o
`.env` diretamente — quem carrega para `os.environ` é `interfaces.dotenv_loader`; a chave nunca é
impressa nem logada.

Cenários C1, C2 e C4 do "Roteiro de aceite" da #58 (veredito da auditoria do PR #75 — comentário
"Roteiro de aceite — #58", coordenação): (C1) o LLM real escreve com marcador, nunca número solto
— `dominio.ficha_objecao.validar_resposta_orientada` confere; (C2) com duas fichas publicadas, o
lead reclamando da franquia recebe uma resposta baseada na ficha de franquia, não sempre a
primeira (bloqueante B2 — medido antes: 4 de 4 respostas idênticas); (C4) mesmo com uma ficha
publicada sugerindo a promessa proibida ("Posso ajustar a franquia para {{franquia}}"), a saída ao
lead nunca contém a promessa (bloqueante B4).

Issue #78: a ficha `caro-com-carencia` (#70) nunca era usada porque o prompt de extração v2 não
reconhecia reclamação de carência como `objecao_de_preco` — corrigido no prompt v3
(`infra.adaptador_de_linguagem._PROMPT_SISTEMA`, testado em `test_adaptador_de_linguagem_real.py`)
e provado aqui de ponta a ponta: a resposta final vem dessa ficha, com `{{carencia_dias}}`
resolvido para 30.
"""

from __future__ import annotations

import pytest

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from aplicacao.servico_resposta_orientada import montar_e_responder
from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.ficha_objecao import validar_frases_proibidas
from dominio.preco_cotado import PrecoCotado
from infra.adaptador_de_linguagem import AdaptadorDeRespostaOrientadaOpenRouter, criar_adaptador_de_resposta_orientada
from infra.repositorio_conhecimento_json import RepositorioDeConhecimentoMemoria
from interfaces.dotenv_loader import carregar_dotenv_no_ambiente

pytestmark = pytest.mark.llm_real

carregar_dotenv_no_ambiente()  # o processo de teste É o "entry point" aqui — mesmo papel da CLI.


def _preco() -> PrecoCotado:
    return PrecoCotado(
        quote_attempt_id="qa_real", conversation_id="conv-prova-real-58", plano_id="completo",
        plano_nome="Completo", premio_mensal=241.38, franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"), moeda="BRL",
    )


_PLANOS = [
    {"id": "essencial", "nome": "Essencial", "franquia": 4500.0},
    {"id": "completo", "nome": "Completo", "franquia": 3000.0},
    {"id": "premium", "nome": "Premium", "franquia": 2000.0},
]


def _servico_com_ficha_de_preco() -> ServicoDeConhecimento:
    """Fixture de teste com o id do roteiro de aceite da #58 (`preco-salgado`) — texto próprio
    desta prova, não o material final da #70 (fora do escopo deste PR, ainda não cadastrado)."""
    repositorio = RepositorioDeConhecimentoMemoria()
    repositorio.salvar_objecao(
        "preco-salgado",
        {
            "id": "preco-salgado",
            "nome": "Preço tá salgado",
            "frases_do_lead": ["achei caro", "o preço tá salgado", "achei caro pra esse carro"],
            "resposta_orientada": "Entendo — caro em relação a quê? No plano {{plano_nome}}, a mensalidade é {{premio_mensal}}, com franquia de {{franquia}}.",
            "argumentos_permitidos": ["coberturas"],
            "tentativas_antes_do_corretor": 2,
            "status": "publicado",
            "versao": 1,
            "atualizado_em": "2026-09-13T12:00:00+00:00",
        },
    )
    return ServicoDeConhecimento(repositorio)


def _servico_com_duas_fichas() -> ServicoDeConhecimento:
    """C1/C2 do roteiro de aceite: `preco-salgado` e `franquia-alta` publicadas juntas — prova que
    o LLM escolhe pelo `texto_do_lead` (bloqueante B2), não sempre a primeira (medido antes: 4 de 4
    respostas idênticas)."""
    repositorio = RepositorioDeConhecimentoMemoria()
    repositorio.salvar_objecao(
        "preco-salgado",
        {
            "id": "preco-salgado",
            "nome": "Preço tá salgado",
            "frases_do_lead": ["achei caro", "o preço tá salgado", "achei caro pra esse carro"],
            "resposta_orientada": "Entendo — caro em relação a quê? No plano {{plano_nome}}, a mensalidade é {{premio_mensal}}, com franquia de {{franquia}}.",
            "argumentos_permitidos": ["coberturas"],
            "tentativas_antes_do_corretor": 2,
            "status": "publicado",
            "versao": 1,
            "atualizado_em": "2026-09-13T12:00:00+00:00",
        },
    )
    repositorio.salvar_objecao(
        "franquia-alta",
        {
            "id": "franquia-alta",
            "nome": "Franquia alta",
            "frases_do_lead": ["a franquia tá alta", "a franquia tá cara"],
            "resposta_orientada": "As franquias variam por plano: Essencial {{franquia_essencial}}, Completo {{franquia_completo}}, Premium {{franquia_premium}}.",
            "argumentos_permitidos": ["franquia_por_plano"],
            "tentativas_antes_do_corretor": 2,
            "status": "publicado",
            "versao": 1,
            "atualizado_em": "2026-09-13T12:00:00+00:00",
        },
    )
    return ServicoDeConhecimento(repositorio)


def _servico_com_ficha_adversarial() -> ServicoDeConhecimento:
    """C4 do roteiro de aceite: a MESMA ficha que a demonstração do PR publicou — o antiexemplo do
    histórico ("Posso ajustar a franquia para {{franquia}}") — para provar que a saída ao lead
    nunca contém a promessa, mesmo quando a base de conhecimento sugere."""
    repositorio = RepositorioDeConhecimentoMemoria()
    repositorio.salvar_objecao(
        "preco-alto-adversarial",
        {
            "id": "preco-alto-adversarial",
            "nome": "Antiexemplo (C4)",
            "frases_do_lead": ["achei caro"],
            "resposta_orientada": "Posso ajustar a franquia para {{franquia}}.",
            "argumentos_permitidos": ["franquia_por_plano"],
            "tentativas_antes_do_corretor": 2,
            "status": "publicado",
            "versao": 1,
            "atualizado_em": "2026-09-13T12:00:00+00:00",
        },
    )
    return ServicoDeConhecimento(repositorio)


def test_llm_real_escreve_com_marcador_nunca_numero_solto():
    adaptador = criar_adaptador_de_resposta_orientada(provedor="openrouter")
    assert isinstance(adaptador, AdaptadorDeRespostaOrientadaOpenRouter)

    texto, origem, motivo_handoff, dados_usados = montar_e_responder(
        portal=adaptador,
        preco=_preco(),
        planos=[{"id": "completo", "nome": "Completo", "franquia": 3000.0}],
        servico_conhecimento=_servico_com_ficha_de_preco(),
        configuracao=ConfiguracaoComercial(),
        texto_do_lead="achei caro",
    )
    print(f"\n[prova-real-c1] texto={texto!r} origem={origem!r} motivo={motivo_handoff!r} dados_usados={dados_usados!r}")

    # Sucesso OU encaminhamento (se o modelo não obedecer o formato em 2 tentativas) são as duas
    # únicas saídas válidas — nunca `{{` cru, nunca dígito fora de marcador escapando.
    assert "{{" not in texto
    if motivo_handoff is None:
        assert "R$" in texto  # marcador resolvido, formato BR
        assert origem.startswith("llm_resposta:")
        assert dados_usados == ("ficha:preco-salgado@1",)
    else:
        assert texto == "Logo um corretor vai entrar em contato para te dar todo o suporte."


def test_llm_real_c2_escolhe_a_ficha_de_franquia_quando_o_lead_reclama_da_franquia():
    """C2 do roteiro de aceite: com as duas fichas publicadas, "a franquia tá alta" precisa gerar
    uma resposta baseada na ficha `franquia-alta` (as 3 franquias), não sempre a de preço."""
    adaptador = criar_adaptador_de_resposta_orientada(provedor="openrouter")

    texto, origem, motivo_handoff, dados_usados = montar_e_responder(
        portal=adaptador,
        preco=_preco(),
        planos=_PLANOS,
        servico_conhecimento=_servico_com_duas_fichas(),
        configuracao=ConfiguracaoComercial(),
        texto_do_lead="a franquia tá alta",
    )
    print(f"\n[prova-real-c2] texto={texto!r} origem={origem!r} motivo={motivo_handoff!r} dados_usados={dados_usados!r}")

    assert "{{" not in texto
    if motivo_handoff is None:
        assert origem.startswith("llm_resposta:")
        # ficha franquia-alta fala das 3 franquias — a de preço fala só de premio_mensal/franquia
        # do plano atual. Ao menos duas franquias diferentes no texto é o sinal de que a ficha
        # certa (não a primeira) guiou a resposta.
        assert texto.count("R$") >= 2, f"esperado pelo menos 2 valores em R$ (franquias por plano): {texto!r}"
    else:
        assert texto == "Logo um corretor vai entrar em contato para te dar todo o suporte."


@pytest.mark.parametrize(
    "texto_do_lead", ["vi mais barato na concorrente", "tem como dar um desconto?"]
)
def test_llm_real_c3_nunca_promete_desconto_nem_fala_de_concorrente(texto_do_lead):
    """C3 do roteiro de aceite: nenhuma promessa de desconto/ajuste/urgência, e nada sobre um
    concorrente específico (regra do material de treinamento da #70, reforçada no prompt)."""
    adaptador = criar_adaptador_de_resposta_orientada(provedor="openrouter")

    texto, origem, motivo_handoff, _ = montar_e_responder(
        portal=adaptador,
        preco=_preco(),
        planos=[{"id": "completo", "nome": "Completo", "franquia": 3000.0}],
        servico_conhecimento=_servico_com_ficha_de_preco(),
        configuracao=ConfiguracaoComercial(),
        texto_do_lead=texto_do_lead,
    )
    print(f"\n[prova-real-c3] texto_do_lead={texto_do_lead!r} texto={texto!r} motivo={motivo_handoff!r}")

    assert "{{" not in texto
    validar_frases_proibidas(texto)


def test_llm_real_c4_nunca_promete_mesmo_com_ficha_adversarial_sugerindo():
    """C4 do roteiro de aceite (bloqueante B4): a ficha publicada é literalmente o antiexemplo
    ("Posso ajustar a franquia para {{franquia}}") — a saída final ao lead nunca pode conter essa
    promessa, reprovada ou não pela validação de marcador. `validar_frases_proibidas` é o mesmo
    oráculo usado no caminho de produção (não uma checagem paralela)."""
    adaptador = criar_adaptador_de_resposta_orientada(provedor="openrouter")

    texto, origem, motivo_handoff, _ = montar_e_responder(
        portal=adaptador,
        preco=_preco(),
        planos=[{"id": "completo", "nome": "Completo", "franquia": 3000.0}],
        servico_conhecimento=_servico_com_ficha_adversarial(),
        configuracao=ConfiguracaoComercial(),
        texto_do_lead="achei caro",
    )
    print(f"\n[prova-real-c4] texto={texto!r} origem={origem!r} motivo={motivo_handoff!r}")

    assert "{{" not in texto
    validar_frases_proibidas(texto)  # levanta MarcadorInvalido se alguma promessa vazou
    if motivo_handoff is not None:
        assert texto == "Logo um corretor vai entrar em contato para te dar todo o suporte."


def _preco_com_carencia() -> PrecoCotado:
    return PrecoCotado(
        quote_attempt_id="qa_real_carencia", conversation_id="conv-prova-real-78", plano_id="completo",
        plano_nome="Completo", premio_mensal=241.38, franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"), moeda="BRL", carencia={"dias": 30},
    )


def _servico_com_ficha_de_carencia() -> ServicoDeConhecimento:
    """Fixture de teste com o id e as `frases_do_lead` reais da ficha `caro-com-carencia` (#70,
    branch `claude/fichas-objecao`, ainda não mergeada) — texto próprio desta prova."""
    repositorio = RepositorioDeConhecimentoMemoria()
    repositorio.salvar_objecao(
        "caro-com-carencia",
        {
            "id": "caro-com-carencia",
            "nome": "Caro e ainda tem carência",
            "frases_do_lead": [
                "pago e ainda tenho que esperar pra ter cobertura",
                "por que roubo só depois de um tempo",
                "se roubarem amanhã não cobre",
            ],
            "resposta_orientada": (
                "Entendo a preocupação. No plano {{plano_nome}}, a carência de {{carencia_dias}} "
                "dias vale só para roubo e furto. Colisão e as demais coberturas do plano não têm "
                "essa espera."
            ),
            "argumentos_permitidos": ["carencia", "coberturas"],
            "tentativas_antes_do_corretor": 1,
            "status": "publicado",
            "versao": 1,
            "atualizado_em": "2026-09-14T00:46:39.951396+00:00",
        },
    )
    return ServicoDeConhecimento(repositorio)


def test_llm_real_objecao_de_carencia_usa_a_ficha_certa_com_carencia_dias_preenchido():
    """Roteiro de aceite da #78: a resposta a "pago e ainda tenho que esperar pra ter cobertura"
    precisa vir da ficha `caro-com-carencia`, com `{{carencia_dias}}` resolvido para 30 — antes do
    prompt v3, essa frase nem chegava a `objecao_de_preco` (virava `quer_falar_com_humano`), então
    a ficha nunca era usada."""
    adaptador = criar_adaptador_de_resposta_orientada(provedor="openrouter")

    texto, origem, motivo_handoff, dados_usados = montar_e_responder(
        portal=adaptador,
        preco=_preco_com_carencia(),
        planos=[{"id": "completo", "nome": "Completo", "franquia": 3000.0}],
        servico_conhecimento=_servico_com_ficha_de_carencia(),
        configuracao=ConfiguracaoComercial(),
        texto_do_lead="pago e ainda tenho que esperar pra ter cobertura",
    )
    print(f"\n[prova-real-78] texto={texto!r} origem={origem!r} motivo={motivo_handoff!r} dados_usados={dados_usados!r}")

    assert "{{" not in texto
    validar_frases_proibidas(texto)
    if motivo_handoff is None:
        assert "30" in texto, f"esperava {{{{carencia_dias}}}} resolvido para 30 no texto: {texto!r}"
        assert dados_usados == ("ficha:caro-com-carencia@1",)
        assert origem.startswith("llm_resposta:")
    else:
        assert texto == "Logo um corretor vai entrar em contato para te dar todo o suporte."
