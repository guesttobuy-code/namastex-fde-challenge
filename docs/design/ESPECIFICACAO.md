# Especificação das telas — o contrato entre o desenho e o código

> **Por que este documento existe.** Mock sem especificação vira enfeite: o desenho mostra uma coisa, a
> implementação entrega outra, e ninguém percebe porque não havia contrato. Aqui cada campo visível nas telas
> é amarrado a um **evento da trilha** e a uma **frente dona**. O que não estiver nesta tabela **não pode
> aparecer na tela** — e o que estiver aqui e faltar na trilha é defeito da implementação, não da tela.

## Princípio

**A tela não inventa dado, e não calcula regra.** Ela lê a trilha que o agente grava e mostra. Se um campo
aparece no desenho, ou ele existe num evento da trilha, ou ele não existe.

---

## 1. Os eventos da trilha (dono: F4, issue #7)

Arquivo append-only em JSONL. Um evento por linha. Campos comuns a todos:

| Campo | Tipo | Observação |
|---|---|---|
| `evento` | texto | `mensagem_recebida` · `mensagem_enviada` · `tentativa_de_cotacao` · `decisao` · `handoff` · `erro_marcado` · `correcao_registrada` |
| `conversation_id` | texto | agrupa a conversa |
| `id` | texto | id do próprio evento (`msg_06`, `qa_7d31`, `dec_01`, `err_02`) |
| `instante` | ISO 8601 | horário do evento |

### `mensagem_enviada` — o que o agente respondeu

| Campo | Alimenta na tela | Obrigatório |
|---|---|---|
| `texto` | o balão da resposta | sim |
| `decisao_id` | proveniência → **decisão** | sim |
| `regra_aplicada` | proveniência → **regra aplicada** | sim |
| `origem_do_texto` | proveniência → **texto veio de** (`redator_deterministico:<modelo>` ou `llm:<modelo>@<versao_prompt>`) | sim |
| `dados_usados` | proveniência → **dados usados** (lista de referências, ex.: `qa_7d31`, `estado.veiculo_ano`) | sim |
| `quote_attempt_id` | prova do preço; **obrigatório se o texto contém valor monetário** | condicional |

> **Invariante testável:** mensagem cujo texto contenha valor monetário **e** não tenha `quote_attempt_id`
> correspondente a uma cotação com sucesso é erro de sistema, não de conteúdo. É o mesmo teste da F2/F5.

