"""Os 7 eventos da trilha auditável (issue #7, especificação em `docs/design/ESPECIFICACAO.md`).

Puro, sem IO — não importa `aplicacao`, `infra` nem `interfaces` (contrato do `.importlinter`).
Cada evento é um dataclass congelado com `campos_comuns()` + os campos próprios; `to_dict()` é o
formato que vai para a linha JSONL (`infra/trilha_jsonl.py`) depois de passar pelo redator
(`aplicacao/servico_trilha.py`).

`reason_code` do `Handoff` é `str` — o `.value` do `MotivoHandoff` (Enum fechado, dono: F2/#5,
decisão R5 em #16). Esta camada nunca importa o Enum, só guarda a string que já chega pronta.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

# issue #86 (PR a, atendimento contínuo), decisão da coordenação: lista FECHADA de quem escreveu
# uma mensagem — dono único (I-17, `dominio/CONTRACT.md`), nunca uma string solta. `lead`/`sistema`
# já existiam em `MensagemRecebida` (issue #39); `agente`/`ia`/`corretor` são o vocabulário de
# `MensagemEnviada` (texto fixo/determinístico, resposta da IA, e a mensagem digitada pelo humano).
SENDER_ROLES_VALIDOS = frozenset({"lead", "sistema", "agente", "ia", "corretor"})


def _validar_sender_role(sender_role: str) -> None:
    if sender_role not in SENDER_ROLES_VALIDOS:
        raise ValueError(
            f"sender_role {sender_role!r} não está na lista fechada (I-17): "
            f"{sorted(SENDER_ROLES_VALIDOS)}"
        )


@dataclass(frozen=True)
class EventoTrilha:
    evento: str
    conversation_id: str
    id: str
    instante: str  # ISO 8601

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass(frozen=True)
class MensagemRecebida(EventoTrilha):
    texto: str
    sender_role: str = "lead"

    def __post_init__(self) -> None:
        _validar_sender_role(self.sender_role)


@dataclass(frozen=True)
class MensagemEnviada(EventoTrilha):
    texto: str
    decisao_id: str
    regra_aplicada: str
    origem_do_texto: str  # "redator_deterministico:<modelo>" | "llm:<modelo>@<versao_prompt>"
    dados_usados: tuple[str, ...] = ()
    quote_attempt_id: str | None = None  # obrigatório quando `texto` contém valor monetário
    # issue #86 (PR a, atendimento contínuo): quem escreveu o texto — mesmo vocabulário de
    # `MensagemRecebida.sender_role`, lista fechada em `dominio/CONTRACT.md`. Default "agente"
    # preserva os chamadores de antes desta frente (texto determinístico/fixo, nunca da IA nem de
    # um corretor humano) sem precisar editar os dois de propósito.
    sender_role: str = "agente"

    def __post_init__(self) -> None:
        _validar_sender_role(self.sender_role)


@dataclass(frozen=True)
class TentativaDeCotacao(EventoTrilha):
    numero_da_tentativa: int
    http_status: int
    classificacao: str  # sucesso | recusa_de_negocio | erro_de_payload | indisponivel | timeout
    latencia_ms: int
    orcamento_restante_ms: int
    quote_attempt_id: str
    premio_mensal: float | None = None
    franquia: float | None = None
    coberturas: tuple[str, ...] | None = None
    multiplicadores: dict[str, float] | None = None
    carencia: str | None = None
    pro_rata: float | None = None


@dataclass(frozen=True)
class Decisao(EventoTrilha):
    tipo: str
    motivo: str | None = None


@dataclass(frozen=True)
class Handoff(EventoTrilha):
    reason_code: str  # .value do MotivoHandoff (Enum da F2/#5) — nunca o Enum em si
    contexto_coletado: dict = field(default_factory=dict)
    mensagem_ao_lead: str = ""


@dataclass(frozen=True)
class ErroMarcado(EventoTrilha):
    mensagem_id: str
    marcado_por: str
    proveniencia: dict  # copiada do evento da mensagem, nunca recalculada (ver ESPECIFICACAO.md §2)
    o_que_estava_errado: str | None = None


@dataclass(frozen=True)
class CorrecaoRegistrada(EventoTrilha):
    erro_id: str
    comportamento_esperado: str
    alvo: str  # regra_de_decisao | texto_do_redator | esquema_de_extracao | politica_de_handoff
    virou_caso: bool = False
    caso_id: str | None = None
