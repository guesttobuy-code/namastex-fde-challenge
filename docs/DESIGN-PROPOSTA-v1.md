# Proposta de solução v1 — agente de cotação AutoSeguro (pacote para auditoria externa)

> **Para quem lê:** este documento é **autossuficiente**. Foi escrito para ser auditado por alguém
> (ou por outra IA) sem acesso a esta máquina, ao repositório ou ao histórico da conversa.
> **Status:** proposta NÃO aprovada. Nenhuma linha de código do agente foi escrita.
> **Data:** 2026-09-11. **Autor:** Claude (Opus 5), como arquiteta, junto com Rafael (dono).

---

## 1. O problema, nas palavras de quem propôs

Desafio take-home para vaga de **Forward Deployed Engineer / AI Engineer** na Namastex.
Enunciado em `README.md` do repositório `namastexlabs/namastex-fde-challenge`.

Construir um **agente** para a seguradora fictícia AutoSeguro que, no WhatsApp:
1. conversa com o lead, **qualifica** e **cota** um plano usando a API de cotação fornecida;
2. **decide** quando resolve sozinho e quando passa para um humano;
3. **não trava nem inventa preço** quando a infraestrutura falha.

Prazo: ~3 dias. Uso de IA para construir é esperado e **as conversas com IA fazem parte da entrega**.

## 2. Requisitos explícitos (cada um rastreável ao enunciado)

| # | Requisito | Fonte (linha do README) |
|---|---|---|
| R1 | Agente ponta a ponta: conversa → qualifica → cota → decide (resolve ou encaminha, com critério claro) | 70-71 |
| R2 | Repositório público no GitHub com o código | 72 |
| R3 | README explicando como rodar **e as decisões tomadas, com o porquê** | 73 |
| R4 | **Log de uma execução completa** (conversa do início ao fim, com a cotação saindo) | 74 |
| R5 | **Conversas com IA exportadas no repo**, em `ai-logs/` | 75, 82-110 |
| R6 | Não travar nem inventar preço quando a infra falha | 24, 62-64 |
| R7 | Critério de passagem para humano **explícito e defensável** | 119 |
| R8 | Rastreabilidade: **cada mensagem/cotação com id e status** | 120 |
| R9 | Cuidado com dados sensíveis (o histórico tem PII) | 121 |
| R10 | Qualidade: outro engenheiro entende o código e as decisões | 122 |
| R11 | Avisar ao começar; haverá conversa de feedback após a entrega | 133 |

Critério declarado de avaliação (linhas 113-125), na ordem em que aparece: funciona ponta a ponta ·
**o que faz quando a `/quote` falha (“o ponto que mais separa”)** · critério de humano · rastreabilidade ·
dados sensíveis · qualidade · como a IA foi usada. O enunciado diz explicitamente que **não existe
“formato de saída certo”** — a decisão de engenharia é do candidato (linha 125).

## 3. Requisitos implícitos (não estão no enunciado; foram medidos nos artefatos)

| # | Implícito | Onde apareceu |
|---|---|---|
| I1 | Arquitetura de dados em camadas, com **mascaramento na camada Silver** | `scripts/generate_dataset.py:10` — “o candidato deve mascará-los na camada Silver” |
| I2 | “Há regras que só se aplicam em casos específicos” — carência de 30 dias (roubo/furto) e pró-rata do 1º mês | `quote-service/data/plans.json:2,46-54` |
| I3 | Tratar dado sintético **como se fosse sensível** | `dataset/DICIONARIO.md:3-6` |
| I4 | Mídia sem transcrição (áudio/imagem/documento) precisa de tratamento | `DICIONARIO.md:29`; 56,8% das conversas têm mídia |
| I5 | Texto livre não normalizado (“e um Sandero 2022”) | `DICIONARIO.md:30` |

## 4. Medições — o que foi executado, com saída colada

Ambiente: Docker Desktop 29.4.3, container `namastex-fde-challenge-quote-api-1` (projeto compose isolado),
configuração padrão do `docker-compose.yml` (`QUOTE_FAILURE_RATE=0.20`, `QUOTE_SLOW_RATE=0.10`,
`QUOTE_SLOW_SECONDS=8`), sem `QUOTE_SEED`.

