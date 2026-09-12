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

---

## Seção F3/#6 — `ClienteQuoteHTTP` (append, R2/#16)

### O que esta frente é dona de

- `infra.cliente_quote.ClienteQuoteHTTP` — adaptador real da porta `PortalDeCotacao`: motor de
  retry/orçamento (ADR-0002) + tradução HTTP -> `dominio.ResultadoDaCotacao`/`PrecoCotado`.
- `infra.cliente_quote.FakeTransporteQuote`/`RelogioFake` — dublê do TRANSPORTE (testa a política de
  retry sem rede) e `infra.cliente_quote.FakePortalDeCotacao` — dublê da PORTA (testa quem consome
  `cotar()` sem montar respostas HTTP).

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-4 | Só repete 5xx e timeout; 422 e 400 são terminais e nunca repetem | `tests/infra/test_cliente_quote.py::test_422_e_400_sao_terminais_e_nunca_repetem` |
| I-5 | Nunca ultrapassa `ORCAMENTO_TOTAL_SEGUNDOS` — nem em tempo de PAREDE real, não só em relógio falso | medição manual colada no PR #35 (containers dedicados, 8s sempre-lento -> 10,016s reais) |
| I-6 | `200` só vira `PrecoCotado` com todos os campos de uma cotação bem-sucedida (delega para `PrecoCotado.de_resposta_http_200`, nunca reimplementa) | `tests/infra/test_cliente_quote.py::test_cotar_resposta_sem_campo_obrigatorio_nao_vira_preco_cotado` |

### Entradas e saídas públicas acrescentadas

- `infra.cliente_quote.ClienteQuoteHTTP(base_url, transporte=None, relogio=time.monotonic, dormir=time.sleep)`.
- `.cotar(payload: dict, conversation_id: str, on_tentativa: Callable[[TentativaObservada], None] | None = None) -> ResultadoDaCotacao`.
- `.executar_com_orcamento(payload: dict, on_tentativa=None) -> tuple[quote_attempt_id: str, RespostaBruta]` — motor de retry puro, sem tradução (uso interno/teste).

### Decisões registradas

- 2026-09-12 — Política de retry (3s/tentativa, 3 tentativas, orçamento 10s) documentada em
  ADR-0002 (`governance/adr/0002-politica-de-retry-quote.md`), não repetida aqui.
- 2026-09-12 — `on_tentativa` como callback tipado solto na porta (`Callable[..., None]`), em vez
  de `aplicacao` importar `TentativaObservada` de `infra` — mantém I-2 do CONTRACT de `aplicacao`
  intacto (nunca importa `infra`).
