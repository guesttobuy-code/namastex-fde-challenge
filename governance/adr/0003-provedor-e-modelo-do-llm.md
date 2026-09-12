# ADR-0003 — Provedor e modelo do LLM

- **Status:** aceita
- **Data:** 2026-09-12
- **Issue/PR:** #9

## Contexto

A F6/#9 precisa de um `PortalDeLinguagem` para entender texto livre do lead. O escopo original
(comentário de abertura da #9) pedia Anthropic direto, SDK oficial, modelo Claude Haiku 4.5. Ainda
no mesmo dia, o dono mudou de ideia (emenda ao escopo, 12/09 fim de tarde): a API da Anthropic tem
custo e não faz sentido gastar agora; ele já tinha ~US$ 5 de crédito no OpenRouter e queria
verificar se um modelo gratuito (NVIDIA) resolvia. A coordenação mediu com a chave real do dono,
para a frente não gastar tempo do prazo de corte (13/09, 14h) nisso.

## Decisão

**Provedor: OpenRouter** (compatível com formato OpenAI), não Anthropic direto — decisão do dono.
**Sem SDK**: chamada HTTP crua via `urllib.request` (stdlib), mesmo padrão de
`infra/cliente_quote.py` — nenhuma dependência de runtime nova no `pyproject.toml`.

**Modelo padrão: `deepseek/deepseek-chat-v3.1`**, id da lista pública do OpenRouter em 12/09/2026.
Medição da coordenação, mesma tarefa em todas as chamadas (extrair `{idade, veiculo_ano}` de "oi,
tenho 30 anos e meu carro é um Sandero 2022", `urllib` com timeout explícito, custo do campo
`usage.cost` da resposta):

| Modelo | Latência | Resultado | Custo por chamada |
|---|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b:free` | timeout a 45s e a 90s | — | — |
| `nvidia/nemotron-3.5-lightning:free` | timeout a 90s | — | — |
| `deepseek/deepseek-chat-v3.1` | 4.199 ms | JSON correto | US$ 0,0000415 |
| `deepseek/deepseek-v3.1-terminus` | 3.712 ms | JSON correto | US$ 0,0000335 |
| `mistralai/mistral-nemo` | 6.248 / 2.472 / 2.612 ms | JSON correto (3/3) | US$ 0,0000017 |

Os dois modelos gratuitos da NVIDIA foram **descartados**: 3 timeouts em 3 chamadas não é
intermitência, é indisponibilidade para um agente de conversa. `deepseek/deepseek-chat-v3.1` foi
escolhido (indicado pelo dono, "funciona bem para chat") em vez do mais barato/rápido
(`mistral-nemo`) porque o custo não decide aqui: uma conversa de ~12 turnos fica perto de
US$ 0,0005, e o crédito de ~US$ 5 cobre milhares — o que decide é qualidade de redação em
português. `mistral-nemo` fica registrado como **alternativa medida, não implementada** (plano B),
sem cadeia de fallback entre modelos: timeout explícito + validação por esquema já transformam
falha do modelo em pedido de esclarecimento, e é isso que segura a conversa.

O id do modelo fica em configuração (`LLM_MODELO`, padrão em código = `deepseek/deepseek-chat-v3.1`
em `infra.adaptador_de_linguagem.MODELO_PADRAO`), nunca espalhado pelo código. A chave
(`OPENROUTER_API_KEY`) vem só do ambiente, lida dentro da função que faz a chamada — nunca
logada, impressa ou colada em mensagem.

**Provedor selecionável em runtime**: `LLM_PROVEDOR` (padrão `deterministico` — sem chave, sem
rede, é o que a suíte padrão usa). Pedir `openrouter` sem `OPENROUTER_API_KEY` no ambiente **falha
alto** com uma mensagem dizendo o que conferir (nome do arquivo `.env`, nome da variável) — nunca
cai pro determinístico em silêncio. Achado que motivou isso: na primeira tentativa de configurar a
chave, ela "sumiu" por dois erros triviais (arquivo salvo como `.env.txt` pelo Bloco de Notas, e
uma linha sem o nome `OPENROUTER_API_KEY=`) — um carregador ingênuo leria "sem chave" e cairia pro
determinístico parecendo que o LLM estava ligado quando não estava.

**Formato da resposta**: medido ao vivo (coordenação, 12/09) que mesmo com
`response_format={"type": "json_schema", ...}` e o prompt pedindo só JSON, o
`deepseek/deepseek-chat-v3.1` às vezes embrulha a resposta num bloco Markdown (` ```json ... ``` `).
O parser (`infra.adaptador_de_linguagem._sem_cercas_markdown`) tira a cerca antes do `json.loads`;
o que não for JSON válido depois disso vira pedido de esclarecimento, nunca exceção.

**Política de dados do provedor**: o OpenRouter roteia o DeepSeek para provedores com políticas de
retenção que variam por rota. Como já era regra (independente de provedor): só texto MASCARADO sai
da máquina para o modelo, e o CEP nunca sai — extraído localmente, do texto bruto, antes do
mascaramento (ver `dominio.redator_pii.extrair_cep`). Confirmar a política vigente do roteamento
ativo no momento da entrega e registrar aqui é pendência aberta desta ADR (ver Consequências).

## Consequências

- **Melhor:** sem dependência de runtime nova; timeout explícito + validação por esquema tornam
  falha do modelo (timeout, resposta lenta, JSON inválido, campo fora do esquema, até um modelo
  "sequestrado" por injeção de prompt) sempre um pedido de esclarecimento, nunca uma exceção que
  travaria a conversa ou um dado fabricado que passaria por real.
- **Pior/mais caro:** nenhum custo relevante (~US$ 0,0005/conversa); o modelo escolhido não é o
  mais barato disponível — decisão consciente por qualidade de redação, não por preço.
- **Obrigatório:** `LLM_PROVEDOR=openrouter` sem `OPENROUTER_API_KEY` sempre falha alto (nunca
  fallback silencioso); nenhum teste da suíte padrão chama a API real (`pytest -m llm_real`
  explícito, marker em `pyproject.toml`); o CEP nunca atravessa para o portal de linguagem, em
  nenhum dos dois adaptadores.
- **Proibido:** cadeia de fallback entre modelos (`mistral-nemo` fica só documentado, não
  implementado); qualquer chat abrir o `.env` para conferir a chave.
- **Guard que cobra:** nenhum guard mecânico dedicado ainda (LEI 10) — a garantia de hoje é o
  conjunto de testes de `tests/infra/test_adaptador_de_linguagem.py` (seleção de provedor, falha
  alta, injeção, timeout) e `tests/integracao/test_cep_local_antes_do_mascaramento.py`.
- **Pendência aberta:** confirmar e registrar aqui a política de retenção de dados do provedor de
  roteamento ativo para `deepseek/deepseek-chat-v3.1` no OpenRouter, antes do fechamento da frente.

## Alternativas descartadas

- **Anthropic direto (Claude Haiku 4.5), SDK oficial** — escopo original da #9; descartado pelo
  dono horas depois: custo, e ele já tinha crédito no OpenRouter.
- **Modelos gratuitos da NVIDIA no OpenRouter** — 3 timeouts em 3 chamadas medidas (45s/90s);
  indisponibilidade, não intermitência, para um agente de conversa.
- **`deepseek/deepseek-v3.1-terminus`** — latência e custo equivalentes ao escolhido; sem
  diferencial medido que justificasse preferir a variante "terminus".
- **`mistralai/mistral-nemo`** — mais rápido e ~25× mais barato; descartado como padrão (qualidade
  de redação em português não medida contra o `deepseek`) mas mantido como plano B documentado.
- **Cadeia de fallback entre modelos** — descartada de propósito: timeout + validação por esquema
  já cobrem a falha; uma cadeia adicionaria complexidade sem prova de que o problema (indisponibi-
  lidade do gratuito) se repete no modelo pago escolhido.
