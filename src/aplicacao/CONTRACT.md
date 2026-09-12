# CONTRACT — aplicacao

**Dono:** `src/aplicacao/` — primeira frente a pôr código aqui: F4 (trilha-privacidade, issue #7).
Camadas seguintes (F3/#6 `PortalDeCotacao`, F5/#8 caso de uso principal, F6/#9 `PortalDeLinguagem`)
acrescentam seção própria por append, no fim deste arquivo — nunca editando linha alheia (R2, #16).

## O que este módulo é dono de

- As **portas** que `dominio` não conhece e `infra` implementa (`src/aplicacao/portas/`, um arquivo
  por porta — R3, #16, para duas frentes paralelas não colidirem no mesmo arquivo).
- Os **casos de uso** que orquestram `dominio` + portas. Desta frente: `ServicoDeTrilha` — a única
  porta de entrada para gravar um evento na trilha.

## INVARIANTES (o que nunca pode ser falso)

| # | invariante | teste que a cobre |
|---|---|---|
| I-1 | `ServicoDeTrilha.registrar_evento` nunca deixa um campo textual não redigido chegar ao `RepositorioDeTrilha` | `tests/aplicacao/test_servico_trilha.py` |
| I-2 | `aplicacao` nunca importa `infra` nem `interfaces` (só declara a porta; quem implementa é `infra`) | `tests/arquitetura/test_fronteiras.py` |

## Entradas e saídas públicas

- `aplicacao.portas.repositorio_de_trilha.RepositorioDeTrilha` — `Protocol` com `registrar(evento: dict) -> None` e `eventos_da_conversa(conversation_id: str) -> list[dict]`.
- `aplicacao.servico_trilha.ServicoDeTrilha(repositorio).registrar_evento(evento: EventoTrilha, nomes_conhecidos: list[str] | None) -> None`.

## O que NÃO é responsabilidade deste módulo

- Decidir a regra de negócio (isso é `dominio`) e persistir de verdade (isso é `infra`) — `aplicacao`
  só orquestra os dois.
- Mascarar PII (a regex mora em `dominio/redator_pii.py`; `ServicoDeTrilha` só garante que ela é
  chamada, não reimplementa a lógica).

## Decisões registradas

- 2026-09-12 — `aplicacao/portas/` nasce pacote (um arquivo por porta), não módulo único, para F3 e
  F4 não colidirem rodando em paralelo — decisão R3 em #16, ratificando a interpretação B do PLANO
  da #7.
