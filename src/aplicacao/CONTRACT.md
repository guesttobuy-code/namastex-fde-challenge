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

---

## Seção F3/#6 — `PortalDeCotacao` e `servico_conversa` (append, R2/#16)

### O que esta frente é dona de

- `aplicacao.portas.portal_de_cotacao.PortalDeCotacao` — a porta do cliente da `/quote`.
- `aplicacao.servico_conversa` — o caso de uso principal (F5/#8, absorvida): `conduzir_conversa`
  orquestra `dominio.politica`/`dominio.redator`/`dominio.validacao` + `PortalDeCotacao`, e — depois
  da costura pós-merge da F4/#31 — grava a trilha via `ServicoDeTrilha` (nunca chama
  `RepositorioDeTrilha` direto, nunca redige PII por conta própria).

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-3 | `conduzir_conversa` nunca monta texto de cotação fora de `dominio.redator.montar_mensagem` — um `preco` de tipo errado tem que atravessar como `TypeError`, nunca virar texto fabricado | `tests/aplicacao/test_servico_conversa.py::test_preco_de_tipo_errado_atravessa_a_integracao_como_typeerror_nunca_como_texto` |
| I-4 | Um evento `tentativa_de_cotacao` por TENTATIVA HTTP, não por cotação (ESPECIFICACAO.md §1) | `tests/aplicacao/test_servico_conversa_trilha.py::test_uma_tentativa_de_cotacao_por_tentativa_http_de_verdade_nao_por_cotacao` |
| I-5 | `mensagem_enviada` com valor monetário sempre tem `quote_attempt_id` de uma tentativa de sucesso correspondente | `tests/aplicacao/test_servico_conversa_trilha.py::test_mensagem_com_valor_monetario_tem_quote_attempt_id_de_tentativa_correspondente` |

### Entradas e saídas públicas acrescentadas

- `aplicacao.portas.portal_de_cotacao.PortalDeCotacao` — `Protocol` com
  `cotar(payload: dict, conversation_id: str, on_tentativa: Callable[..., None] | None = None) -> dominio.resultado_cotacao.ResultadoDaCotacao`.
  `on_tentativa` tipado solto de propósito (duck typing) — o formato real da observação
  (`infra.cliente_quote.TentativaObservada`) é de `infra`, e esta camada nunca importa `infra`.
- `aplicacao.servico_conversa.montar_estado(conversation_id: str, dados: dict) -> dominio.estado_conversa.EstadoDaConversa`.
- `aplicacao.servico_conversa.conduzir_conversa(portal: PortalDeCotacao, estado: EstadoDaConversa, trilha: ServicoDeTrilha | None = None) -> TurnoDaConversa`.

### O que NÃO é responsabilidade desta seção

- Elegibilidade (idade, ano do veículo, região) — decidida pela `/quote`, nunca replicada aqui.
- Formato dos campos de proveniência da trilha (`decisao_id`, `regra_aplicada` etc.) — o VOCABULÁRIO
  é de `dominio/eventos_trilha.py` (F4); esta seção só preenche os valores.

### Decisões registradas

- 2026-09-12 — Sem trilha no commit original desta frente (F4/#31 ainda não tinha mergeado);
  costurada num commit próprio depois, sem alterar nenhuma linha alheia deste arquivo — decisão da
  coordenação, não redecisão de escopo.

---

## Seção F6/#9 — `PortalDeLinguagem` e `extrair_dados_da_mensagem` (append, R2/#16)

### O que esta frente é dona de

- `aplicacao.portas.portal_de_linguagem.PortalDeLinguagem` — a porta dos adaptadores de linguagem
  (determinístico e OpenRouter, ambos em `infra`). Extrai campos do texto do lead; **nunca decide**
  preço, recusa ou handoff — isso continua só de `dominio.politica`.
- `aplicacao.servico_conversa.extrair_dados_da_mensagem` — orquestra a extração: CEP local do texto
  BRUTO (`dominio.redator_pii.extrair_cep`, ANTES do mascaramento) + campos não-PII vindos do
  portal (sobre o texto MASCARADO) + validação de formato (`dominio.validacao`) antes de qualquer
  campo entrar no `EstadoDaConversa` novo.

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-6 | `extrair_dados_da_mensagem` nunca passa o texto BRUTO para `PortalDeLinguagem.extrair` — só o mascarado por `redigir_texto` | `tests/integracao/test_adaptador_espiao.py`, `tests/integracao/test_cep_local_antes_do_mascaramento.py` |
| I-7 | O CEP nunca chega ao portal de linguagem, mascarado ou não — é extraído do texto bruto e injetado no estado depois, por fora da extração do portal | `tests/integracao/test_cep_local_antes_do_mascaramento.py` |
| I-8 | Saída do portal com campo de tipo/formato errado (idade fora de faixa, ano como string, CEP com formato inválido) nunca vira `ValueError`/exceção — o campo é descartado, mantendo o valor anterior do estado | `tests/infra/test_adaptador_de_linguagem.py::test_modelo_enganado_*` |

### Entradas e saídas públicas acrescentadas

- `aplicacao.portas.portal_de_linguagem.PortalDeLinguagem` — `Protocol` com
  `extrair(texto_mascarado: str, estado_atual: dominio.estado_conversa.EstadoDaConversa) -> dominio.saida_de_linguagem.SaidaDeLinguagem`
  e a propriedade `origem_do_texto: str`.
- `aplicacao.servico_conversa.extrair_dados_da_mensagem(portal: PortalDeLinguagem, texto_bruto: str, estado_atual: EstadoDaConversa) -> EstadoDaConversa`.

### O que NÃO é responsabilidade desta seção

- Escrever texto de preço, recusa ou decisão de handoff — isso é `dominio.redator`/`_texto_da_decisao`,
  nunca o portal de linguagem.
- Validar elegibilidade dos campos extraídos (faixa etária, ano do veículo) — só formato, mesma
  régua de `dominio.validacao` (não replicada aqui).

### Decisões registradas

- 2026-09-12 — Provedor por `LLM_PROVEDOR` (padrão `deterministico`, nunca lê a chave); pedido de
  `openrouter` sem `OPENROUTER_API_KEY` falha alto — achado da #9 (chave "sumida" por `.env.txt`
  ou linha sem o nome da variável não pode virar silêncio).
- 2026-09-12 — Chamada ao OpenRouter via `urllib.request` (stdlib), sem SDK novo — decisão do dono
  (emenda ao escopo da #9), registrada em ADR-0003.
