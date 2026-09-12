# CONTRACT — infra

**Dono:** `src/infra/` — primeira frente a pôr código aqui: F4 (trilha-privacidade, issue #7).
Camadas seguintes (F3/#6 cliente HTTP da `/quote`, F6/#9 adaptador de LLM) acrescentam seção própria
por append, no fim deste arquivo — nunca editando linha alheia (R2, #16).

## O que este módulo é dono de

- Os **adaptadores reais** das portas declaradas em `aplicacao/portas/`. Desta frente:
  `RepositorioDeTrilhaJSONL` (append-only) e `RepositorioDeTrilhaMemoria` (dublê determinístico).
- O **exportador** que transforma a trilha de uma conversa no log de execução legível
  (`exportador_trilha.py`) — entregável obrigatório do desafio.

## INVARIANTES (o que nunca pode ser falso)

| # | invariante | teste que a cobre |
|---|---|---|
| I-1 | `RepositorioDeTrilhaJSONL.registrar` nunca sobrescreve eventos já gravados (append-only) | `tests/infra/test_trilha_jsonl.py` |
| I-2 | `infra` nunca importa `interfaces` | `tests/arquitetura/test_fronteiras.py` |
| I-3 | `exportar_execucao` nunca mistura eventos de conversas diferentes | `tests/infra/test_exportador_trilha.py` |

## Entradas e saídas públicas

- `infra.trilha_jsonl.RepositorioDeTrilhaJSONL(caminho: Path)` — implementa `RepositorioDeTrilha`.
- `infra.trilha_jsonl.RepositorioDeTrilhaMemoria()` — dublê determinístico, mesma interface.
- `infra.exportador_trilha.exportar_execucao(conversation_id: str, repositorio) -> str`.

## O que NÃO é responsabilidade deste módulo

- Decidir o que grava e quando (isso é `aplicacao.ServicoDeTrilha`) — `infra` só persiste e lê o que
  já chegou pronto (já redigido).
- Formato da trilha em si (nomes de campo) — isso é `dominio/eventos_trilha.py`; `infra` serializa o
  `dict` que recebe, sem conhecer os tipos de evento.

## Decisões registradas

- 2026-09-12 — JSONL append-only, sem banco: "não precisa, e banco custa tempo" (encomenda F4, issue
  #7). Sem ADR próprio — decisão já estava escrita na issue, não é decisão nova desta frente.