### 4.1 Comportamento sob carga

```
PARALELO (200 chamadas, 20 simultâneas)
status: {200: 162, 500: 12, 502: 11, 503: 15}
latencia s: min 0.01  p50 0.06  p90 8.02  max 8.18
lentas (>=7s): 31 | todas as lentas deram 200? True

SERIAL (150 chamadas)
status={200: 121, 500: 7, 502: 9, 503: 13} lentas=12 (8.0%) lentas_200=12 falhas_5xx=19.3%
```

Leitura: em série o serviço bate a configuração (19,3% de 5xx ≈ 20%; 8,0% de lentas ≈ 10%). Em paralelo,
**15,5% de lentas** — 2,6 desvios acima do esperado. Hipótese (não provada): enfileiramento atrás das
chamadas em `sleep(8)`. Registrada como achado aberto, com experimento declarado.

### 4.2 Contrato real da `/quote` (19 casos determinísticos)

| Caso | Resultado medido | Consequência de projeto |
|---|---|---|
| exemplo do README | 200, prêmio 209.90, pró-rata 115.11 (17/31 dias) | — |
| idade 80 | **422** `{"error":"cotacao_recusada","motivo":"Idade acima do limite (75)"}` | recusa de negócio: não repetir |
| `veiculo_ano` 1940 | **422** `{"detail":[{"type":"greater_than_equal",...}]}` | **422 tem DOIS formatos**: distinguir pelo corpo |
| idade 17 | 422 “Idade fora das faixas aceitas” (motivo genérico) | mensagem ao lead precisa ser nossa |
| carro 2005 / 2006 | 422 recusado / 200 com multiplicador 1.45 | fronteira exata: 20 anos |
| **ano-modelo 2027** | **422** “Idade do veículo fora das faixas” | no Brasil 2026/2027 é comum; virar handoff, não erro cru |
| **sem CEP** | **200**, região 1.0 → **preço até 30% menor, em silêncio** | CEP é obrigatório na qualificação |
| CEP inválido (“abc”) | 200, região 1.0 (sem erro) | validar CEP antes de enviar |
| **sem `plano_id`** | 200 como “essencial”, calado | plano sempre explícito |
| `plano_id` “PREMIUM” | 200 (case-insensitive) | — |
| `data_inicio` dia 1 | 200 **sem** bloco de pró-rata | a ausência do bloco é informação |
| `data_inicio` no passado | 200, pró-rata calculada | validar data antes de enviar |
| `data_inicio` “15/07/2026” | **400** `payload_invalido` | normalizar data (formato BR é o que o lead escreve) |
| idade como string “35” | 200 (coerção do Pydantic) | — |

Outros fatos: `/health` é **sempre** estável (não serve de sonda para a `/quote`); a resposta **não traz
id de cotação** (a rastreabilidade é responsabilidade nossa); o sorteio de falha ocorre **antes** da
validação (uma chamada inválida pode responder 5xx e só revelar o 422 na tentativa seguinte).

### 4.3 Dataset (`dataset/conversations.parquet`)

26.470 mensagens em 2.500 conversas (8 a 14 por conversa, mediana 11); janela 2026-01-01 a 2026-05-28;
zero nulos. Desfechos: em_negociação 30,3% · ganho 28,5% · perdido 21,5% · sem_resposta 19,7%.

| Achado medido | Número | Impacto |
|---|---|---|
| Leads com idade > 75 (a API recusa) | 280 (11,2%) | caminho de recusa é comum, não exceção |
| Carros com ano < 2006 (a API recusa) | 531 (21,2%) | idem |
| CEP de alto risco (agravo ×1,30) | 895 (35,8%) | CEP muda muito o preço |
| Conversas com timestamp fora de ordem | 2.495 (99,8%) | **ordenar só por `message_index`** |
| Conversas com mídia sem transcrição | 1.420 (56,8%) | política de handoff precisa cobrir |
| PII no texto livre | CPF e CEP em 100%; e-mail/telefone em 55,2%; placa (Mercosul) em 33,6% | redator de PII obrigatório |

