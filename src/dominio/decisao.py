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


@dataclass(frozen=True)
class Decisao:
    tipo: TipoDecisao
    reason_code: MotivoHandoff | None = None

    # Wave 1 (esqueleto permissivo, issue #5): sem validação de `encaminhar ⇒ reason_code != nulo`.
    # A invariante entra no commit seguinte.
