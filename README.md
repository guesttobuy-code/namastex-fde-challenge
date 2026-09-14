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
(`src/dominio/politica.py`) é 100% determinístico — sem relógio, sem rede, sem LLM na decisão em si
— de propósito. Um LLM real (OpenRouter, `deepseek/deepseek-chat-v3.1` — ver
[ADR-0003](governance/adr/0003-provedor-e-modelo-do-llm.md)) já existe no repositório para **coletar
dados por texto livre** em vez do roteiro fixo de perguntas, opcional e desligado por padrão — ver
[§4](#4-o-critério-de-passar-pra-humano-é-explícito-e-defensável) e a seção sobre coleta livre abaixo.

**Um comando só sobe tudo, tudo local — sem nuvem** (decisão do dono, issue #18,
[ADR-0004](governance/adr/0004-servidor-local-conhecimento-json.md)):

```bash
docker compose up --build
```

Isso sobe dois serviços: a `/quote` da Namastex em `http://localhost:8000` (inalterada,
`docs/DESAFIO.md`) e o app desta entrega em `http://localhost:8080`
(`docker-compose.yml`, serviço `app`) — três rotas nele:

| Rota | O que é | Estado |
|---|---|---|
| `/` | **chat guiado e determinístico** (`src/interfaces/chat/`), ligado ao agente real — mesmo `aplicacao.servico_conversa.conduzir_conversa` que a CLI chama, nunca reimplementado. Sem LLM de propósito (decisão da coordenação: quem avalia não tem chave) | funcional |
| `/conhecimento` | editor da base de conhecimento (objeções do lead → resposta orientada) — funcional, ver [§4](#4-o-critério-de-passar-pra-humano-é-explícito-e-defensável) | funcional |
| `/painel/` | o painel de rastreio (seis telas, [§5](#5-dá-pra-rastrear-o-que-aconteceu)) — gerado em build-time e **regenerado a cada cotação/handoff novo no chat**, sem reiniciar o servidor (`interfaces.painel.gerar.gerar_paineis`, chamado de novo depois de cada `/api/chat/cotar`/`contratar` — [ADR-0005](governance/adr/0005-chat-guiado-estado-e-contato.md), decisão 2) | funcional |

Pelo chat: aviso de privacidade antes das perguntas, nome + WhatsApp obrigatórios (e-mail opcional),
idade (menor de 18 não cota — ver [limite conhecido](#10-limites-conhecidos)), veículo, **CEP
obrigatório** (decisão do dono, 13/09 — o cálculo da `/quote` cobre até 30% a menos sem ele, em
silêncio, e o protótipo original que sugeria "pode pular" nunca tinha conferido essa regra), plano
em cards com coberturas/franquia lidas de `GET /api/planos` (nunca escritas à mão na tela) e resumo
final editável. "Quero contratar" e "Falar com um corretor" caem no mesmo endpoint
(`POST /api/chat/contratar`) — hoje o domínio só tem um sinal de escalonamento explícito do lead
(`Intencao.QUER_CONTRATAR` → `MotivoHandoff.LEAD_QUER_CONTRATAR`, incondicional,
[§4](#4-o-critério-de-passar-pra-humano-é-explícito-e-defensável)); a tela não decide nada, só chama
o mesmo caso de uso. Detalhe completo (as 5 rotas, o contrato, os achados da auditoria) no
`CHANGELOG.md`.

**A CLI continua funcionando** como caminho alternativo de terminal — o mesmo agente, a mesma
trilha, a mesma `/quote`:

```bash
# macOS/Linux (bash/zsh):
PYTHONPATH=src python -m interfaces.cli
# Windows (PowerShell):
$env:PYTHONPATH = "src"; python -m interfaces.cli
```

O agente pergunta idade, ano do veículo, CEP (obrigatórios), plano e data de início (opcionais, Enter
pula) — nessa ordem (`src/interfaces/cli.py::coletar_dados`). Para automatizar sem digitar:

```bash
# macOS/Linux
echo "35
2022
01310-100
completo
2026-10-15" | PYTHONPATH=src python -m interfaces.cli
```

```powershell
# Windows PowerShell
$env:PYTHONPATH = "src"
"35`n2022`n01310-100`ncompleto`n2026-10-15`n" | python -m interfaces.cli
```

Cada execução grava, em `examples/`: a transcrição (`execucao_<id>.log`), a trilha bruta
(`trilha_<id>.jsonl`) e a trilha legível (`trilha_<id>.log`) — ver [§5](#5-dá-pra-rastrear-o-que-aconteceu).

**Coleta por texto livre (opcional, LLM real):** em vez do roteiro fixo acima, o lead pode escrever
livre e um `PortalDeLinguagem` extrai os dados turno a turno (`src/interfaces/cli.py`,
`coletar_dados_por_texto_livre` — caminho **adicional**, nunca substitui o determinístico, que
continua sendo o padrão). Liga com uma variável de ambiente:

```bash
# .env na raiz (copie .env.example) com:
#   LLM_PROVEDOR=openrouter
#   OPENROUTER_API_KEY=<sua chave>
PYTHONPATH=src python -m interfaces.cli
```

Sem `LLM_PROVEDOR=openrouter` no ambiente, o comportamento é exatamente o de cima — sem chave, sem
LLM, ninguém trava esperando uma variável que não tem (`src/interfaces/cli.py`, trecho do
`if __name__ == "__main__":`). Execução real ponta a ponta com o adaptador de verdade contra o
OpenRouter: [`examples/execucao_conv-4aa7be91.log`](examples/execucao_conv-4aa7be91.log) — a trilha
grava `origem_do_texto="llm:deepseek/deepseek-chat-v3.1@v1"` por turno
([`examples/trilha_conv-4aa7be91.jsonl`](examples/trilha_conv-4aa7be91.jsonl)).

**IA responde objeção de preço (opcional, mesma chave — issue #58):** depois do card de preço, o
chat web ganha um campo de texto livre para o lead escrever uma objeção ("achei caro", "vi mais
barato na concorrente"...); a IA responde a partir da Base de conhecimento
(`conhecimento/objecoes/*.json`, ver [§6](#6-cuidado-com-dados-sensíveis)), nunca com um número
fora de `{{marcador}}`. Liga com o MESMO `LLM_PROVEDOR=openrouter` de cima — uma conta, uma
variável (LEI do dono único). **Sem chave, ou sem nenhuma ficha publicada, a resposta é sempre o
mesmo texto fixo oferecendo um corretor** — nunca um número inventado
(`src/aplicacao/servico_resposta_orientada.py:171-172,178-189`,
`src/infra/adaptador_de_linguagem.py:345-360`). Limites medidos desta função: [§10](#10-limites-conhecidos).

### Ligando a IA real que responde objeção de preço (issue #81)

`docker compose up --build` funciona sem nenhuma configuração extra — sem `.env`, o agente
responde qualquer dúvida de preço com um texto fixo, nunca trava nem some. Para a resposta vir do
LLM de verdade (lendo a base de conhecimento e preenchendo o preço real), crie um `.env` na raiz
(nunca versionado) a partir de `.env.example`:

```bash
LLM_PROVEDOR=openrouter
OPENROUTER_API_KEY=<sua chave da OpenRouter>
```

O `docker compose` repassa essas duas variáveis para o container `app` em tempo de execução (nunca
entram na imagem nem no log) — o mesmo `.env` funciona rodando o servidor direto no host, sem
Docker (`PYTHONPATH=src python -m interfaces.servidor`).

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
estado + resultado (e, desde a issue #42, a `ConfiguracaoComercial` do momento) e devolve uma
`Decisao`. O `Decisao.__post_init__` (`src/dominio/decisao.py`) é uma invariante do domínio: **toda
decisão `ENCAMINHAR` exige um motivo — nunca existe handoff silencioso.**

`MotivoHandoff` é um Enum fechado — vocabulário único que atravessa domínio (decide), trilha (grava
`.value`) e tela (mostra), decisão da coordenação na issue #16 (R5) para não nascerem três grafias da
mesma coisa. **Tinha 3 valores, ganhou mais 3 nas issues #42 e #57:**

| `StatusCotacao` (resultado da `/quote`) | `MotivoHandoff` | Decisão |
|---|---|---|
| `SUCESSO` | — | `EXPLICAR_COTACAO` (mostra o preço) |
| `RECUSA_DE_NEGOCIO` (422 de regra) — `encaminhar_lead_fora_do_padrao=False` | — | `ENCERRAR`, com recusa educada e o motivo traduzido |
| `RECUSA_DE_NEGOCIO` (422 de regra) — `encaminhar_lead_fora_do_padrao=True` (padrão) | `RECUSA_REGRA_DE_ACEITACAO` | `ENCAMINHAR` a um corretor |
| `INDISPONIVEL` (5xx esgotado) | `QUOTE_INDISPONIVEL` | `ENCAMINHAR` |
| `TIMEOUT` (timeout esgotado) | `QUOTE_TIMEOUT` | `ENCAMINHAR` |
| `ERRO_DE_PAYLOAD` (400/422 de validação) | `QUOTE_ERRO_DE_PAYLOAD` | `ENCAMINHAR` |
| lead diz explicitamente que quer contratar (`Intencao.QUER_CONTRATAR`, checado **antes** de qualquer outro ramo, sem esperar dado completo nem cotação) | `LEAD_QUER_CONTRATAR` | `ENCAMINHAR` — fechamento é sempre de um corretor |
| lead pede explicitamente para falar com um atendente (`Intencao.QUER_FALAR_COM_HUMANO` — "quero falar com um atendente", "me passa pra uma pessoa" — mesmo grau incondicional de `QUER_CONTRATAR`, nunca reaproveita aquele motivo) | `LEAD_PEDIU_HUMANO` | `ENCAMINHAR` |

Timeout e erro de payload viram `ENCAMINHAR` pelo mesmo motivo prático: nenhum dos dois é culpa do
lead, e nos dois um humano precisa saber que a cotação não saiu (decisão R5/#16). A recusa de negócio
(422) é **configurável**: `ConfiguracaoComercial.encaminhar_lead_fora_do_padrao` (padrão `True`)
decide se um lead fora do padrão de aceitação da seguradora vai pra um corretor ou só recebe uma
recusa educada — editável em [`/conhecimento`](#1-em-uma-frase-e-como-rodar) (`/api/configuracao-comercial`).

A distinção entre `QUER_CONTRATAR` e `QUER_FALAR_COM_HUMANO` não é regra de palavra-chave — é o
mesmo `PortalDeLinguagem` que extrai idade/CEP decidindo pelo texto livre do lead. Medido contra o
modelo real (OpenRouter `deepseek/deepseek-chat-v3.1`), não simulado: **5 de 5** frases pedindo
humano classificadas certo, e os 3 controles negativos ("quero contratar", uma frase de dado comum,
uma pergunta de preço) não confundidos com pedido de humano
([veredito de auditoria](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/63#issuecomment-5656183650)).

O mock de design (`docs/design/handoffs.html`) lista 8 motivos; o Enum real tem **6** hoje (era 3) —
o gap fechou em 3, os 2 que faltam (mídia não suportada, dado ambíguo do cliente) não têm frente
aberta ainda.

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

**A coleta determinística (sem LLM) também grava pergunta a pergunta na trilha** — antes só o
caminho por LLM fazia isso. `aplicacao.servico_conversa.registrar_pergunta_de_coleta`/
`registrar_resposta_de_coleta` são o dono único da escrita (LEI 11), usadas pelos dois caminhos de
coleta (`interfaces.cli` não importa mais `dominio.eventos_trilha` diretamente). O evento de estado
consolidado que fecha a coleta ganha `sender_role="sistema"` — para não parecer fala literal do
lead na trilha quando na verdade é o sistema resumindo os campos.

Dois achados de higiene corrigidos no mesmo PR: o prompt fixo do sistema ("Qual o seu CEP?") não é
mais mascarado como se fosse PII do lead (`_Transcricao.emitir(..., redigir=False)` só na linha do
prompt — a resposta do lead continua sempre redigida; teste ponta a ponta em
`tests/interfaces/test_cli.py` prova os dois lados); e `painel/tela_regras.py` deixa de importar
`infra` direto — quem busca os dados agora é `painel/gerar.py` (raiz de composição), com a
invariante nova `I-4` (`src/interfaces/CONTRACT.md`) coberta por teste dedicado
(`tests/arquitetura/test_fronteiras.py::test_telas_do_painel_nao_importam_infra_direto`).

**O painel visual lê a trilha real** (issue #13/F10, `src/interfaces/painel/`) — seis telas em HTML
estático, sem servidor e sem JavaScript, geradas do mesmo `.jsonl` acima:

```bash
# macOS/Linux
PYTHONPATH=src python -m interfaces.painel.gerar examples examples/painel
```

```powershell
# Windows PowerShell
$env:PYTHONPATH = "src"
python -m interfaces.painel.gerar examples examples/painel
```

Abra [`examples/painel/index.html`](examples/painel/index.html) no navegador (já gerado e commitado
— rodar de novo é opcional, e reproduz os mesmos arquivos byte a byte, conferido nesta frente com as
duas formas do comando acima). Uma tela por link no topo:

- **Conversas** (`index.html`) — lista cada conversa com o desfecho final (cotação ou handoff).
- **Rastreio** (`rastreio.html`) — a timeline evento a evento de uma conversa, aberta.
- **Cotações** (`cotacoes.html`) — cada tentativa de `/quote` com status e latência, agrupadas por
  cotação.
- **Fila humana** (`handoffs.html`) — só as conversas que viraram `ENCAMINHAR`, com o motivo.
- **Regras e política** (`regras.html`) — a tabela de preço e a política de retry, lidas do código
  (`src/infra/cliente_quote.py`), nunca redigitadas.
- **Avaliação** (`avaliacao.html`) — mostra **"eval/casos.jsonl não encontrado"** de propósito: o
  conjunto de avaliação é da F8 (issue #11), fora desta entrega — não é a tela quebrada, é o buraco
  declarado aparecendo onde o avaliador olha.

**Um número real, com a fonte:** das 5 tentativas que falharam nas 3 conversas de exemplo, só 2
tiveram sucesso depois na mesma cotação — **40% (2 de 5) absorvidas por retry**
([`examples/painel/cotacoes.html`](examples/painel/cotacoes.html), calculado por
`_absorcao_por_retry` em `src/interfaces/painel/tela_cotacoes.py` a partir das trilhas reais de
`examples/`; achado da auditoria do PR #37 — a versão anterior confundia "falhou" com "foi
absorvida" e contava 71,4%).

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

**O contato do lead (nome, WhatsApp, e-mail) nunca entra no git nem na trilha.** Um arquivo por lead
em `contato/leads/<conversation_id>.json` (`.gitignore`, volume próprio no `docker-compose.yml`),
lido só pela Fila humana — dado operacional que o corretor precisa ver de verdade, dono diferente do
histórico/trilha (LEI 11). Decisão e alternativas descartadas em
[`docs/PRIVACIDADE.md`](docs/PRIVACIDADE.md#contato-do-lead-fora-do-git-nunca-na-trilha-issue-46-adr-0005)
e [ADR-0005](governance/adr/0005-chat-guiado-estado-e-contato.md). Desde a issue #51 (parte 2), a
trilha por mensagem do chat (`POST /api/chat/mensagem`) troca nome/WhatsApp/e-mail por
`[contato registrado fora da trilha]` no servidor, incondicional ao texto recebido — a decisão de
privacidade é sempre do backend, nunca do JavaScript da tela.

**Duas ressalvas não bloqueantes do veredito de auditoria do PR #76, declaradas aqui de propósito:**
(1) o que conta como "campo de contato" vem do nome do campo que o cliente HTTP manda
(`campo=nome`/`whatsapp`/`email`) — um cliente que mandasse um nome com outro nome de campo
gravaria o valor real, e o redator de PII não reconhece nome próprio fora da lista conhecida; o
fluxo guiado do próprio chat nunca faz isso, é um limite de uma rota sem autenticação
([§10](#10-limites-conhecidos)); (2) nos 3 campos de contato, a **pergunta** também vira o
marcador — a trilha perde o texto literal da pergunta ("qual é o seu nome completo?"), mantendo só
o par com `id` e a ordem.

**Gap declarado, ainda sem conserto:** quando a coleta por texto livre está ligada
([§1](#1-em-uma-frase-e-como-rodar)), o CEP é extraído do texto **bruto** antes do mascaramento e
enviado à `/quote` (a API precisa dele) — mas o restante da mensagem do lead viaja mascarado até o
OpenRouter, um provedor externo. A política de retenção de dados do roteamento do OpenRouter para o
modelo escolhido é uma pendência aberta na própria decisão, não uma afirmação de que está resolvida
([`governance/adr/0003-provedor-e-modelo-do-llm.md`](governance/adr/0003-provedor-e-modelo-do-llm.md));
`docs/PRIVACIDADE.md` ainda não tem uma seção sobre isso.

---

## 7. Qualidade: outro engenheiro entende as decisões?

Quatro camadas com fronteira cobrada por ferramenta, não por convenção verbal — `.importlinter`
(raiz do repo) tem 3 contratos: `dominio` não importa `aplicacao`/`infra`/`interfaces`, `infra` não
importa `interfaces`, e `aplicacao` não importa `infra`/`interfaces` (o 3º entrou depois — uma
auditoria de arquitetura achou que `aplicacao/CONTRACT.md` já AFIRMAVA essa regra havia tempo, mas
nada no CI cobrava de verdade); roda no CI. Cada camada tem `CONTRACT.md` próprio com as invariantes
e o teste que cobre cada uma (ex.: `src/infra/CONTRACT.md`, `src/dominio/CONTRACT.md`).

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
primeiro commit. O texto completo do processo está nas issues e nos `ai-logs/` —
`[PENDENTE: exportação no congelamento, #15]` (as sessões do Claude Code continuam crescendo até a
entrega; exportar e sanitizar é o último passo, não antes). O exportador
(`scripts/sanitizar_ai_logs.py`) tem uma verificação final que recusa gravar qualquer arquivo se
sobrar um padrão pessoal do dono (em chave OU em valor do JSON) — a lista de padrões mora fora do
git, criada pelo dono, e a ausência do arquivo é erro, nunca "segue sem checar". Aqui vai a lista
dos erros que viraram melhoria, porque mostrar o erro com o conserto ao lado é mais honesto do que
fingir que não aconteceu:

- **Vazamento de dado pessoal pego pela auditoria, não pelo autor**
  ([#17](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/17)): o `esteira.json`
  gravava o nome real do dono do projeto dentro de um campo marcado "privado" — commitado no fork
  público. A auditoria fria reprovou a frente por isso; o campo saiu do arquivo e o nome saiu do
  histórico visível.
- **Uma regra de segurança foi corrigida duas vezes, a segunda vez pela própria frente que a
  escreveu**
  ([comentário de coordenação](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/16#issuecomment-5646987147)):
  a narrativa original dizia que a flag `(?i)` protegia CPF/CEP contra vazamento por case; medição
  provou o contrário (CPF/CEP são só dígitos — não têm maiúscula). A própria frente refutou a própria
  alegação antes de fechar, e derrubou de quebra um roteiro de prova que a coordenação tinha aprovado
  em cima da narrativa errada.
- **Um documento de leis existiu, mas não chegou a ninguém**
  ([comentário de coordenação](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/16#issuecomment-5648026423)):
  `docs/LEIS-DO-PROJETO.md` foi escrito para ser o lugar onde toda frente lê as regras do dono — e
  ficou em dois commits locais da árvore de integração, nunca enviados ao repositório remoto. As seis
  frentes abertas naquele dia trabalharam sem ele. O erro não era o conteúdo; era o lugar onde ele
  estava.
- **O auditor externo (Codex) acertou duas previsões antes de qualquer código existir, e a
  coordenação demorou a agir**
  ([comentário de coordenação](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/16#issuecomment-5648318582),
  parecer original em `ai-logs/codex/`): numa auditoria adversarial do roadmap, antes da primeira
  linha de implementação, o parecer registrado dizia que a governança podia consumir mais prazo que o
  produto, e que a entrega dependia de uma frente marcada como opcional. As duas se confirmaram: ao
  meio-dia de 12/09 a `main` tinha 17 linhas de produto e uma frente de governança inteira fechada, e
  foi preciso cortar rito às pressas; e o painel de rastreio — marcado "se sobrar tempo" — acabou
  sendo a peça que a especificação do mock amarrava à trilha real, ou seja, nunca foi de fato
  opcional.

---

## 9. O que ficou de fora, e por quê

Escopo cortado por prazo, sempre com issue aberta e razão declarada — nada sumiu em silêncio. Estado
medido contra `main` e os PRs abertos no momento em que este README foi escrito (13/09), não por
resumo — o que já tem PR pronto (mesmo sem merge) diz isso; o resto é `[PENDENTE: #n]` porque ainda
não tem:

| Ficou de fora | Estado | Issue |
|---|---|---|
| Tela Relatório (`src/interfaces/painel/tela_relatorio.py`, CSV com telefone/histórico) existe mas não tem menu nem rota — `interfaces.painel.gerar`/`layout` não a referenciam ainda, então não é alcançável pela navegação | `[PENDENTE: #59]` — PR 1/2 mergeado (a tela), PR 2/2 (menu + `gerar.py`) ainda não | [#59](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/59) |
| Coleta pelo **chat web** não grava pergunta/resposta na trilha com id e status (a coleta pela CLI já grava — [§5](#5-dá-pra-rastrear-o-que-aconteceu), PR #64) | `[PENDENTE: #51]` — parte 2 (chat web), sem PR ainda | [#51](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/51) |
| Status/estado da conversa na Fila humana, além do motivo do handoff (o motivo em si já está resolvido — ver [§4](#4-o-critério-de-passar-pra-humano-é-explícito-e-defensável), `LEAD_PEDIU_HUMANO`) | `[PENDENTE: #57]` — issue #57 segue aberta para essa parte | [#57](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/57) |
| Bateria adversarial completa (infra, integridade, dados sujos, injeção, mídia) | fora por prazo, sem PR | [#10](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/10) |
| Webhook estilo WhatsApp | fora do caminho crítico do desafio | [#12](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/12) |
| Disjuntor, cache e concorrência por medição | resiliência extra além do que a `/quote` exige hoje | [#14](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/14) |
| Especificação formal das 6 telas do mock (inclusive "Avaliação") | mock ficou de design, sem contrato tela↔trilha ainda | [#26](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/26) |
| Dataset em camadas (Silver mascarado) — o `dataset/conversations.parquet` original não é reprocessado nem versionado de novo; o que este repositório usa dele são só medições agregadas (ex. as tabelas do ADR-0002), com qualquer PII mascarada pelo `redigir_texto` na leitura, nunca uma cópia derivada commitada | além do escopo do agente em si | [#11](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/11) |
| Lentidão da `/quote` acima da taxa configurada **sob chamadas em paralelo** (em série, a taxa medida bate com a configuração — [§3](#3-o-que-ele-faz-quando-a-quote-falha-o-ponto-que-mais-separa-diz-o-enunciado)) | investigado, sem conserto nesta entrega | [#1](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/1) |
| Legibilidade: duas classes chamadas `Decisao` (`dominio/decisao.py` e `dominio/eventos_trilha.py`, esta importada como `DecisaoTrilha`), `conduzir_conversa` com ~80 linhas e 6 responsabilidades, leitura de ambiente espalhada por 4 arquivos | achado de auditoria de arquitetura, classificado como menor — documentado, não escondido | [#49](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/49) |

O guard `plano-na-issue` ficou **vermelho** no PR #35 — troca consciente: essa frente rodou em
"regime enxuto", autorizado explicitamente pelo dono no comentário de escopo, sem a rodada normal de
PLANO antes do código. 28 dos 29 checks daquele PR passaram (o único vermelho foi esse, de propósito).

---

## 10. Limites conhecidos

- **O timeout de 3s por tentativa não é parede dura** (ver [§3](#3-o-que-ele-faz-quando-a-quote-falha-o-ponto-que-mais-separa-diz-o-enunciado)) — 3617ms medidos numa tentativa real. **O orçamento total de 10s é** parede dura, medido em tempo de parede real.
- **O mascaramento de PII não usa NER** — só redige nomes de uma lista conhecida; um nome fora dela passa intacto (`docs/PRIVACIDADE.md`).
- **Sem projeto Python instalável** (sem `pip install -e .`) — decisão deliberadamente adiada (nota R9/#16); por isso rodar exige `PYTHONPATH=src`, documentado no comando acima.
- **`.arch-layers.json` não existe** — a fronteira de camadas é cobrada de verdade pelo `.importlinter` no CI, mas o guard `docs-required` do kit ainda não confere essa fronteira automaticamente (nota registrada no `CHANGELOG.md`).
- **Menor de 18 anos: a recusa é só do lado do cliente.** `src/interfaces/chat/_corpo.html:288`
  (`if (n < 18) return menorDeIdade();`) bloqueia na tela, com mensagem acolhedora — mas nem
  `dominio.validacao` nem `aplicacao.servico_conversa` repetem a regra no servidor. Um
  `POST /api/chat/cotar` direto, fora da tela, com `idade < 18`, não é recusado por essa camada —
  limite declarado pelo próprio PR #62 (LEI 9 — sinalizar, não consertar de passagem).
- **As rotas de operação não têm autenticação nenhuma, na mesma porta do chat.** `/painel/`,
  `/conhecimento` e `/api/configuracao-comercial` respondem pra qualquer um em `:8080`, sem login,
  sem token — `src/interfaces/servidor.py` não tem nenhuma checagem de `Authorization`/senha/token
  em lugar nenhum (conferido: zero ocorrências dessas palavras no arquivo inteiro). Aceitável para
  uma demonstração local; um deploy real precisaria de autenticação nessas três rotas antes de
  qualquer outra coisa.
- **O servidor atende uma requisição HTTP por vez.** `wsgiref.simple_server` (stdlib, decisão do
  ADR-0004 — zero dependência nova) é single-threaded por padrão; duas pessoas cotando ao mesmo
  tempo esperam uma pela outra. Sem medição de quanto isso custa em latência sob carga — não é o
  cenário desta entrega (`src/interfaces/servidor.py:1`, `make_server` em
  `src/interfaces/servidor.py:573`).
- **Estado da conversa em memória, sem expiração.** `_ESTADOS_EM_MEMORIA`
  (`src/interfaces/servidor.py:91`) é um `dict` a nível de módulo — perdido se o processo reiniciar,
  e nunca limpo (uma conversa abandonada fica ocupando memória para sempre). Limite aceito e
  declarado no [ADR-0005](governance/adr/0005-chat-guiado-estado-e-contato.md), decisão 1 — troca
  deliberada por não adicionar Redis/sessão em arquivo fora do prazo.
- **A IA que responde objeção de preço tem 3 limites conhecidos, medidos com o LLM real** (issue
  #58/#70/#78, PR #75/#77/#82 — ver [§1](#1-em-uma-frase-e-como-rodar)):
  - **Latência de 6,4s a 13,6s por resposta**, medida turno a turno (`deepseek/deepseek-chat-v3.1`,
    3 chamadas reais) — bem acima da extração de intenção isolada (~4,2s, ver acima). Sem cache nem
    streaming; o lead vê "Só um instante…" até 13,6s numa conversa real
    ([issue #78](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/78)).
  - **Intermitência medida no reconhecimento de "quero falar com um humano":** numa bateria de 4
    execuções da mesma frase ("pode me passar pra uma pessoa de verdade?"), 1 delas voltou sem
    intenção nenhuma (o modelo não classificou) — o lead recebe "Não entendi — pode reformular?" em
    vez do encaminhamento; nas outras 3 (e nas duas variações testadas junto, 3/3 cada), classificou
    certo. Não é falso positivo (não vira outra intenção, nem objeção) — é o modelo às vezes não
    responder no formato esperado. Sem apuração de taxa em volume maior; sem issue dedicada ainda —
    fonte: [auditoria do PR #82](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/82#issuecomment-5657685213).
  - **`conhecimento/objecoes/` agora tem as 4 fichas de preço aprovadas pelo dono**, publicadas
    pela API (PR #77, commit `071f0e1`), e as 4 já são reconhecidas pelo prompt de extração v3
    (`caro-com-carencia` incluída, corrigida pela #78/PR #82) — não fica mais vazio, nem com uma
    ficha inacessível, num clone limpo. Continua sem ficha de nenhum outro tipo de
    objeção/pergunta de produto (guincho, carro reserva...), fora do escopo aprovado da #70.
- **No Windows, `/quote` recusando conexão em `localhost` pode virar `timeout` em vez de
  `indisponivel` na trilha** — a recusa de conexão às vezes passa dos 3s do orçamento por
  tentativa, e o árbitro de prazo (`_chamar_com_prazo_de_parede`,
  `src/infra/cliente_quote.py:163-181`) dispara antes da tentativa terminar. O texto ao lead é
  idêntico nos dois casos, mas o diagnóstico operacional (`reason_code`) fica errado — afeta
  qualquer chamada à `/quote`, não só a IA de objeção
  ([issue #79](https://github.com/guesttobuy-code/namastex-fde-challenge/issues/79)), enquanto não
  mergear.
- **A extração por texto livre já foi medida contra o modelo real, não simulada:** PR #44,
  intenção "quero contratar" — antes do conserto do esquema, **0 de 5** frases explícitas chegavam à
  política; depois, **5 de 5** positivas e **0 de 7** falsos positivos num controle negativo
  ([comentário de auditoria](https://github.com/guesttobuy-code/namastex-fde-challenge/pull/44#issuecomment-5650702038)).
  Extração de campos (idade/ano do veículo): issue #9, **2 de 4** respostas fugiam do esquema antes
  do conserto, **20 de 20** depois, ~US$ 0,001 por lote de 10 chamadas reais.

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
