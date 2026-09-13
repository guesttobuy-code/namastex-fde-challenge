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

---

## Seção F6/#9 — `AdaptadorDeLinguagemDeterministico`/`AdaptadorDeLinguagemOpenRouter` (append, R2/#16)

### O que esta frente é dona de

- `infra.adaptador_de_linguagem.AdaptadorDeLinguagemDeterministico` — adaptador padrão da porta
  `PortalDeLinguagem`: regex sobre o texto mascarado, sem rede, sem chave; é o usado nos testes.
- `infra.adaptador_de_linguagem.AdaptadorDeLinguagemOpenRouter` — adaptador real: HTTP cru via
  `urllib.request` (stdlib, mesmo padrão de `infra.cliente_quote`) contra a API de chat completions
  do OpenRouter, com timeout explícito e saída validada por esquema.
- `infra.adaptador_de_linguagem.criar_adaptador_de_linguagem` — escolhe o adaptador por
  `LLM_PROVEDOR`; falha alto (`RuntimeError`) se pedir `openrouter` sem `OPENROUTER_API_KEY`.

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-7 | `AdaptadorDeLinguagemOpenRouter` nunca deixa um campo fora do esquema esperado (`idade`, `veiculo_ano`, `plano_id`, `data_inicio`, `intent`, `ambiguidades`) chegar a `SaidaDeLinguagem` — campos extras no JSON do modelo são ignorados por construção | `tests/infra/test_adaptador_de_linguagem.py::test_modelo_enganado_com_campos_extras_nao_atravessam_por_construcao` |
| I-8 | Timeout, erro HTTP, corpo não-JSON (com ou sem cerca Markdown) ou JSON fora do esquema nunca viram exceção — sempre um `SaidaDeLinguagem(pedido_de_esclarecimento=...)` | `tests/infra/test_adaptador_de_linguagem.py` |
| I-9 | `criar_adaptador_de_linguagem` nunca lê `OPENROUTER_API_KEY` quando o provedor é (ou o padrão é) `deterministico` | `tests/infra/test_adaptador_de_linguagem.py::test_provedor_padrao_e_deterministico_e_nunca_le_a_chave` |
| I-10 | Nenhum teste da suíte padrão chama a API do OpenRouter de verdade — só via `pytest -m llm_real`, explícito | `pyproject.toml::[tool.pytest.ini_options].markers` |
| I-11 | Toda chamada ao OpenRouter carrega `strict: true` (em `json_schema`) e `provider.require_parameters: true` | `tests/infra/test_adaptador_de_linguagem.py::test_openrouter_payload_pede_strict_e_require_parameters` |
| I-12 | Uma saída sem TODAS as chaves do esquema (o modelo ignorou o esquema, mesmo com JSON válido) dispara UMA retentativa, nunca mapeamento de sinônimo de campo — e nunca uma terceira chamada | `tests/infra/test_adaptador_de_linguagem.py::test_openrouter_esquema_nao_seguido_*` |

### Entradas e saídas públicas acrescentadas

- `infra.adaptador_de_linguagem.AdaptadorDeLinguagemDeterministico().extrair(texto_mascarado, estado_atual) -> SaidaDeLinguagem`.
- `infra.adaptador_de_linguagem.AdaptadorDeLinguagemOpenRouter(chave, modelo=MODELO_PADRAO, transporte=None, timeout_segundos=10.0)`.
- `infra.adaptador_de_linguagem.criar_adaptador_de_linguagem(provedor=None, env=None, raiz=<raiz do repo>) -> PortalDeLinguagem`
  — carregar o `.env` para `os.environ` é responsabilidade de `interfaces.dotenv_loader`, chamado pelo processo de entrada (CLI), nunca por esta função.
- `infra.adaptador_de_linguagem.MODELO_PADRAO` = `"deepseek/deepseek-chat-v3.1"` (ADR-0003).

### Decisões registradas

