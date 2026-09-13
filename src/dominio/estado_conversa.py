"""Estado da conversa: os fatos coletados do lead até agora, sem nenhuma leitura de rede ou LLM."""
from __future__ import annotations

from dataclasses import dataclass, field

from dominio.intencao import Intencao


@dataclass(frozen=True)
class EstadoDaConversa:
    """Fotografia do que já se sabe sobre o lead nesta conversa.

    Quem preenche e valida estes campos (formato via dominio.validacao) é a camada de aplicação,
    fora deste módulo — o domínio nunca guarda "verdade" vinda do LLM sem essa validação prévia.
    """

    conversation_id: str
    idade: int | None = None
    veiculo_ano: int | None = None
    plano_id: str | None = None
    cep: str | None = None
    data_inicio: str | None = None
    campos_faltantes: frozenset[str] = field(default_factory=frozenset)
    ambiguidades: tuple[str, ...] = field(default_factory=tuple)
    ultimo_intent: Intencao | None = None
    status: str | None = None
    nome: str | None = None
    whatsapp: str | None = None
    email: str | None = None
    veiculo_modelo: str | None = None
