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
| I-15 | `id` que não bate com o formato de slug seguro (`_ID_VALIDO`) é recusado nas duas classes antes de tocar o dicionário/disco — nenhum `id` escapa de `conhecimento/objecoes/` | `tests/infra/test_repositorio_conhecimento_json.py::test_id_fora_do_formato_seguro_e_recusado_no_disco` |
| I-16 | `RepositorioDeConhecimentoMemoria` nunca devolve a referência interna — leitura é sempre cópia | `tests/infra/test_repositorio_conhecimento_json.py::test_duble_em_memoria_devolve_copia_nao_a_referencia_interna` |

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
- 2026-09-13 — `I-13`/`I-14` já estavam em uso pela seção seguinte (issue #42, mergeada primeiro em
  `main`) quando esta branch atualizou — renumerado para `I-15`/`I-16` para não colidir (LEI 11: a
  numeração corrida deste CONTRACT é o mesmo tipo de recurso compartilhado que um ADR).

---

## Seção da issue #42 — `intent` vira `enum` no esquema do OpenRouter (fronteira ampliada pela coordenação)

### O que esta issue acrescenta (append, R2/#16)

- `infra.adaptador_de_linguagem._ESQUEMA_EXTRACAO["properties"]["intent"]` ganha `enum`, derivado de
  `dominio.intencao.Intencao` (`_VALORES_DE_INTENT = [m.value for m in Intencao] + [None]`) — nunca
  uma segunda lista escrita à mão (LEI 11). Achado da auditoria do PR #44: com `intent` como string
  livre, o modelo real inventava grafias ("contratar seguro", "fechar") que a conversão de
  `aplicacao.servico_conversa` para `Intencao` descartava em silêncio — 0 de 5 frases explícitas de
  "quero contratar" chegavam à política.
- `_PROMPT_SISTEMA` ganha uma frase dizendo quando usar `informar_dados` e `quer_contratar`.

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-13 | O `enum` de `intent` no esquema é exatamente `{m.value for m in Intencao} ∪ {None}` — um valor novo no Enum aparece aqui sem editar esta linha, e nenhuma segunda lista diverge dele | `tests/infra/test_adaptador_de_linguagem.py::test_enum_de_intent_no_esquema_bate_com_intencao` |

### Decisões registradas

