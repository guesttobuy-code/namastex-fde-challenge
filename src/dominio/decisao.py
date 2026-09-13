"""Decisão do agente e o vocabulário fechado dos motivos de handoff.

`MotivoHandoff` é Enum fechado por decisão da coordenação (issue #16, R5): o motivo atravessa três
frentes (o domínio decide, a trilha grava `.value`, a tela mostra) e vocabulário aberto em
travessia de fronteira é como nascem três grafias para a mesma coisa.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class TipoDecisao(str, Enum):
    COLETAR_INFORMACAO = "coletar_informacao"
    COTAR = "cotar"
    EXPLICAR_COTACAO = "explicar_cotacao"
    ENCAMINHAR = "encaminhar"
    ENCERRAR = "encerrar"


class MotivoHandoff(str, Enum):
    QUOTE_INDISPONIVEL = "quote_indisponivel"
    QUOTE_TIMEOUT = "quote_timeout"
    QUOTE_ERRO_DE_PAYLOAD = "quote_erro_de_payload"
    RECUSA_REGRA_DE_ACEITACAO = "recusa_regra_de_aceitacao"
    LEAD_QUER_CONTRATAR = "lead_quer_contratar"
    # issue #58 (frente `ia-responde`), decisão da coordenação: a IA não conseguiu responder a
    # objeção de preço com segurança (sem chave, sem ficha publicada para a intenção, ou as 2
    # tentativas de geração reprovaram na validação de marcador) — encaminha, nunca inventa número.
    RESPOSTA_ORIENTADA_INDISPONIVEL = "resposta_orientada_indisponivel"


@dataclass(frozen=True)
class Decisao:
    tipo: TipoDecisao
    reason_code: MotivoHandoff | None = None

    def __post_init__(self) -> None:
        # Invariante: encaminhar ⇒ reason_code != nulo (todo handoff é explicável).
        if self.tipo == TipoDecisao.ENCAMINHAR and self.reason_code is None:
            raise ValueError("decisao ENCAMINHAR exige reason_code (todo handoff tem que ser explicável)")
        if self.tipo != TipoDecisao.ENCAMINHAR and self.reason_code is not None:
            raise ValueError(f"reason_code só é aceito em ENCAMINHAR, não em {self.tipo.value}")