**Dois avisos importantes sobre o dataset:** (a) o preço que o vendedor oferece é **sorteado** entre 8
valores fixos e não segue a tabela — exemplo real: conversa `conv_00000` (Premium, 35 anos, carro 2008,
CEP de alto risco) recebeu “R$ 219,90”, quando a API devolve **640,71**; (b) o desfecho de cada conversa é
sorteado com pesos fixos, **sem correlação** com idade, veículo ou vendedor. Conclusão: o histórico serve
para aprender **tom, objeções e formato**, e para **testar**; não serve como verdade de preço nem como
sinal preditivo de venda.

## 5. Arquitetura proposta

### 5.1 Princípio que organiza tudo: preço não se escreve, se prova

O enunciado proíbe “inventar preço”. A proposta trata isso como **tipo**, não como instrução:

- existe `PrecoCotado`, e ele **só é construído a partir de uma resposta 200 da `/quote`**, carregando
  `quote_attempt_id`, os multiplicadores devolvidos e o instante;
- o redator de mensagens **só aceita `PrecoCotado`**;
- se a cotação falhou, **não existe objeto de preço** para inserir na frase.

Isto é impedir por construção, em vez de detectar depois. Um LLM alucinando, ou um bug futuro, não
conseguem produzir um preço válido no texto.

### 5.2 Camadas e cápsulas

Layout `src/modules/<X>/{domain,application,infrastructure,interfaces}`, cada módulo com `CONTRACT.md`
(invariantes, cada uma com o teste que a cobre) e barrel único de importação.

Direção de dependência: `interfaces → application → domain`; `infrastructure` implementa portas que
`application` declara; `domain` não importa nada de fora.

| Módulo | Responsabilidade única |
|---|---|
| `conversa` | máquina de estados da qualificação, o que falta perguntar, objeções |
| `cotacao` | validações pré-voo, `PrecoCotado`, caso de uso `CotarPlano`, porta `PortalDeCotacao` |
| `handoff` | política de encaminhamento (regras nomeadas), caso de uso `EncaminharParaHumano` |
| `privacidade` | detecção e mascaramento de PII (usado por log, armazenamento e pipeline) |
| `rastreio` | eventos de mensagem e de tentativa de cotação; trilha append-only |
| `dados` | pipeline bronze → silver (mascarado) → gold do histórico; base da avaliação |

Portas: `PortalDeCotacao`, `PortalDeLinguagem`, `Relogio`, `RepositorioDeConversa`, `FilaDeHandoff`,
`CanalDeMensagem`. Cada uma com adaptador real e dublê determinístico para teste.

> **Nota (2026-09-13, issue #56):** esta seção foi superada pelo roadmap #3 §4 — a arquitetura
> vigente é 4 camadas planas por tipo (`interfaces/aplicacao/dominio/infra`), não módulos por
> domínio (`conversa`, `cotacao`, `handoff`, `privacidade`, `rastreio`, `dados`). Das portas
> listadas acima, só `PortalDeCotacao` e `PortalDeLinguagem` foram criadas
> (`src/aplicacao/portas/`); `Relogio`, `RepositorioDeConversa`, `FilaDeHandoff` e `CanalDeMensagem`
> ficam como simplificação declarada — não são pendência escondida. Ver `dominio/CONTRACT.md`,
> seção F13/#43, para a alternativa mínima adotada no lugar de `Relogio` (parâmetro `instante` +
> relógio injetável na aplicação, sem porta formal).

### 5.3 Política de resiliência (derivada das medições da §4.1/4.2)