- 2026-09-13 — a fronteira desta issue (#42) foi ampliada pela coordenação para cobrir este arquivo
  (F6/#9 está mergeada e sem frente ativa) — ver comentário de auditoria no PR #44, bloqueante B1.

---

## Seção F13/#43 — bloqueantes B2/B4 da auditoria do PR #45 (append, R2/#16)

### O que esta frente acrescenta

- `infra.planos_http.ids_dos_planos(dados: dict | None) -> tuple[str, ...]` (B2): extrai os ids de
  `buscar_planos()` — `None` (serviço fora do ar) devolve tupla vazia, nunca um id inventado. Não
  duplica o parsing da forma da `/planos`: `tela_regras.py` já lia `planos.get("planos", [])`
  direto (LEI 11 — este é o segundo lugar que precisava do mesmo shape, então vira função).
- `infra.repositorio_configuracao_comercial_json.RepositorioDeConfiguracaoComercialJSON`/
  `RepositorioDeConfiguracaoComercialMemoria` (B4): adaptador real e dublê da porta
  `RepositorioDeConfiguracaoComercial`, mesmo molde de `RepositorioDeConhecimentoJSON`. Arquivo
  ausente = `ConfiguracaoComercial()` (padrão do dono), nunca falha.

### Entradas e saídas públicas acrescentadas

- `infra.planos_http.ids_dos_planos(dados: dict | None) -> tuple[str, ...]`.
- `infra.repositorio_configuracao_comercial_json.RepositorioDeConfiguracaoComercialJSON(caminho: Path)`
  — implementa `RepositorioDeConfiguracaoComercial`.
- `infra.repositorio_configuracao_comercial_json.RepositorioDeConfiguracaoComercialMemoria(configuracao=None)`
  — dublê determinístico.

### Decisões registradas

- 2026-09-13 — Achados B2 e B4 da auditoria do PR #45 (HEAD `9ee1135`), corrigidos no mesmo push:
  vocabulário de marcadores agora deriva de `PrecoCotado` + ids reais da `/planos`, e a
  configuração comercial passa a ter adaptador real em vez de ficar fora do escopo com premissa
  vencida (a #42 já tinha mergeado antes da análise original desta frente).

---

## Seção da issue #46 (PR 2 de 2) — `RepositorioDeContatoJSON` (append, R2/#16)

### O que esta frente é dona de

- `infra.repositorio_contato_json.RepositorioDeContatoJSON` — adaptador real da porta
  `RepositorioDeContato`: um arquivo JSON por lead em `contato/leads/<conversation_id>.json`, FORA
  do `git` (`.gitignore`, ADR-0005) — mesmo molde de `RepositorioDeConhecimentoJSON` (um arquivo
  por unidade, nunca JSONL append-only: cada `salvar` SUBSTITUI o arquivo do lead).
- `infra.repositorio_contato_json.RepositorioDeContatoMemoria` — dublê determinístico, mesma
  interface, sem tocar disco (para os testes de `aplicacao`/`interfaces` não precisarem de
  `contato/` real).
- `_validar_conversation_id` — mesma técnica de `_validar_id` em
  `infra.repositorio_conhecimento_json` (slug seguro), para nenhum `conversation_id` vindo da
  borda HTTP escapar de `contato/leads/` (path traversal) — LEI 11, não uma segunda validação.

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-17 | `conversation_id` fora do formato de slug seguro é recusado nas duas classes antes de tocar disco/dicionário — nenhum id escapa de `contato/leads/` | `tests/infra/test_repositorio_contato_json.py::test_conversation_id_fora_do_formato_seguro_e_recusado_no_disco` |
| I-18 | `contato/leads/` está de fato no `.gitignore` — provado rodando `git check-ignore` contra um arquivo real dentro do repo, não só afirmado | `tests/infra/test_repositorio_contato_json.py::test_git_check_ignore` |

### Entradas e saídas públicas acrescentadas

- `infra.repositorio_contato_json.RepositorioDeContatoJSON(diretorio: Path)` — implementa
  `RepositorioDeContato`.
- `infra.repositorio_contato_json.RepositorioDeContatoMemoria()` — dublê determinístico.

### O que NÃO é responsabilidade deste módulo

- Validar nome/WhatsApp (isso é `dominio.contato_lead.ContatoLead`) — este módulo só serializa e
  lê o que já chegou validado.

### Decisões registradas

- 2026-09-13 — ADR-0005: JSON legível (não JSONL), um arquivo por lead — mesma razão de
  `RepositorioDeConhecimentoJSON` (cada contato é uma unidade que o corretor lê isolada, não um
  log append-only de eventos).

---

## Seção da issue #67 (frente `robustez-quote-entrada`) — falha de transporte e prazo de parede real (append)

**Dono:** `src/infra/cliente_quote.py`, `src/infra/planos_http.py` (acréscimo — nenhum arquivo
novo). `src/infra/repositorio_conhecimento_json.py` (acréscimo, achado ao escrever o teste do
servidor para a #69).

### O que esta frente acrescenta

- `cliente_quote.RespostaBruta.falha_de_transporte: bool` — conexão recusada/DNS/reset
  (`URLError` que não é timeout) e corpo que não é JSON válido (em sucesso ou em erro) nunca mais
  sobem sem tratamento: viram este marcador, RETENTÁVEL como timeout, sem inventar um HTTP status
  que a rede não devolveu. Antes desta frente, `_post_via_urllib` deixava `URLError` genérico
  (`raise`) escapar até o `wsgiref`, virando 500 sem retry, sem `ResultadoDaCotacao`, sem handoff.
- `cliente_quote.ClienteQuoteHTTP._chamar_com_prazo_de_parede` — cada tentativa roda num worker
  (`concurrent.futures.ThreadPoolExecutor`, uma thread por chamada); o cliente espera com
  `future.result(timeout=...)`, o MESMO timeout já calculado pela política de retry (ADR-0002,
  nunca redecidida). Achado de medição ao vivo (`docker compose stop quote-api`, stack isolada):
  `getaddrinfo` (DNS) não respeita o `timeout` do `urlopen`/`socket` neste ambiente — uma tentativa
  chegou a ~4s contra os 3s configurados, e o orçamento total de ~10s estourava para ~13-19s. Se o
  prazo de parede estourar, a tentativa conta como TIMEOUT (mesma regra de sempre) e a thread fica
  abandonada, terminando sozinha sem efeito colateral (a `/quote` não muda nada do lado cliente).
  Nunca `socket.setdefaulttimeout` (não cobre `getaddrinfo` e mudaria o processo inteiro) nem cache
  de IP (esconderia troca de endereço real) — decisão da coordenação.
- `planos_http.buscar_planos` ganha o MESMO prazo de parede (worker + `future.result(timeout=
  TIMEOUT_SEGUNDOS)`) — achado ao medir a prova ao vivo do item acima: `gerar_paineis` chama esta
  função em TODO turno do chat (sucesso ou falha da cotação), e o mesmo travamento de DNS somava
  ~4,4s ao tempo total do handoff, por cima do orçamento já corrigido do cliente da `/quote`.
  Estourado o prazo, o resultado continua sendo o MESMO `None` de sempre (buraco visível) — nenhum
  comportamento novo, só o tempo de parede sob controle de verdade.
- `repositorio_conhecimento_json.RepositorioDeConhecimentoMemoria.obter_objecao` passa a chamar
  `_validar_id` — achado ao escrever o teste do servidor para a #69: esta classe (dublê de teste)
  divergia de `RepositorioDeConhecimentoJSON.obter_objecao` (que já validava), e um teste que usa o
  dublê não pegava o defeito real do servidor (`GET /api/objecoes/<id inválido>` sem tratamento).

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-19 | `ClienteQuoteHTTP` nunca deixa uma tentativa ultrapassar o timeout configurado em tempo de PAREDE real, seja qual for a causa do travamento (DNS, connect, read) | `tests/infra/test_cliente_quote.py::test_transporte_que_trava_alem_do_prazo_conta_como_timeout_nunca_prende_o_cliente` |
| I-20 | `buscar_planos` nunca ultrapassa `TIMEOUT_SEGUNDOS` em tempo de parede real, pela mesma técnica | `tests/infra/test_planos_http.py::test_travamento_alem_do_prazo_devolve_none_nunca_pendura` |
| I-21 | `RepositorioDeConhecimentoJSON.obter_objecao` e `RepositorioDeConhecimentoMemoria.obter_objecao` concordam sobre o que é um id válido — as duas implementações do mesmo `RepositorioDeConhecimento` nunca divergem (LEI 11) | `tests/infra/test_repositorio_conhecimento_json.py` |

### O que NÃO é responsabilidade desta seção

- Mudar a política de retry (ADR-0002) — os números (3s/tentativa, 3 tentativas, 0,4s/0,8s de
  espera, ~10s de orçamento) continuam os mesmos; só o ÁRBITRO do prazo por tentativa passou a ser
  o relógio de parede real, não só o parâmetro `timeout` de `urlopen`.
- `gerar_paineis`/`tela_regras` não tiveram o MOMENTO em que rodam alterado (isso pertenceria a
  outra frente) — só a chamada de rede que já existia dentro deles ganhou o mesmo prazo de parede.

### Decisões registradas

- 2026-09-13 — decisão da coordenação: worker + `future.result(timeout=...)` em vez de
  `socket.setdefaulttimeout` (efeito colateral processo inteiro, não cobre `getaddrinfo`) ou cache
  de IP (esconderia troca de endereço real). Meta da prova ao vivo declarada: handoff em ≤ ~13s de
  parede (10s do orçamento do cliente da `/quote` + 2s do prazo de `buscar_planos`, somados).
