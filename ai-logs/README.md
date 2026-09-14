<!--
RASCUNHO (issue #15, C5/C6/C7 da #89) — não é o índice final. A exportação real das transcrições
sanitizadas (as pastas de sessão em si) só acontece no congelamento, porque as sessões continuam
crescendo até lá (`scripts/sanitizar_ai_logs.py`, self-test verde). Antes de publicar de verdade:
reconferir a lista de sessões pelo disco (cresceu desde que este rascunho foi escrito), recontar os
padrões pós-sanitização da exportação REAL (não do ensaio) e colar a saída aqui.
-->

# `ai-logs/` — índice das conversas com IA

Este projeto foi construído por várias sessões de IA, cada frente numa worktree própria (LEI 73 do
método: 1 chat = 1 branch = 1 worktree = 1 PR — com exceções pontuais, documentadas onde acontecem,
em que a mesma sessão conduziu mais de uma frente por ordem do dono). Esta pasta guarda a
transcrição de cada uma, sanitizada — usuário da máquina, sobrenome do dono, e-mail e nome de outro
projeto do dono removidos; segredos e dados pessoais verificados por script, que recusa exportar se
a checagem não puder rodar (`scripts/sanitizar_ai_logs.py`).

## Ferramentas usadas

- **Claude Code** — todas as sessões abaixo (coordenação e frentes). É a ferramenta principal deste
  projeto.
- **Codex** — uma auditoria externa (red-team do roadmap), antes de qualquer código:
  [`codex/2026-09-11-red-team-e-parecer-codex.md`](codex/2026-09-11-red-team-e-parecer-codex.md),
  idêntico ao original recebido.
- **ChatGPT não entra** — por ordem do dono, porque não foi usado no trabalho deste desafio.

## Índice por papel

| Sessão | Papel | O que produziu |
|---|---|---|
| `coordenacao/` | Planeja, audita entre frentes, decide prioridade, aprova merge | Todo o roteamento das frentes abaixo; decisões registradas na issue-diário [#16](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/16) |
| `auditoria-fria/` | Auditoria adversarial periódica do projeto inteiro (fora do fluxo de PR) | Achado do vazamento de dado pessoal em `esteira.json` ([#17](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/17)) |
| `sondagem-inicial/` | Primeira leitura do desafio, antes de qualquer código | Levantamento inicial que virou a base do roadmap ([issue #3](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/3)) |
| `fundacao-python/` | F1 — fundação do projeto | Config Python, guards que substituem os do kit JS/TS ([PR #25](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/25), mergeado) |
| `dominio/` | F2 — domínio puro | Estado da conversa, decisão, `PrecoCotado`, motivos de handoff iniciais ([PR #32](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/32), mergeado) |
| `guards-linux/` | Conserto da rede de guards no Linux | Fix de portabilidade ([PR #33](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/33), mergeado) |
| `agente/` | F3 — cliente HTTP resiliente | Retry/timeout/orçamento contra a `/quote`, execução ponta a ponta ([PR #35](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/35), mergeado; [ADR-0002](../governance/adr/0002-politica-de-retry-quote.md)) |
| `trilha-privacidade/` | F4 — trilha auditável e PII | Trilha JSONL, `redigir_texto`, decisão de não pedir CPF ([PR #31](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/31), mergeado; [`docs/PRIVACIDADE.md`](../docs/PRIVACIDADE.md)) |
| `painel/` | F10 — painel de rastreio | 6 telas HTML geradas da trilha real ([PR #37](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/37), mergeado) |
| `llm/` | F6 — adaptador de LLM | `PortalDeLinguagem`, extração por texto livre, provedor OpenRouter ([PR #40](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/40), mergeado; [ADR-0003](../governance/adr/0003-provedor-e-modelo-do-llm.md)) |
| `politica-handoff/` | Política de handoff configurável | Recusa 422 configurável, intenção "quero contratar" ([PR #44](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/44), mergeado) |
| `servidor-local/` | F13 — base de conhecimento | Servidor WSGI local, edição de objeções em JSON ([PR #45](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/45), mergeado; [ADR-0004](../governance/adr/0004-servidor-local-conhecimento-json.md)) |
| `conversas-chat/` | F14 — casca única + chat; depois, por ordem do dono, mais 3 frentes na mesma sessão (chat 12) | Menu lateral e chat guiado ligado ao agente real ([PR #47](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/47), [PR #62](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/62), mergeados); depois `ia-responde` ([PR #75](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/75)), `prompt-carencia` ([PR #82](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/82)) e `docker-env-llm` ([PR #84](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/84)) — todos mergeados |
| `texto-ao-lead/` | Formato brasileiro de preço e recusa educada | `_valor_br`, `nomes_cobertura` ([PR #60](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/60), mergeado) |
| `correcoes-contratos/` | 3º contrato de camadas | `aplicacao` não importa `infra`/`interfaces` ([PR #61](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/61), mergeado) |
| `status-conversa/` | Pedido explícito de humano; depois, por ordem do dono, mais 2 frentes na mesma sessão (chat 16) | `LEAD_PEDIU_HUMANO` ([PR #63](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/63), mergeado); depois `trilha-chat-web` ([PR #76](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/76)) e `leis-processo` ([PR #85](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/85)) — todos mergeados |
| `trilha-coleta/` | Trilha da coleta determinística + 3 achados de auditoria; depois, por ordem do dono, `precommit-enxuto` na mesma sessão (chat 17) | Fecha #51/#39/#38/#55 ([PR #64](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/64), mergeado); depois `precommit-enxuto` ([PR #73](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/73)) e, mais tarde, a mesma sessão também assumiu `status-da-conversa` ([PR #87](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/87)) — todos mergeados |
| `entrega/` | F12 — README, smoke test, exportação dos `ai-logs/`; por ordem do dono, também `fichas-objecao` ([PR #77](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/77)) e `atendimento-chat-lead` (issue #86, em andamento) na mesma sessão | Este README, o roteiro de teste do README, o congelamento, este índice |
| `codex/` | Auditoria externa (Codex), antes de qualquer código | Red-team do roadmap — [`codex/2026-09-11-red-team-e-parecer-codex.md`](codex/2026-09-11-red-team-e-parecer-codex.md), idêntico ao original |

Cada pasta de sessão tem o `.jsonl` principal (a conversa) e, quando a sessão usou subagentes, uma
subpasta `subagents/` com a transcrição de cada um — a varredura cobre os dois (achado da issue #15:
uma chave real chegou a vazar só na transcrição de um SUBAGENTE, nunca na conversa principal).

## Como foi exportado

```bash
uv run scripts/sanitizar_ai_logs.py --config _local/ai-logs-config.json
```

`--config` aponta para `_local/ai-logs-config.json` (nunca commitado — modelo público com valores
FICTÍCIOS em [`scripts/ai-logs-config.exemplo.json`](../scripts/ai-logs-config.exemplo.json)): a
raiz onde ficam as pastas de sessão, o prefixo que identifica uma pasta de frente, o mapa das 3
pastas que não seguem esse padrão (coordenação, auditoria fria, sondagem inicial) e os padrões de
substituição pessoal usados durante a sanitização.

## Como foi sanitizado

`scripts/sanitizar_ai_logs.py` (commitado, sem nenhum valor pessoal dentro — os padrões reais moram
em `_local/`, nunca versionado):

1. Bloco de imagem (`"type": "image"`) vira texto `[IMAGEM REMOVIDA: captura de tela do dono]`.
2. Padrões pessoais (usuário da máquina, sobrenome do dono, e-mail, nome de outro projeto do dono)
   substituídos em todo valor-string **e toda CHAVE de dicionário** da árvore — não só em campos de
   "texto de conversa": a estrutura de uma sessão tem dezenas de tipos de evento, e um achado do
   ensaio de congelamento mostrou um caminho absoluto (usuário do Windows + nome completo do dono)
   vazando justamente por uma CHAVE (`snapshot.trackedFileBackups`), que uma sanitização só de
   valores nunca pegaria.
3. PII sintética do dataset (CPF, CEP, telefone, e-mail, placa, nome conhecido) redigida com a mesma
   função que o agente usa em produção (`dominio.redator_pii.redigir_texto`), mais uma segunda
   passada sem exigência de fronteira de palavra só para CEP/CPF — achado: o redator original exige
   um caractere não-de-palavra antes do CEP, e isso falha quando a transcrição cita código-fonte
   (docstring com `\n` como texto literal, não quebra de linha).
4. **Verificação final, fail-closed:** conta ocorrências dos padrões de segredo conhecidos
   (prefixos de chave de API conhecidos, token `Bearer` longo), dos padrões PESSOAIS (em chave OU
   valor, lidos de `_local/padroes_pessoais.txt` — arquivo criado pelo DONO, separado do arquivo de
   substituição, para ser um segundo par de olhos independente) e de blocos de imagem remanescentes;
   qualquer ocorrência **aborta a exportação inteira** e apaga o que foi escrito, citando os
   arquivos — nunca o valor. **Se `_local/padroes_pessoais.txt` não existir, a exportação recusa
   rodar** — nenhum `ai-logs/` sai sem essa checagem.

**Ensaiado antes da exportação real**, contra as sessões de 13-14/09 (18 pastas de sessão, ~78
arquivos `.jsonl`, ~230MB): depois do conserto do achado do item 2 acima, os 4 padrões pessoais
foram todos a zero em todo o corpus, e a verificação de segredo passou limpa em todas as rodadas.
`[PENDENTE: colar aqui as contagens da exportação REAL, não do ensaio — o commit desta exportação
vai ter a saída completa do script]`.

## O que ficou de fora, e por quê

- **A conversa de configuração do kit (`projeto-base`) não entrou como transcrição.** Ela é a origem
  de outro projeto do dono e ficaria ilegível depois de sanitizada. Isso foi avisado ao avaliador
  antes da entrega, como o próprio enunciado orienta.
- **Uma transcrição de subagente da frente `llm` foi excluída inteira**, não só sanitizada: durante o
  trabalho normal da frente, um subagente abriu o `.env` da máquina sem querer e a chave completa da
  API do OpenRouter ficou gravada na transcrição dele. A chave nunca chegou a ser exposta
  publicamente — o incidente foi pego antes da exportação, exatamente por isso a varredura deste
  script cobre transcrições de subagente, não só a conversa principal. A transcrição em questão foi
  excluída inteira da exportação (não redigida — o risco de uma chave real escapar de um script de
  regex era maior que o valor de manter aquele trecho específico legível). O aprendizado e o conserto
  (varredura de subagentes + checagem final que aborta) estão documentados no `CHANGELOG.md` e na
  issue [#15](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/15).

## Como navegar

Um corpus deste tamanho não se lê linear. Sugestão: comece pela issue-diário
[#16](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/16) (a ata da coordenação —
tem o resumo de cada decisão importante com o link pra sessão que a tomou), depois entre na sessão
específica se quiser ver o raciocínio completo por trás de uma decisão. Várias sessões conduziram
mais de uma frente por ordem do dono (LEI 73, exceção registrada caso a caso) — a tabela acima
declara qual pasta cobre qual frente.
