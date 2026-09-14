"""Status da conversa no fluxo de resposta orientada (issue #57, P14, PR 2 de 2): S8 do roteiro de
aceite (a IA esgotando as tentativas grava `status_alterado` `para=aguardando_corretor`, não só
`handoff`) e o item 6 da #58 ("tentativas antes do corretor" da ficha — decisão registrada no PR
#75: "fora daquele PR, vai para a #57 PR 2"). Arquivo PRÓPRIO — `test_servico_resposta_orientada.py`
já estava no teto de linhas do `file-loc-ceiling`; reusa os dublês/helpers de lá (LEI 11, dono único
dos fixtures deste caso de uso)."""
from __future__ import annotations

from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.decisao import MotivoHandoff
from dominio.eventos_trilha import MensagemEnviada
from dominio.intencao import Intencao

from aplicacao.servico_resposta_orientada import (
    _REGRA_OBJECAO_DE_PRECO,
    ORIGEM_TEXTO_FIXO,
    montar_e_responder,
    processar_mensagem_livre,
)
from aplicacao.servico_trilha import ServicoDeTrilha
from infra.trilha_jsonl import RepositorioDeTrilhaMemoria
from tests.aplicacao.test_servico_resposta_orientada import (
    TEXTO_ENCAMINHAMENTO,
    _estado,
    _PortalDeLinguagemComIntent,
    _PortalFixo,
    _PortalIndisponivel,
    _preco,
    _servico_com_ficha_publicada,
)


def test_trilha_grava_status_alterado_aguardando_corretor_quando_encaminha_ao_corretor():
    """S8 do roteiro de aceite: a IA esgotando as tentativas (aqui via `_PortalIndisponivel`) grava
    `handoff` **e** `status_alterado` `para=aguardando_corretor` — este fluxo não passa por
    `conduzir_conversa`, então precisa do próprio ponto de integração
    (`aplicacao.servico_status_conversa.registrar_mudanca_de_status`, o MESMO gravador do turno
    automático e das transições manuais, LEI 11)."""
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("objecao_de_preco"),
        portal_de_resposta=_PortalIndisponivel(),
        texto_bruto="achei caro",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    assert any(e["evento"] == "handoff" for e in eventos)
    (mudanca,) = [e for e in eventos if e["evento"] == "status_alterado"]
    assert mudanca["para"] == "aguardando_corretor"
    assert mudanca["origem"] == "automatico"


# ── Item 6 da #58: a ficha de `_servico_com_ficha_publicada()` tem `tentativas_antes_do_corretor: 2`.


def test_montar_e_responder_com_tentativas_esgotadas_encaminha_sem_chamar_o_llm():
    portal = _PortalFixo("No plano Completo, a franquia é {{franquia}}.")

    texto, origem, motivo, dados_usados = montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        texto_do_lead="ainda acho caro",
        tentativas_ja_feitas=2,
    )

    assert texto == TEXTO_ENCAMINHAMENTO
    assert origem == ORIGEM_TEXTO_FIXO
    assert motivo == MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL
    assert dados_usados == ("ficha:preco-alto@1",)
    assert portal.contextos_recebidos == [], "esgotado o limite, nem deveria chamar o LLM"


def test_montar_e_responder_dentro_do_limite_ainda_responde_normalmente():
    portal = _PortalFixo("No plano Completo, a franquia é {{franquia}}.")

    texto, _origem, motivo, _dados = montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        texto_do_lead="ainda acho caro",
        tentativas_ja_feitas=1,
    )

    assert motivo is None
    assert "R$ 3.000,00" in texto or "3000" in texto or "franquia" in texto.lower()
    assert len(portal.contextos_recebidos) == 1


def test_processar_mensagem_livre_conta_tentativas_da_trilha_e_encaminha_quando_esgota():
    """Fim a fim: 2 turnos anteriores JÁ responderam a objeção (gravados na trilha antes deste
    teste começar, como se fossem chamadas anteriores de `processar_mensagem_livre`) — o 3º turno
    tem que encaminhar, sem chamar o LLM, e gravar handoff + status_alterado."""
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    for indice in range(2):
        trilha.registrar_evento(
            MensagemEnviada(
                evento="mensagem_enviada",
                conversation_id="conv-1",
                id=f"msg_prévio_{indice}",
                instante="2026-09-13T12:00:00+00:00",
                texto="resposta anterior",
                decisao_id=f"resposta_orientada_{indice}",
                regra_aplicada=_REGRA_OBJECAO_DE_PRECO,
                origem_do_texto=ORIGEM_TEXTO_FIXO,
            )
        )
    portal = _PortalFixo("No plano Completo, a franquia é {{franquia}}.")

    texto, _origem, intencao = processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("objecao_de_preco"),
        portal_de_resposta=portal,
        texto_bruto="ainda acho caro",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )

    assert texto == TEXTO_ENCAMINHAMENTO
    assert intencao == Intencao.OBJECAO_DE_PRECO
    assert portal.contextos_recebidos == [], "esgotado o limite, nem deveria chamar o LLM"
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    (handoff,) = [e for e in eventos if e["evento"] == "handoff"]
    assert handoff["reason_code"] == MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL.value
    (mudanca,) = [e for e in eventos if e["evento"] == "status_alterado"]
    assert mudanca["para"] == "aguardando_corretor"