> **Terceira forma de `origem_do_texto` (acréscimo da F3/#6, achado da auditoria do PR #35):** além de
> `redator_deterministico:<modelo>` e `llm:<modelo>@<versao_prompt>`, existe `texto_fixo:<módulo>@<versão>`
> (ex.: `texto_fixo:aplicacao.servico_conversa@v1`) — para texto que não vem de um redator nem de um LLM,
> mas é fixo no código (ex.: pedido de mais dados, aviso de encaminhamento). `<módulo>` é o caminho real
> de onde o texto está escrito, para o dono clicar na mensagem errada no Rastreio e cair no arquivo certo
> — nunca a camada de I/O que só exibe (a CLI, por exemplo, não é dona de nenhum texto fixo).

### `tentativa_de_cotacao` — cada chamada, não cada cotação

`numero_da_tentativa` · `http_status` · `classificacao` (`sucesso` · `recusa_de_negocio` · `erro_de_payload` ·
`indisponivel` · `timeout`) · `latencia_ms` · `orcamento_restante_ms` · `quote_attempt_id`.
Em caso de sucesso: `premio_mensal`, `franquia`, `coberturas`, `multiplicadores`, `carencia`, `pro_rata`.

### `handoff`

`reason_code` (lista fechada, ver tela Regras) · `contexto_coletado` (estado da conversa no momento) ·
`mensagem_ao_lead`.

---

## 2. O laço de correção (dono: F4 grava, F8 consome)

Este é o fluxo que a bandeirinha "⚑ marcar como erro" abre, nas telas **Conversas** e **Rastreio**.

### `erro_marcado`

| Campo | Origem | Observação |
|---|---|---|
| `mensagem_id` | a mensagem marcada | referência ao `mensagem_enviada` |
| `marcado_por` | operador | quem marcou |
| `proveniencia` | **copiada do evento da mensagem**, não recalculada | congela o que era verdade naquele momento |
| `o_que_estava_errado` | texto livre do operador | opcional na marcação |

> **Por que copiar a proveniência em vez de referenciar:** a regra e o prompt mudam com o tempo. Sem congelar,
> daqui a duas semanas a tela mostraria a regra **atual** como causa de um erro que veio da regra **antiga** —
> e a correção seria aplicada no lugar errado.

### `correcao_registrada`

| Campo | Observação |
|---|---|
| `erro_id` | o `erro_marcado` que originou |
| `comportamento_esperado` | texto do operador: **o que o agente deveria ter feito** |
| `alvo` | onde a correção age: `regra_de_decisao` · `texto_do_redator` · `esquema_de_extracao` · `politica_de_handoff` |
| `virou_caso` | booleano |
| `caso_id` | referência ao caso criado no conjunto de avaliação |

### O caso de avaliação (arquivo versionado, dono: F8 / issue #11)

`eval/casos.jsonl`, **versionado no repositório** — é a régua, e régua não pode viver só em memória:

| Campo | Observação |
|---|---|
| `caso_id` | identificador estável |
| `entrada` | as mensagens do lead até o ponto do erro |
| `decisao_esperada` | uma das decisões da lista fechada |
| `texto_proibido` / `texto_exigido` | quando o erro era de conteúdo (ex.: proibido prometer retorno) |
| `origem` | `erro_marcado:<id>` — de onde este caso nasceu |
| `estado` | `a_rotular` · `no_conjunto` · `aposentado` (com motivo) |

**Como a correção muda o comportamento:** ela **não** é injetada como "base de conhecimento" livre — nosso
agente não tem base de conhecimento, e a autoridade de preço e elegibilidade é a `/quote`. A correção age em
um dos quatro alvos acima, todos determinísticos e versionados. O caso de avaliação é o que **impede a
regressão**: se o agente repetir o erro, a régua fica vermelha.

> **Decisão declarada:** não existe aprendizado automático a partir da correção. Um operador marca, um humano
> escreve o comportamento esperado, e o caso entra na régua. É mais lento e é auditável — e, num sistema que
> cota seguro, auditável vence.

---

## 3. Fidelidade: como impedir que a implementação divirja do desenho

Três amarras, em ordem de força:

1. **Esta tabela é o contrato.** Toda frente que grava evento tem, no seu "pronto quando", a linha:
   *os campos que a tela consome existem no evento, com o nome desta especificação.*
2. **Teste de fidelidade (dono: F4, issue #7).** Um teste lê a trilha real produzida por uma execução completa
   e afirma que **todo campo listado aqui existe e está preenchido**. Campo que a tela mostra e a trilha não
   grava reprova o commit — é o que impede o mock virar ficção.
3. **O painel (F10, issue #13) é gerado a partir da trilha real**, nunca de dados de exemplo. No dia em que a
   trilha não tiver um campo, a tela mostra o buraco em vez de esconder.

### O que o mock deliberadamente NÃO promete

- **Botões não funcionam.** "Registrar correção", "Assumir atendimento" e "Tentar cotar de novo" são desenho de
  intenção. Se a implementação não os entregar, o mock precisa ser atualizado para não prometer o que não existe.
- **Números das telas são fictícios**, exceto onde está escrito que vieram de medição (a tabela de retry e a
  cobertura do dataset).
- **Não há autenticação, multiusuário nem tempo real.**

---

## 4. Mapa tela → frente dona

| Tela | Consome | Frente dona |
|---|---|---|
| Conversas | `mensagem_recebida`, `mensagem_enviada`, `decisao` | F5 (#8) · proveniência da F4 (#7) |
| Rastreio | todos os eventos da conversa | F4 (#7) · F10 (#13) |
| Fila humana | `handoff` + `contexto_coletado` | F2 (#5) decide · F4 (#7) grava |
| Cotações | `tentativa_de_cotacao` | F3 (#6) |
| Avaliação | `eval/casos.jsonl` + saída do medidor | F8 (#11) |
| Regras e política | `GET /planos` + política de retry e handoff | F2 (#5) · F3 (#6) |
