"""`sender_role` de `MensagemEnviada` em `processar_mensagem_livre` (issue #86, PR a; I-17,
`dominio/CONTRACT.md`) — extraído de `test_servico_resposta_orientada.py` pelo `file-loc-ceiling`
(arquivo original bateu no teto de 600 linhas). Reusa os MESMOS dublês/helpers daquele arquivo
(LEI 11 — nunca duplicados), mesma disciplina de `tests/interfaces/test_rotas_resposta_orientada.py`
importando de `tests/interfaces/test_servidor.py`.
"""

from __future__ import annotations

from dominio.configuracao_comercial import ConfiguracaoComercial

from aplicacao.servico_resposta_orientada import processar_mensagem_livre
from aplicacao.servico_trilha import ServicoDeTrilha
from infra.trilha_jsonl import RepositorioDeTrilhaMemoria

from tests.aplicacao.test_servico_resposta_orientada import (
    _PortalDeLinguagemComIntent,
    _PortalFixo,
    _estado,
    _preco,
    _servico_com_ficha_publicada,
)


def test_trilha_grava_sender_role_ia_quando_vem_do_llm():
    """issue #86 (I-17): a resposta que vem mesmo do LLM (origem_do_texto começa com
    "llm_resposta:") grava sender_role="ia" — nunca confundida com o texto fixo determinístico."""
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("objecao_de_preco"),
        portal_de_resposta=_PortalFixo("No plano Completo, a franquia é {{franquia}}."),
        texto_bruto="achei caro",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    enviada = next(e for e in eventos if e["evento"] == "mensagem_enviada")
    assert enviada["sender_role"] == "ia"


def test_trilha_grava_sender_role_agente_quando_e_texto_fixo():
    # issue #86 (I-17): texto fixo (fora de escopo OU encaminhamento) nunca é "ia".
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("informar_dados"),
        portal_de_resposta=_PortalFixo("não deveria ser chamado"),
        texto_bruto="tenho 35 anos",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    enviada = next(e for e in eventos if e["evento"] == "mensagem_enviada")
    assert enviada["sender_role"] == "agente"