- 2026-09-12 — Modelo padrão `deepseek/deepseek-chat-v3.1`, medido pela coordenação contra a API
  real (NVIDIA gratuitos descartados por timeout) — ADR-0003.
- 2026-09-12 — Resposta do modelo pode vir embrulhada em cerca Markdown (` ```json ... ``` `) mesmo
  pedindo `response_format=json_schema` — medido ao vivo; `_sem_cercas_markdown` trata antes do
  `json.loads`.

---

## Seção F10/#13 — `RepositorioDeTrilhaJSONL.todos_os_eventos` (append, R2/#16)

### Entradas e saídas públicas acrescentadas

- `infra.trilha_jsonl.RepositorioDeTrilhaJSONL.todos_os_eventos() -> list[dict]` e o mesmo método em
  `RepositorioDeTrilhaMemoria` — enumera a trilha inteira, na ordem gravada, sem filtrar por
  `conversation_id`. O painel (F10, issue #13) precisa listar as conversas existentes num arquivo de
  trilha sem conhecer os ids de antemão; `eventos_da_conversa` exige o id e não serve para isso.

### Decisões registradas

- 2026-09-12 — Achado da auditoria do PR #37: este método passou a ser saída pública do módulo e
  faltava aqui. Vermelho-antes por assertiva (`AttributeError`) confirmado antes do conserto —
  `tests/infra/test_trilha_jsonl.py`.
- `infra.config.url_quote_service() -> str` (F10/#13): dono único da resolução de
  `QUOTE_SERVICE_URL`, usado por `interfaces/cli.py` e `infra/planos_http.py` — antes desta frente,
  os dois liam a mesma variável cada um do seu jeito (achado da coordenação, LEI 11).
- `infra.planos_http.buscar_planos(base_url=None) -> dict | None` (F10/#13): cliente só-leitura do
  `GET /planos`, timeout explícito de 2s (`TIMEOUT_SEGUNDOS`), `None` se o serviço não responder —
  quem chama mostra o buraco visível, nunca um valor de memória.

---

## Seção F13/#43 — `RepositorioDeConhecimentoJSON` (append, R2/#16)

### O que esta frente é dona de

- `infra.repositorio_conhecimento_json.RepositorioDeConhecimentoJSON` — adaptador real da porta
  `RepositorioDeConhecimento`: um arquivo JSON por ficha em `conhecimento/objecoes/<id>.json`
  (ADR-0004).
- `infra.repositorio_conhecimento_json.RepositorioDeConhecimentoMemoria` — dublê determinístico,
  mesma interface, sem tocar disco.

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-13 | `id` que não bate com o formato de slug seguro (`_ID_VALIDO`) é recusado nas duas classes antes de tocar o dicionário/disco — nenhum `id` escapa de `conhecimento/objecoes/` | `tests/infra/test_repositorio_conhecimento_json.py::test_id_fora_do_formato_seguro_e_recusado_no_disco` |
| I-14 | `RepositorioDeConhecimentoMemoria` nunca devolve a referência interna — leitura é sempre cópia | `tests/infra/test_repositorio_conhecimento_json.py::test_duble_em_memoria_devolve_copia_nao_a_referencia_interna` |

### Entradas e saídas públicas acrescentadas

- `infra.repositorio_conhecimento_json.RepositorioDeConhecimentoJSON(diretorio: Path)` — implementa
  `RepositorioDeConhecimento`.
- `infra.repositorio_conhecimento_json.RepositorioDeConhecimentoMemoria()` — dublê determinístico.

### O que NÃO é responsabilidade deste módulo

- Validar o marcador da resposta orientada (`dominio.ficha_objecao`) — este módulo só persiste e
  lê o `dict` que recebe.

### Decisões registradas

- 2026-09-13 — Formato JSON legível (não JSONL), um arquivo por ficha: cada ficha é uma unidade
  editável e revisável isoladamente no `git diff` — diferente da trilha (append-only, uma linha por
  evento), aqui cada publicação SUBSTITUI o arquivo (ADR-0004).
