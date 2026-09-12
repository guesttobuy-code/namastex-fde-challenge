"""Saída estruturada do `PortalDeLinguagem` (issue #9, F6): o formato que os dois adaptadores
(determinístico e OpenRouter) devolvem, depois de validada por formato — o domínio nunca vê saída
de LLM sem essa validação prévia (mesma régua de `dominio.estado_conversa.EstadoDaConversa`).

CEP nunca aparece aqui: é PII, extraído do texto BRUTO antes do mascaramento
(`dominio.redator_pii.extrair_cep`), e nunca chega ao portal de linguagem.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SaidaDeLinguagem:
    """Campos que o adaptador extraiu do texto MASCARADO do lead, ou um pedido de esclarecimento
    quando a extração falhou, veio incompleta ou não passou na validação de esquema/formato.

    `pedido_de_esclarecimento` e os campos extraídos são mutuamente informativos, não exclusivos
    por construção — quem decide se um turno vale ou pede mais informação é `aplicacao`, não este
    tipo; ele só carrega o que o adaptador conseguiu (ou não) extrair."""

    idade: int | None = None
    veiculo_ano: int | None = None
    plano_id: str | None = None
    data_inicio: str | None = None
    intent: str | None = None
    ambiguidades: tuple[str, ...] = field(default_factory=tuple)
    pedido_de_esclarecimento: str | None = None
