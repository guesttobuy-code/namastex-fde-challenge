"""Descrição em linguagem simples de cada `MotivoHandoff` (issue #57, P14, PR 2 de 2) — dono único
(LEI 11), extraído de `interfaces.painel.tela_fila_humana` para ser usado também por
`interfaces.painel.tela_conversas` (S12 do roteiro de aceite: motivo do handoff no Histórico de
atendimentos, não só na Fila humana)."""

from __future__ import annotations

from dominio.decisao import MotivoHandoff

DESCRICAO_MOTIVO = {
    MotivoHandoff.QUOTE_INDISPONIVEL.value: "Cotação indisponível: o serviço de cotação falhou de forma persistente.",
    MotivoHandoff.QUOTE_TIMEOUT.value: "Cotação expirou: orçamento de tempo esgotado sem resposta.",
    MotivoHandoff.QUOTE_ERRO_DE_PAYLOAD.value: "Erro de payload nosso (400) — não repete, registra e passa adiante.",
    MotivoHandoff.RECUSA_REGRA_DE_ACEITACAO.value: "A seguradora recusou o perfil (422): fora da faixa de idade ou do veículo aceita.",
    MotivoHandoff.LEAD_QUER_CONTRATAR.value: "O lead pediu para contratar: o fechamento é feito por um corretor.",
    # issue #57 (P9): consequência mecânica de MotivoHandoff.LEAD_PEDIU_HUMANO — sem esta entrada,
    # test_todo_motivohandoff_tem_descricao_registrada cai no fallback "sem descrição registrada".
    MotivoHandoff.LEAD_PEDIU_HUMANO.value: "O lead pediu para falar com uma pessoa.",
    MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL.value: "A IA não conseguiu responder a objeção de preço com segurança (sem chave, sem ficha publicada, ou a geração reprovou a validação de marcador): encaminhado ao corretor.",
}


def descricao_do_motivo(reason_code: str | None) -> str:
    """Texto em linguagem simples do `reason_code` de um `handoff` — `"sem descrição registrada"`
    para um motivo desconhecido (achado do #42: nunca inventa descrição para motivo novo)."""
    if reason_code is None:
        return "sem descrição registrada"
    return DESCRICAO_MOTIVO.get(reason_code, "sem descrição registrada")
