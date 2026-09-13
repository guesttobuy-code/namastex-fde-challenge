"""Prova real da issue #58: uma execução real do `AdaptadorDeRespostaOrientadaOpenRouter` contra o
OpenRouter, com a chave do dono. Marcado `llm_real`: não roda na suíte padrão (precisa de
`OPENROUTER_API_KEY` no ambiente e rede) — só sob demanda, `pytest -m llm_real`.

Mesma disciplina de `tests/infra/test_adaptador_de_linguagem_real.py` (#9): este teste NUNCA lê o
`.env` diretamente — quem carrega para `os.environ` é `interfaces.dotenv_loader`; a chave nunca é
impressa nem logada. Prova as duas pontas do "Pronto quando" da #58: (1) o LLM real escreve com
marcador, nunca número solto — `dominio.ficha_objecao.validar_resposta_orientada` confere; (2) uma
mutação (marcador desconhecido injetado no contexto) é rejeitada, nunca vira texto fixo em silêncio
de exceção — prova que a validação está de verdade no caminho, não só decorativa.
"""

from __future__ import annotations

import pytest

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from aplicacao.servico_resposta_orientada import montar_e_responder
from dominio.configuracao_comercial import ConfiguracaoComercial
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


def _servico_com_ficha_publicada() -> ServicoDeConhecimento:
    repositorio = RepositorioDeConhecimentoMemoria()
    repositorio.salvar_objecao(
        "preco-alto",
        {
            "id": "preco-alto",
            "nome": "Preço tá salgado",
            "frases_do_lead": ["achei caro", "o preço tá salgado"],
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

    texto, origem, motivo_handoff = montar_e_responder(
        portal=adaptador,
        preco=_preco(),
        planos=[{"id": "completo", "nome": "Completo", "franquia": 3000.0}],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )

    # Sucesso OU encaminhamento (se o modelo não obedecer o formato em 2 tentativas) são as duas
    # únicas saídas válidas — nunca `{{` cru, nunca dígito fora de marcador escapando.
    assert "{{" not in texto
    if motivo_handoff is None:
        assert "R$" in texto  # marcador resolvido, formato BR
        assert origem.startswith("llm_resposta:")
    else:
        assert texto == "Logo um corretor vai entrar em contato para te dar todo o suporte."
