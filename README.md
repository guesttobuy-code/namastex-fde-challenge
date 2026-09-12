# Desafio FDE/AI Engineer (Namastex) — agente de cotação de seguro auto

Solução ao [Desafio Técnico — FDE / AI Engineer](docs/DESAFIO.md) (enunciado original da Namastex,
preservado e restaurado sem edição). Este README documenta **como rodar** e **as decisões que
tomei, com o porquê** — na mesma ordem em que o enunciado diz que vai olhar
([`docs/DESAFIO.md#como-a-gente-vai-olhar`](docs/DESAFIO.md#como-a-gente-vai-olhar)).

> **Regra que segui ao escrever isto:** todo número aqui tem uma fonte ao lado — issue, ADR, arquivo
> de log ou saída de comando. Se um número não tem fonte, ele não devia estar aqui; me avise se achar um.

---

## 1. Em uma frase, e como rodar

Um agente que conversa com um lead, cota um seguro de veículo contra a `/quote` real, decide sozinho
quando dá e encaminha pra um humano com motivo explícito quando não dá. O caminho de decisão
(`src/dominio/politica.py`) é 100% determinístico — sem relógio, sem rede, sem LLM — de propósito
(docstring de `src/interfaces/cli.py:1-7`); se um adaptador de LLM real entrou nesta entrega para
outra parte do fluxo (extração/redação de texto, nunca a decisão), o estado final está na
[issue #9](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/9) e em [§9](#9-o-que-ficou-de-fora-e-por-quê).

```bash
# 1. sobe a API de cotação (comando do enunciado, docs/DESAFIO.md)
docker compose up --build
# API em http://localhost:8000

# 2. roda uma conversa completa (comando real, docstring de src/interfaces/cli.py:9-13)
PYTHONPATH=src python -m interfaces.cli
```

O agente pergunta idade, ano do veículo, CEP (obrigatórios), plano e data de início (opcionais, Enter
pula) — nessa ordem (`src/interfaces/cli.py::coletar_dados`, linhas 72-96). Para automatizar sem
digitar:

```bash
echo "35
2022
01310-100
completo
2026-07-15" | PYTHONPATH=src python -m interfaces.cli
```

Cada execução grava, em `examples/`: a transcrição (`execucao_<id>.log`), a trilha bruta
(`trilha_<id>.jsonl`) e a trilha legível (`trilha_<id>.log`) — ver [§5](#5-dá-pra-rastrear-o-que-aconteceu).

---

## 2. Funciona de ponta a ponta?

Sim — duas execuções reais, sem edição, ficaram em `examples/` como entregável (item 4 do enunciado):

- [`examples/execucao_conv-d656ea8c.log`](examples/execucao_conv-d656ea8c.log) — cotação sai:
  `decisão: explicar_cotacao` / `Plano Completo: R$ 241.38/mês...`. A trilha
  ([`trilha_conv-d656ea8c.jsonl`](examples/trilha_conv-d656ea8c.jsonl)) mostra a `/quote` simulando
  instabilidade real e o agente vencendo por retry: tentativa 1 `502` (indisponível, 336ms), tentativa 2
  `502` (58ms), tentativa 3 `200` (38ms, prêmio R$ 241,38) — três chamadas, uma cotação.
- [`examples/execucao_conv-9a861a37.log`](examples/execucao_conv-9a861a37.log) — a `/quote` não
  responde e o agente encaminha: `decisão: encaminhar (reason_code=quote_indisponivel)`. A trilha
  ([`trilha_conv-9a861a37.jsonl`](examples/trilha_conv-9a861a37.jsonl)) mostra três `500` seguidos
  (2795ms, 265ms, 401ms) até o orçamento não comportar mais uma tentativa, e o evento `handoff` sendo
  gravado com o motivo.

---

## 3. O que ele faz quando a `/quote` falha? (o ponto que mais separa, diz o enunciado)

A `/quote` simula instabilidade de propósito: **20% das chamadas falham com 5xx e 10% demoram 8s**
(contexto medido na issue #3, citado em
[`governance/adr/0002-politica-de-retry-quote.md`](governance/adr/0002-politica-de-retry-quote.md)).
Sem tratamento, o lead veria 8 segundos de silêncio numa fração real das conversas, ou o agente
travaria numa chamada que nunca volta.

**Política adotada (medida, não intuída — três políticas testadas, 150 ciclos cada, contra o serviço
real; tabela completa no ADR-0002):**

| Política | Sucesso | p50 | p90 | máx | Chamadas/cotação |
|---|---|---|---|---|---|
| 10s/10s/10s | 147/150 | 0,02s | 8,00s | 8,44s | 1,35 |
| **3s/3s/3s (escolhida)** | **148/150** | **0,02s** | **1,23s** | 7,22s | **1,31** |
| 4s/4s/10s | 149/150 | 0,01s | 4,42s | 9,23s | 1,39 |

**3s de timeout por tentativa, até 3 tentativas, espera de 0,4s/0,8s entre elas, orçamento total de
~10s.** Corta a cauda de 8,00s para 1,23s no p90 sem perder confiabilidade (148 vs. 147/150) nem gastar
mais chamadas — nenhuma das três domina em tudo, mas a de 3s vence por ter a melhor cauda no mesmo
patamar de sucesso.

**Classificação de resposta** (`_traduzir` em `src/infra/cliente_quote.py`, ver
[`governance/adr/0002-politica-de-retry-quote.md`](governance/adr/0002-politica-de-retry-quote.md)):
`5xx` e timeout de tentativa **repetem** (se sobrar orçamento); `422` (recusa de negócio ou validação)
e `400` (payload inválido) são **terminais** — repetir um erro de payload não muda o resultado.

**O timeout de 3s não é parede dura por tentativa** — é o `timeout` do `urllib`, que vale por operação
de socket, não por um cronômetro de parede sobre a chamada inteira. Uma tentativa real chegou a
**3617ms**, ~600ms além do nominal
(`git show 8c35203:examples/trilha_conv-7c44f694.jsonl` — arquivo existiu em `examples/` e foi
substituído quando os exemplos acima foram regenerados; só é acessível pelo sha antigo hoje). O que
segura de verdade é o **orçamento total de 10s**, provado com tempo de parede real (não só relógio
falso): contra um `quote-service` dedicado sempre-lento (8s), o cliente levou **10,016s reais** e
desistiu — nunca os **~24s** que 3 tentativas de 8s dariam sem orçamento
(`src/infra/CONTRACT.md:57`, invariante I-5; o mesmo comportamento em relógio falso está em
`tests/infra/test_cliente_quote.py::test_200_lento_alem_do_orcamento_respeita_o_deadline_de_10s_em_vez_de_esperar_para_sempre`).

Duas trilhas reais mostram os dois caminhos: `502→502→200` acima (sucesso por retry) e
`timeout→timeout→500→encaminhar` (`git show 8c35203:examples/trilha_conv-7c44f694.jsonl`) — três
tentativas retentáveis esgotadas, handoff explícito, nunca um preço inventado.

---

## 4. O critério de passar pra humano é explícito e defensável?

Sim, e é uma função pura: `src/dominio/politica.py::decidir` — sem relógio, sem rede, sem LLM, recebe
estado + resultado e devolve uma `Decisao`. O `Decisao.__post_init__`
(`src/dominio/decisao.py:32-37`) é uma invariante do domínio: **toda decisão `ENCAMINHAR` exige um
motivo — nunca existe handoff silencioso.**

Os três motivos são um Enum fechado (`MotivoHandoff`, `src/dominio/decisao.py:21-24`) — vocabulário
único que atravessa domínio (decide), trilha (grava `.value`) e tela (mostra), decisão da coordenação
na issue #16 (R5) para não nascerem três grafias da mesma coisa:

| `StatusCotacao` (resultado da `/quote`) | `MotivoHandoff` | Decisão |
|---|---|---|
| `SUCESSO` | — | `EXPLICAR_COTACAO` (mostra o preço) |
| `RECUSA_DE_NEGOCIO` (422 de regra) | — | `ENCERRAR` |
| `INDISPONIVEL` (5xx esgotado) | `QUOTE_INDISPONIVEL` | `ENCAMINHAR` |
| `TIMEOUT` (timeout esgotado) | `QUOTE_TIMEOUT` | `ENCAMINHAR` |
| `ERRO_DE_PAYLOAD` (400/422 de validação) | `QUOTE_ERRO_DE_PAYLOAD` | `ENCAMINHAR` |

Timeout e erro de payload viram `ENCAMINHAR` pelo mesmo motivo prático: nenhum dos dois é culpa do
lead, e nos dois um humano precisa saber que a cotação não saiu (comentário de código em
`src/dominio/politica.py`, decisão R5/#16).

---

## 5. Dá pra rastrear o que aconteceu?

Sim — cada evento vira uma linha JSONL, gravada por `ServicoDeTrilha`, o **único** portão de escrita
(`src/aplicacao/CONTRACT.md:11-12`: nenhum código grava direto no `RepositorioDeTrilha`). Todo evento
carrega `id`, `conversation_id` e `instante` (`src/dominio/eventos_trilha.py:18-22`); os 7 tipos
possíveis são `mensagem_recebida`, `mensagem_enviada` (com `decisao_id`/`regra_aplicada`/
`origem_do_texto`/`quote_attempt_id` — proveniência, não só o texto), `tentativa_de_cotacao` (uma por
chamada HTTP, não por cotação — com `http_status`, `classificacao`, `latencia_ms`,
`orcamento_restante_ms`), `decisao`, `handoff`, e dois para correção de erro (`erro_marcado`,
`correcao_registrada`) que os dois exemplos em `examples/` não exercitam.

**O painel visual de rastreio é um buraco declarado, não escondido:** existe um mock estático de
design em [`docs/design/rastreio.html`](docs/design/rastreio.html) (dados fictícios, não lê a trilha
real — `docs/design/ESPECIFICACAO.md:120`), e a versão que leria a trilha de verdade é a
[issue #13](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/13) (F10), ainda aberta.
Ver [§9](#9-o-que-ficou-de-fora-e-por-quê).

---

## 6. Cuidado com dados sensíveis

**Decisão consciente: o agente nunca pede CPF.** A `/quote` não usa CPF em nenhum campo
(`quote-service/app/quote_logic.py`) — minimização na origem, não só mascaramento na saída
([`docs/PRIVACIDADE.md`](docs/PRIVACIDADE.md), decisão dona única deste assunto). Se o lead oferecer
CPF por conta própria (acontece em 100% das conversas sintéticas do dataset), o valor é mascarado como
qualquer outra PII, mas nunca decide nada.

`redigir_texto` (`src/dominio/redator_pii.py`) cobre CPF, CEP, telefone, e-mail, placa (Mercosul e
antiga) e nome próprio conhecido — casando pelo **formato** do valor, nunca pela palavra-rótulo (o
gerador do dataset baixa `CPF`/`CEP` para minúsculo quando não é a primeira palavra do bloco;
[`docs/PRIVACIDADE.md`](docs/PRIVACIDADE.md) documenta a medição). Tanto a trilha quanto a transcrição
de `examples/*.log` passam por esse redator antes de serem salvas (`src/interfaces/cli.py:40-41,52`) —
os dois são commitados num repo público.

Limite conhecido e declarado, não escondido: a extração não usa NER — um nome que não esteja na lista
de nomes conhecidos passa intacto. Detalhe completo em [`docs/PRIVACIDADE.md`](docs/PRIVACIDADE.md).

---

## 7. Qualidade: outro engenheiro entende as decisões?

Quatro camadas com fronteira cobrada por ferramenta, não por convenção verbal — `.importlinter`
(raiz do repo) proíbe `dominio` de importar `aplicacao`/`infra`/`interfaces`, e `infra` de importar
`interfaces`; roda no CI. Cada camada tem `CONTRACT.md` próprio com as invariantes e o teste que cobre
cada uma (ex.: `src/infra/CONTRACT.md`, `src/dominio/CONTRACT.md`).

O método de prova por trás de cada PR é medido, não alegado: guard `companion-red-green` (o teste tem
que estar vermelho antes do conserto e verde depois — nunca nascer verde), e roteiros de reprodução
executados nos dois sentidos (mutação aplicada → falha; revertida → verde de novo — ex. registrado no
`CHANGELOG.md` para a invariante do preço). A rede completa de guards do repositório está listada em
`.github/workflows/README.md`.

---

## 8. Como a IA foi usada

O método: uma **frente por chat** (1 branch, 1 worktree, 1 PR), quem implementa nunca audita o próprio
PR — outro chat audita adversarialmente e publica o veredito como comentário no PR, e o merge é sempre
de uma pessoa. Cada frente do roadmap é uma issue do GitHub, com o plano publicado **antes** do
primeiro commit. O texto completo do processo está nas issues e nos `ai-logs/` (ver
[`ai-logs/README.md`](ai-logs/README.md)) — aqui vai a lista dos erros que viraram melhoria, porque
mostrar o erro com o conserto ao lado é mais honesto do que fingir que não aconteceu:

- **Vazamento de dado pessoal pego pela auditoria, não pelo autor**
  ([#17](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/17)): o `esteira.json`
  gravava o nome real do dono do projeto dentro de um campo marcado "privado" — commitado no fork
  público. A auditoria fria reprovou a frente por isso; o campo saiu do arquivo e o nome saiu do
  histórico visível.
- **Uma regra de segurança foi corrigida duas vezes, a segunda vez pela própria frente que a
  escreveu.** A narrativa original dizia que a flag `(?i)` protegia CPF/CEP contra vazamento por
  case; medição provou o contrário (CPF/CEP são só dígitos — não têm maiúscula). A própria frente
  refutou a própria alegação antes de fechar, e derrubou de quebra um roteiro de prova que a
  coordenação tinha aprovado em cima da narrativa errada.
- **Um documento de leis existiu, mas não chegou a ninguém.** `docs/LEIS-DO-PROJETO.md` foi escrito
  para ser o lugar onde toda frente lê as regras do dono — e ficou em dois commits locais da árvore
  de integração, nunca enviados ao repositório remoto. As seis frentes abertas naquele dia trabalharam
  sem ele. O erro não era o conteúdo; era o lugar onde ele estava.
- **O auditor externo (Codex) acertou duas previsões antes de qualquer código existir, e eu demorei a
  agir.** Numa auditoria adversarial do roadmap, antes da primeira linha de implementação, o parecer
  registrado dizia que a governança podia consumir mais prazo que o produto, e que a entrega dependia
  de uma frente marcada como opcional. As duas se confirmaram: ao meio-dia de 12/09 a `main` tinha 17
  linhas de produto e uma frente de governança inteira fechada, e foi preciso cortar rito às pressas;
  e o painel de rastreio — marcado "se sobrar tempo" — acabou sendo a peça que a especificação do mock
  amarrava à trilha real, ou seja, nunca foi de fato opcional.

---

## 9. O que ficou de fora, e por quê

Escopo cortado por prazo (3 dias), sempre com issue aberta e razão declarada — nada sumiu em silêncio:

| Ficou de fora | Por quê | Issue |
|---|---|---|
| Bateria adversarial completa (infra, integridade, dados sujos, injeção, mídia) | prazo | [#10](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/10) |
| Painel de rastreio real (só existe o mock estático, ver [§5](#5-dá-pra-rastrear-o-que-aconteceu)) | marcado "se sobrar tempo"; não sobrou | [#13](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/13) |
| Webhook estilo WhatsApp | fora do caminho crítico do desafio | [#12](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/12) |
| Disjuntor, cache e concorrência por medição | resiliência extra além do que a `/quote` exige hoje | [#14](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/14) |
| Especificação formal das 6 telas do mock (inclusive "Avaliação") | mock ficou de design, sem contrato tela↔trilha ainda | [#26](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/26) |
| Adaptador de LLM real | **em aberto no momento em que este README foi escrito** (12/09) — a política de decisão é e continua 100% determinística; um LLM, se entrar, cobriria só extração/redação de texto, nunca preço/recusa/handoff. O desfecho real (entrou ou saiu declarado) está na issue, não aqui | [#9](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/9) |
| Dataset em camadas (Silver mascarado) | além do escopo do agente em si | [#11](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/11) |

**O mock de design (`docs/design/handoffs.html`) lista 8 motivos de handoff; o Enum real
(`MotivoHandoff`) tem 3.** O mock foi desenhado antes da política determinística existir — é uma
UI mais rica do que a política atual decide, e é exatamente o gap que a issue
[#26](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/26) cobre.

O guard `plano-na-issue` ficou **vermelho** no PR #35 — troca consciente: essa frente rodou em
"regime enxuto", autorizado explicitamente pelo dono no comentário de escopo, sem a rodada normal de
PLANO antes do código. Todos os outros 27 checks daquele PR passaram.

---

## 10. Limites conhecidos

- **O timeout de 3s por tentativa não é parede dura** (ver [§3](#3-o-que-ele-faz-quando-a-quote-falha-o-ponto-que-mais-separa-diz-o-enunciado)) — 3617ms medidos numa tentativa real. **O orçamento total de 10s é** parede dura, medido em tempo de parede real.
- **O mascaramento de PII não usa NER** — só redige nomes de uma lista conhecida; um nome fora dela passa intacto (`docs/PRIVACIDADE.md`).
- **Sem projeto Python instalável** (sem `pip install -e .`) — decisão deliberadamente adiada (nota R9/#16); por isso rodar exige `PYTHONPATH=src`, documentado no comando acima.
- **`.arch-layers.json` não existe** — a fronteira de camadas é cobrada de verdade pelo `.importlinter` no CI, mas o guard `docs-required` do kit ainda não confere essa fronteira automaticamente (nota registrada no `CHANGELOG.md`).

---

## Estrutura do repositório

```
quote-service/   API de cotação fornecida pela Namastex (docs/DESAFIO.md)
dataset/         histórico de conversas + dicionário, fornecidos pela Namastex
src/             o agente: dominio/ (regras puras) · aplicacao/ (orquestra) · infra/ (HTTP, trilha) · interfaces/ (CLI)
tests/           testes por camada + arquitetura + integração
examples/        as duas execuções reais exigidas pelo enunciado (item 2 acima)
governance/      ADRs, contratos por módulo, matriz de impacto, guards
docs/            DESAFIO.md (enunciado original), PRIVACIDADE.md, design/ (mocks)
ai-logs/         conversas com IA durante o desafio — ver ai-logs/README.md
```
