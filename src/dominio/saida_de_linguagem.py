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
    tipo; ele só carrega o que o adaptador conseguiu (ou não) extrair.

    Limite declarado (achado ao vivo, 2026-09-12, teste de injeção contra o modelo real):
    `ambiguidades` e `pedido_de_esclarecimento` são texto influenciado pelo LLM a partir do texto
    do lead — podem ecoar de volta o que o lead escreveu, inclusive uma tentativa de injeção de
    prompt (é o comportamento correto de um sinalizador para o operador revisar). Por isso NUNCA
    podem virar texto mostrado ao lead sem passar por `dominio.redator`/`_texto_da_decisao` — a
    garantia estrutural está em `tests/aplicacao/test_servico_conversa.py::test_ambiguidades_nunca_e_usado_para_montar_texto_ao_lead`."""

    idade: int | None = None
    veiculo_ano: int | None = None
    plano_id: str | None = None
    data_inicio: str | None = None
    intent: str | None = None
    ambiguidades: tuple[str, ...] = field(default_factory=tuple)
    pedido_de_esclarecimento: str | None = None