| Decisão | Valor | Por que exatamente isso |
|---|---|---|
| timeout por tentativa | **10 s** | a chamada lenta dorme 8 s e **responde 200** (p90 = 8,02 s; máx 8,18 s). Timeout menor descarta cotação boa |
| tentativas | até 3, espera exponencial com jitter | 5xx medido em ~19% das chamadas; 3 tentativas levam a probabilidade de falha total a ~0,7% |
| o que **nunca** é repetido | 422 (ambos os formatos) e 400 | recusa de negócio e payload inválido não melhoram com repetição |
| disjuntor | abre após N falhas seguidas, meio-aberto depois de X s | evita martelar um legado já caído |
| limite de concorrência | sim | hipótese medida de enfileiramento sob paralelismo |
| fila de retomada | sim | esgotadas as tentativas: “te retorno em instantes”, retoma sozinho |
| idempotência | `quote_attempt_id` nosso | a API não devolve id; a trilha precisa de um |
| cache | cotação idêntica por 15 min | evita repetir chamada no mesmo diálogo |

### 5.4 Política de handoff (explícita e testada)

Cada regra tem id, gatilho observável, evidência registrada e teste próprio. **Implementado** (issue
#42, decisão do dono):
- **falha persistente da cotação** (`quote_indisponivel`/`quote_timeout`/`quote_erro_de_payload`) —
  desde a F2/#5;
- **recusa da seguradora (422 de negócio)** — configurável por `ConfiguracaoComercial.encaminhar_lead_fora_do_padrao`
  (padrão ligado): encaminha para um corretor explicando o motivo, ou encerra com educação. Medido
  contra os 4 motivos reais da `/quote` (testes de `aplicacao/servico_conversa`).
- **"quero contratar"** — vira `MotivoHandoff.LEAD_QUER_CONTRATAR`, encaminhado para a Fila humana
  (o fechamento é feito por um corretor). Testado no domínio e na aplicação; o esquema do adaptador
  OpenRouter restringe `intent` a `dominio.intencao.Intencao` (achado da auditoria do PR #44: string
  livre fazia o modelo inventar grafias que nunca chegavam à política). **Prova ao vivo contra o
  modelo real (`OPENROUTER_API_KEY`) ainda não foi rodada nesta worktree** — pendente.

**Ainda pendente de decisão do dono, em fatias** (não implementado, para não prometer o que o
código não faz): pedido explícito de humano · mídia sem transcrição (57% do histórico) · pedido de
desconto/negociação (depende do campo "tentativas antes do corretor", F13/#43) · menção a sinistro
ou urgência · dado impossível ou inconsistente · assunto fora de escopo · frustração ou repetição
do lead.

O agente **não promete** boleto nem apólice — no histórico, o vendedor humano promete; aqui isso é handoff.

### 5.5 Privacidade

Minimização: **não pedimos CPF** (a `/quote` não usa CPF; o vendedor do histórico pede). Mascaramento na
fronteira: todo log e toda linha armazenada passam pelo redator. Pipeline do dataset só é consumido a
partir da camada Silver, já mascarada. Detectores cobrem os formatos medidos, inclusive placa Mercosul e
texto com `cpf`/`cep` em minúsculas (o gerador aplica `.capitalize()`).

### 5.6 Interfaces (decisão do dono, 2026-09-11)

Conversa no terminal · webhook estilo WhatsApp · **painel de rastreio** que mostra, por conversa, cada
mensagem e cada tentativa de cotação com id, status, latência e o motivo da decisão.

### 5.7 LLM

`PortalDeLinguagem` com dois adaptadores: **determinístico** (regex + repertório; roda sem chave e é o
que os testes usam) e **Claude**. O LLM **extrai e redige**; **nunca decide** preço, recusa ou handoff.
Custos oficiais (tabela Anthropic, cache 2026-06-24): Haiku 4.5 US$ 1/US$ 5 por milhão de tokens
(entrada/saída); Sonnet 5 US$ 2/US$ 10. Estimativa: conversa de ~12 turnos custa ~US$ 0,03 (Haiku) a
~US$ 0,07 (Sonnet). OpenRouter repassa o preço do provedor sem markup de inferência, cobrando
5,5% na compra de créditos (mínimo US$ 0,80) — ou seja, ~5,5% mais caro, em troca de multi-provedor.

## 6. Estratégia de teste e de melhoria

1. **Domínio puro** — máquina de estados, política de handoff, redator de PII, validações pré-voo.
2. **Contrato por módulo** — cada invariante do `CONTRACT.md` com o teste que fica vermelho se ela quebrar.
3. **Integração com dublê** — reproduz exatamente o medido: 500/502/503, lenta de 8 s, os dois 422, o 400.
4. **Ponta a ponta e avaliação** — conversas sintéticas derivadas da camada Silver (incluindo os 531 carros
   recusados e os 280 leads acima de 75), mais um teste contra o serviço real com `QUOTE_SEED` fixo.

**Melhoria com catraca:** o nível 4 emite métricas — cotações concluídas, handoff correto, chamadas por
cotação, p95, e o número que **nunca** pode subir de zero: preço citado sem `quote_attempt_id`
correspondente. Piorou em relação à régua anterior, o teste fica vermelho.

## 7. Qualidade de código: a rede que cobra

O projeto roda a rede de guards do kit no pre-commit. **Oito guards de arquitetura não leem Python** e
respondem “não aplicável”. Para não ficar verde vazio, a proposta recoloca máquina, com prova executada:

| Buraco | Substituto | Prova |
|---|---|---|
| erro engolido | `ruff` E722, BLE001, S110 | 7 achados numa fixture proposital |
| erro que vira só log | `ruff` TRY400, TRY300 | idem |
| async solto | `ruff` RUF006, ASYNC110 | idem |
| dívida sem issue | `ruff` TD003, FIX002 | idem |
| fronteira de camadas | `import-linter` 2.15 | contrato quebrado detectado |
| lógica duplicada | `pylint` R0801 | clone detectado entre dois módulos |
| teste companheiro | guard próprio (~40 linhas, lê o diff) | a construir |
| impacto entre módulos | **sem cobertura** — declarado, cobrado na auditoria | — |

Como o runner do kit executa `ruff` e `pytest` com a **nossa** configuração, e chamamos `import-linter` e
`pylint` de dentro de testes, tudo isso é cobrado a cada commit sem alterar o kit.

## 8. Plano de execução (uma frente por chat, cada uma com plano, teste e auditoria)

| Frente | Entrega | Depende de |
|---|---|---|
| F1 | `pyproject.toml` + os substitutos da §7 | — |
| F2 | núcleo do domínio (qualificação, `PrecoCotado`, política de handoff), sem IO | F1 |
| F3 | cliente resiliente da `/quote` + dublê de falhas | F2 |
| F4 | rastreio e privacidade | F2 |
| F5 | interfaces (terminal, webhook, painel) | F3, F4 |
| F6 | pipeline do dataset + medidor com catraca | F4 |
| F7 | README com decisões, log de execução, `ai-logs/` | todas |

## 9. Riscos assumidos e decisões em aberto

1. **Prazo × escopo** — o que se protege se o tempo apertar ainda não foi decidido (issue #2 do fork).
2. **Hipótese de enfileiramento** sob concorrência: não provada; experimento declarado.
3. **`cross-module-impact` sem máquina** — depende de revisão humana.
4. **Provedor de LLM** — Anthropic direto ou OpenRouter; números na §5.7, decisão pendente.
5. **Chave de LLM** ausente na máquina até agora; o caminho determinístico cobre a demonstração.

## 10. Perguntas que peço ao auditor para tentar derrubar

1. O tipo `PrecoCotado` realmente impede preço inventado, ou há caminho (serialização, cache, template,
   log, resumo do LLM) em que um número vira texto sem passar por ele?
2. O timeout de 10 s é defensável, ou a espera de 8 s deveria virar resposta assíncrona ao lead?
3. A política de handoff tem buraco? Que situação real do WhatsApp não está nas 10 regras?
4. Seis módulos e quatro camadas são excesso de estrutura para 3 dias? O que você cortaria primeiro —
   e o que isso quebra na avaliação do desafio?
5. A estratégia de teste prova o que diz provar, ou há teste que nasceria verde?
6. Que requisito do enunciado (§2) está sem par na arquitetura (§5) ou no plano (§8)?
7. O que um avaliador sênior de FDE olharia primeiro e não encontraria aqui?
