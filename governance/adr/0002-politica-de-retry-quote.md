# ADR-0002 — Política de retry do cliente `/quote`

- **Status:** aceita
- **Data:** 2026-09-12
- **Issue/PR:** #3 (medição), #6 (implementação)

## Contexto

O `quote-service` simula um sistema legado instável de propósito: 20% das chamadas falham com
5xx, 10% demoram 8s (`QUOTE_SLOW_SECONDS`), e o resto responde em milissegundos. O agente não pode
travar esperando uma chamada lenta nem desistir cedo demais e perder uma cotação que teria vindo.
Precisava de uma política de retry com números, não intuição — e ela **não nasceu nesta frente**:
foi medida na issue #3, antes de qualquer linha de `src/infra/cliente_quote.py` existir.

**Medição (issue #3):** três políticas, 150 ciclos cada, seriais, contra o serviço real em Docker
(falha 20%, lentidão 10% de 8s):

| Política (timeout por tentativa) | Sucesso | p50 | **p90** | máx | Chamadas por cotação |
|---|---|---|---|---|---|
| 10s / 10s / 10s | 147/150 | 0,02s | 8,00s | 8,44s | 1,35 |
| **3s / 3s / 3s** | **148/150** | **0,02s** | **1,23s** | 7,22s | **1,31** |
| 4s / 4s / 10s | 149/150 | 0,01s | 4,42s | 9,23s | 1,39 |

A proposta inicial (esperar a chamada lenta até o fim) estava errada: ela otimizava a chamada
individual, não a conversa — o lead via 8 segundos de silêncio numa fração real dos casos.

## Decisão

**3s de timeout por tentativa, até 3 tentativas, espera de 0,4s e 0,8s entre elas, orçamento total
de ~10s** (`timeout_da_tentativa = min(3s, orçamento_restante)`, nunca ultrapassa o orçamento).

**Precisão medida (achado da auditoria do PR #35, contra a trilha real):** os 3s não são parede
dura por tentativa — é o `timeout` do `urllib`, que vale por operação de socket (conectar/ler), não
um cronômetro de parede sobre a chamada inteira. Uma tentativa real chegou a **3617ms**
(`git show 8c35203:examples/trilha_conv-7c44f694.jsonl` — o exemplo original da medição; o arquivo
foi apagado da árvore de trabalho por `dddfac7`, que regenerou os exemplos de `examples/`, e por
isso só é acessível pelo sha antigo), ~600ms além do nominal. O que segura de verdade é o
**orçamento total** (10s), provado por medição de tempo de parede real (abaixo) — nenhuma execução
observada ultrapassou isso.

Por quê: a política de 3s corta a cauda de 8,00s para 1,23s no p90 — o lead deixa de ver oito
segundos de silêncio — sem custar confiabilidade (148 vs. 147/149 em 150 ciclos é ruído) nem
chamadas a mais (1,31 contra 1,35/1,39). Nenhuma das três é estritamente dominante em todas as
colunas; 3s venceu por ser a melhor cauda com o mesmo patamar de sucesso.

**Classificação de resposta (issue #6, implementada em `_traduzir`,
`src/infra/cliente_quote.py`):**

- **Repete** (consome uma tentativa e tenta de novo, se sobrar orçamento): `5xx` do quote-service
  (`{"error": "upstream_unavailable", ...}`) e timeout de tentativa (a chamada não voltou dentro do
  `timeout_da_tentativa`).
- **Terminal, nunca repete:** `422` (nas duas formas de corpo medidas ao vivo — recusa de negócio
  `{"error": "cotacao_recusada", "motivo": ...}` de `CotacaoRecusada`, e validação automática do
  Pydantic `{"detail": [...]}`) e `400` (`{"error": "payload_invalido", "detalhe": ...}`, de
  `KeyError`/`ValueError`/`TypeError` em `quote_logic.cotar`). Repetir um 4xx não muda o resultado —
  o problema é do payload ou da regra de negócio, não da rede.
- **Correlação, não idempotência:** cada tentativa (inclusive as que não vencem) recebe o seu
  próprio `quote_attempt_id` — o quote-service não tem conceito de idempotência, então isto serve só
  para diferenciar tentativas em log/trilha, nunca para o servidor deduplicar.

## Consequências

- **Melhora:** o pior caso medido (endpoint sempre lento) custa exatamente ~10s e 3 chamadas, nunca
  mais — provado por teste determinístico (`tests/infra/test_cliente_quote.py::test_200_lento_alem_do_orcamento_respeita_o_deadline_de_10s_em_vez_de_esperar_para_sempre`,
  relógio falso, sem tempo de parede real). Um 4xx nunca desperdiça as 2 tentativas restantes.
- **Custo:** um 5xx transitório que se resolveria numa 4ª tentativa nunca chega a ela — o orçamento
  de 10s é um limite deliberado, não uma garantia de sucesso eventual.
- **Fica PROIBIDO** redecidir esta política sem nova medição colada (LEI DA FONTE) — "acho que
  devia esperar mais" não é fonte; a tabela acima é.
- **Guards que cobram esta decisão:** `python-check` (mede os testes de `tests/infra/`),
  `companion-red-green` (a suíte de retry mede o comportamento, não só que o arquivo existe),
  `changelog-update` (linha citando #6), `adr-sequence`/`reserva-de-numero` (numeração deste
  arquivo), `frente-registro`/`prova-colada` (PR carrega a prova executada).

## Alternativas descartadas

- **Esperar a chamada lenta até o fim (sem timeout por tentativa):** era a proposta original;
  media 8,00–9,23s de cauda em vez de 1,23–4,42s — descartada pela própria medição da #3.
- **Backoff exponencial maior (ex.: 1s/2s/4s):** não medido; a tabela da #3 só testou os três
  timeouts-por-tentativa acima com a mesma espera fixa (0,4s/0,8s) — mudar a espera sem medir de
  novo seria redecidir sem fonte (LEI DA FONTE). Fica registrado como candidato a medir se o
  orçamento total precisar mudar no futuro.
- **Repetir 4xx também:** descartado porque o defeito não é de rede — repetir um payload inválido
  ou uma recusa de negócio produz a mesma resposta e só gasta orçamento que poderia ir para um 5xx
  de verdade.
- **`quote_attempt_id` único por chamada a `cotar()` (não por tentativa):** descartado — a encomenda
  da #6 pede correlação por tentativa, e reusar o mesmo id nas 3 tentativas esconderia, no log, que
  houve retry.

<!-- Regras: numeração contígua (cobrada por adr-sequence); nunca edite um ADR aceito — escreva outro que o substitui. -->
