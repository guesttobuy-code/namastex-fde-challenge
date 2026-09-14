# `ai-logs/` — índice das conversas com IA

Exportação real de 14/09/2026 (rodada mais recente, corte às 13:55 -03:00, com o trabalho do dia
depois das 03:45: #109-#115), sanitizada por `scripts/sanitizar_ai_logs.py` — saída completa em
["Como foi sanitizado"](#como-foi-sanitizado), abaixo.

Este projeto foi construído por várias sessões de IA, cada frente numa worktree própria (seção
"A esteira" do `CLAUDE.md`: 1 chat = 1 frente = 1 branch = 1 worktree = 1 PR — com exceções
pontuais, documentadas onde acontecem, em que a mesma sessão conduziu mais de uma frente por ordem
do dono). Esta pasta guarda a transcrição de cada uma, sanitizada — usuário da máquina, sobrenome
do dono, e-mail e nome de outro projeto do dono removidos; segredos e dados pessoais verificados por
script, que recusa exportar se a checagem não puder rodar (`scripts/sanitizar_ai_logs.py`).

## Ferramentas usadas

- **Claude Code** — todas as sessões abaixo (coordenação e frentes). É a ferramenta principal deste
  projeto.
- **Codex** — uma auditoria externa (red-team do roadmap), antes de qualquer código:
  [`codex/2026-09-11-red-team-e-parecer-codex.md`](codex/2026-09-11-red-team-e-parecer-codex.md).
- **ChatGPT não entra** — por ordem do dono, porque não foi usado no trabalho deste desafio.

## Índice por papel

| Sessão | Arquivos | Papel | O que produziu |
|---|---|---|---|
| `coordenacao/` | 34 | Planeja, audita entre frentes, decide prioridade, aprova merge | Todo o roteamento das frentes abaixo; decisões registradas na issue-diário [#16](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/16) |
| `auditoria-fria/` | 1 | Auditoria adversarial periódica do projeto inteiro (fora do fluxo de PR) | Achado do vazamento de dado pessoal em `esteira.json` ([#17](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/17)) |
| `sondagem-inicial/` | 1 | Primeira leitura do desafio, antes de qualquer código | Levantamento inicial que virou a base do roadmap ([issue #3](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/3)) |
| `fundacao-python/` | 2 | F1 — fundação do projeto | Config Python, guards que substituem os do kit JS/TS ([PR #25](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/25), mergeado) |
| `dominio/` | 1 | F2 — domínio puro | Estado da conversa, decisão, `PrecoCotado`, motivos de handoff iniciais ([PR #32](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/32), mergeado) |
| `guards-linux/` | 1 | Conserto da rede de guards no Linux | Fix de portabilidade ([PR #33](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/33), mergeado) |
| `agente/` | 1 | F3 — cliente HTTP resiliente | Retry/timeout/orçamento contra a `/quote`, execução ponta a ponta ([PR #35](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/35), mergeado; [ADR-0002](../governance/adr/0002-politica-de-retry-quote.md)) |
| `trilha-privacidade/` | 1 | F4 — trilha auditável e PII | Trilha JSONL, `redigir_texto`, decisão de não pedir CPF ([PR #31](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/31), mergeado; [`docs/PRIVACIDADE.md`](../docs/PRIVACIDADE.md)) |
| `painel/` | 1 | F10 — painel de rastreio | 6 telas HTML geradas da trilha real ([PR #37](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/37), mergeado) |
| `llm/` | 1 | F6 — adaptador de LLM | `PortalDeLinguagem`, extração por texto livre, provedor OpenRouter ([PR #40](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/40), mergeado; [ADR-0003](../governance/adr/0003-provedor-e-modelo-do-llm.md)) |
| `politica-handoff/` | 1 | Política de handoff configurável | Recusa 422 configurável, intenção "quero contratar" ([PR #44](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/44), mergeado) |
| `servidor-local/` | 1 | F13 — base de conhecimento | Servidor WSGI local, edição de objeções em JSON ([PR #45](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/45), mergeado; [ADR-0004](../governance/adr/0004-servidor-local-conhecimento-json.md)) |
| `conversas-chat/` | 5 | F14 — casca única + chat; depois, por ordem do dono, mais 5 frentes na mesma sessão (chat 12) | Menu lateral e chat guiado ligado ao agente real ([PR #47](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/47), [PR #62](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/62), mergeados); depois `ia-responde` ([PR #75](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/75)), `prompt-carencia` ([PR #82](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/82)), `docker-env-llm` ([PR #84](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/84)), `acabamento-teste-dono` ([PR #111](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/111), mergeado) e `remover-avaliacao` ([PR #116](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/116), aberto) |
| `texto-ao-lead/` | 1 | Formato brasileiro de preço e recusa educada | `_valor_br`, `nomes_cobertura` ([PR #60](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/60), mergeado) |
| `correcoes-contratos/` | 1 | 3º contrato de camadas | `aplicacao` não importa `infra`/`interfaces` ([PR #61](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/61), mergeado) |
| `status-conversa/` | 1 | Pedido explícito de humano (chat 17); depois, pela mesma sessão e por ordem do dono, mais 4 frentes | `LEAD_PEDIU_HUMANO` ([PR #63](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/63), mergeado); depois `status-da-conversa` ([PR #87](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/87), mergeado), `precommit-enxuto` ([PR #73](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/73), mergeado), `robustez-quote-entrada` (issue #67/#68/#69, aberta, sem PR ainda) e `servidor-concorrente` ([PR #112](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/112), mergeado) |
| `trilha-coleta/` | 14 | Trilha da coleta determinística + 3 achados de auditoria (chat 16); depois, pela mesma sessão e por ordem do dono, mais 3 frentes | Fecha #51/#39/#38/#55 ([PR #64](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/64), mergeado); depois `trilha-chat-web` ([PR #76](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/76), mergeado), `leis-processo` ([PR #85](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/85), mergeado) e `relatorio-crm` ([PR #80](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/80), mergeado) |
| `entrega/` | 24 | F12 — README, smoke test, exportação dos `ai-logs/`; por ordem do dono, também `fichas-objecao` ([PR #77](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/77), mergeado) na mesma sessão | Este README, o roteiro de teste do README, o congelamento, este índice, o sanitizador S1-S5 ([PR #97](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/97), mergeado), a correção de 2 frases do README ([PR #107](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/107), mergeado, frente `ailogs-frase`) e esta reexportação (frente `ailogs-atualizacao`). `atendimento-chat-lead` (issue #86) foi aberta nesta sessão e depois **retirada do escopo desta entrega por decisão do dono** — sem commit nem PR |
| `planos-indisponivel/` | 3 | Rota de encaminhamento quando `GET /api/planos` fica indisponível (issue #95) | `POST /api/chat/planos-indisponivel`, nunca cota de verdade pro lead ([PR #100](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/100), mergeado) |
| `codex/` | 1 | Auditoria externa (Codex), antes de qualquer código | Red-team do roadmap — [`codex/2026-09-11-red-team-e-parecer-codex.md`](codex/2026-09-11-red-team-e-parecer-codex.md) |

**Total: 19 pastas de sessão + `codex/`, 95 arquivos `.jsonl` (exportação real de 14/09/2026, corte
13:55 -03:00).**

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
2. Padrões de substituição da config (usuário da máquina, sobrenome do dono, e-mail, nome de outro
   projeto do dono) trocados em todo valor-string **e toda CHAVE de dicionário** da árvore — não só
   em campos de "texto de conversa": a estrutura de uma sessão tem dezenas de tipos de evento, e um
   achado do ensaio de congelamento mostrou um caminho absoluto (usuário do Windows + nome completo
   do dono) vazando justamente por uma CHAVE (`snapshot.trackedFileBackups`), que uma sanitização
   só de valores nunca pegaria. A config local ganhou também uma variante do padrão pessoal do
   usuário do Windows para o caso em que a origem grava o caminho com barra simples — `json.loads`
   colapsa essa barra seguida da letra "r" em CARRIAGE RETURN (CR) no campo decodificado, e o
   padrão original (que espera a barra literal) não casava mais ali; a variante casa pelo CR, sem
   afrouxar a verificação final (achado da auditoria do PR #97, diagnóstico às cegas por forma de
   caractere, nunca pelo valor).
3. PII sintética do dataset (CPF, CEP, telefone, e-mail, placa, nome conhecido) redigida com a mesma
   função que o agente usa em produção (`dominio.redator_pii.redigir_texto`), mais uma segunda
   passada sem exigência de fronteira de palavra só para CEP/CPF — achado: o redator original exige
   um caractere não-de-palavra antes do CEP, e isso falha quando a transcrição cita código-fonte
   (docstring com `\n` como texto literal, não quebra de linha).
4. **Padrões PESSOAIS do dono** (`_local/padroes_pessoais.txt` — arquivo criado pelo DONO, separado
   do de substituição, para ser um segundo par de olhos independente) trocados por
   `[DADO PESSOAL REMOVIDO]`, pela MESMA travessia de chave+valor do item 2 — achado da própria
   exportação real: só CONFERIR não bastava (ninguém pode ler o valor que casa para decidir o
   conserto na mão), então o script passou a SUBSTITUIR também. O script imprime só a contagem por
   índice da lista (`padrão #N: <contagem> substituição(ões)`), nunca o valor nem a que padrão
   corresponde em texto.
5. **Prefixos de segredo OpenRouter/Anthropic trocados por `[CHAVE REMOVIDA]`, sem piso de
   comprimento** — achado ao vivo: um trecho de só 4 caracteres depois de `sk-or-v1-` (mensão de
   formato ou fragmento de chave, indistinguível sem abrir o arquivo) abortou a verificação final.
   Chave real de 64 caracteres ou trecho de 4, os dois somem antes da verificação rodar; a
   verificação final (item 6) não afrouxou — continua sem piso nenhum, exatamente como antes.
6. **Verificação final, fail-closed, sobre uma pasta de staging temporária (fora de `ai-logs/`):**
   conta ocorrências dos padrões de segredo conhecidos (prefixos de chave de API, token `Bearer`
   longo), dos padrões PESSOAIS remanescentes (esperado zero, já que os itens 4/5 os substituem —
   fica como rede de segurança) e de blocos de imagem remanescentes; confere também que toda
   "linha" continua JSON válido, separando por `\n` REAL em bytes (achado ao vivo: `json.dumps` não
   escapa U+0085/U+2028/U+2029, e o antigo `str.splitlines()` tratava esses caracteres como quebra
   de linha, fragmentando 1 registro válido em "linhas" falsas). Qualquer ocorrência **aborta a
   exportação inteira**, citando os arquivos — nunca o valor — e `ai-logs/` nunca chega a ser
   tocado. **Se `_local/padroes_pessoais.txt` não existir, a exportação recusa rodar.** Só se a
   verificação passar, o script troca em `ai-logs/` **apenas as pastas de sessão exportadas** —
   `ai-logs/README.md` e `ai-logs/codex/` nunca são apagados nem tocados (achado do primeiro
   comando da exportação real: a versão anterior apagava `ai-logs/` inteira antes de escrever,
   derrubando este README do disco por um instante — recuperado pelo git, nunca perdido, mas
   corrigido para não acontecer de novo).
7. **Antes de sanitizar, tira um RETRATO de cada arquivo** (`shutil.copy2` pra uma pasta temporária)
   e sanitiza só o retrato, nunca o arquivo vivo — achado ao vivo: uma sessão ainda ativa no
   instante da exportação causou linhas finais quebradas porque o script lia o arquivo enquanto ele
   crescia. Se a última linha do retrato não termina em `\n` (escrita pela metade no instante exato
   da cópia), só ela é descartada, com aviso da contagem.

**Exportação real, 14/09/2026, corte 13:55 -03:00 (rodada mais recente)** — 19 pastas de sessão +
`codex/`, 95 arquivos `.jsonl`, incluindo o trabalho do dia depois das 03:45 (issues #109-#115):
```
[sanitizar_ai_logs] 95 arquivo(s) sanitizado(s) (staging, fora de ai-logs)
[sanitizar_ai_logs] verificacao final: zero padrao de segredo, zero padrao pessoal (chave ou valor), zero bloco de imagem, 100% das linhas JSON validas.
[sanitizar_ai_logs] padrao #3: 2 substituicao(oes)
[sanitizar_ai_logs] padrao #14: 6 substituicao(oes)
[sanitizar_ai_logs] padrao #15: 4 substituicao(oes)
[sanitizar_ai_logs] padrao #18: 19 substituicao(oes)
```
Segunda verificação, independente do script, nos BYTES CRUS (não no campo decodificado) —
varredura própria da coordenação pelos 18 padrões pessoais, formato "índice + contagem", nunca o
valor:
```
arquivos_varridos=97 padroes=18
(as 18 linhas "padrao #N ... ocorrencias=0 arquivos=0")
TOTAL_OCORRENCIAS=0
```
Terceira verificação, `git grep` restrito às transcrições (`.jsonl`), pelo FORMATO completo de cada
segredo (não só o prefixo): `sk-or-v1-[A-Za-z0-9._-]*`, `sk-ant-[A-Za-z0-9._-]*`,
`ghp_[A-Za-z0-9]{10,}`, `github_pat_[A-Za-z0-9_]{10,}` — as 4 buscas vazias. Um `git grep` pelo
prefixo nu (sem o formato completo) acha menções curtas de `ghp_`/`github_pat_` nas transcrições —
são o texto do próprio `PADROES_DE_SEGREDO` do `sanitizar_ai_logs.py` sendo discutido/colado nas
sessões que trabalharam no script, não chave real (mesma classe de falso positivo que o prefixo
`sk-or-v1-` sozinho também tem, sem o formato completo — ver item 5, acima).

## O que ficou de fora, e por quê

- **A conversa de configuração do kit (`projeto-base`) não entrou como transcrição.** Ela é a origem
  de outro projeto do dono, não é trabalho deste desafio, e ficaria ilegível depois de sanitizada.
  Se cabe um aviso explícito ao avaliador sobre essa exclusão (como o enunciado orienta para quando
  a exportação de algo não é viável) é decisão do dono — item C7 da
  [#89](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/89), ainda "a confirmar".
- **Uma transcrição de subagente da frente `llm` foi excluída inteira**, não só sanitizada: durante o
  trabalho normal da frente, um subagente abriu o `.env` da máquina sem querer e a chave completa da
  API do OpenRouter ficou gravada na transcrição dele. A chave nunca chegou a ser exposta
  publicamente — o incidente foi pego antes da exportação, exatamente por isso a varredura deste
  script cobre transcrições de subagente, não só a conversa principal. A transcrição em questão foi
  excluída inteira da exportação (não redigida — o risco de uma chave real escapar de um script de
  regex era maior que o valor de manter aquele trecho específico legível). O aprendizado e o conserto
  (varredura de subagentes + checagem final que aborta) estão documentados no `CHANGELOG.md` e no
  [comentário da coordenação na #15](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/15#issuecomment-5648754665)
  que mediu o incidente.

## Como navegar

Um corpus deste tamanho não se lê linear. Sugestão: comece pela issue-diário
[#16](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/16) (a ata da coordenação —
tem o resumo de cada decisão importante com o link pra sessão que a tomou), depois entre na sessão
específica se quiser ver o raciocínio completo por trás de uma decisão. Várias sessões conduziram
mais de uma frente por ordem do dono (exceção à esteira, registrada caso a caso) — a tabela acima
declara qual pasta cobre qual frente.
