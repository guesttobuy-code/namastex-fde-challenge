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
| I-2 | `aplicacao` nunca importa `infra` nem `interfaces` (só declara a porta; quem implementa é `infra`) | `tests/arquitetura/test_fronteiras.py`, contrato `aplicacao-nao-importa-infra-nem-interfaces` no `.importlinter` (achado #50, emenda ao ADR-0001: antes desta linha o contrato citado aqui não existia na máquina) |

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

---

## Seção F13/#43 — `ServicoDeConhecimento` (append, R2/#16)

### O que esta frente é dona de

- `aplicacao.portas.repositorio_conhecimento.RepositorioDeConhecimento` — a porta de persistência
  das fichas de objeção de preço.
- `aplicacao.servico_conhecimento.ServicoDeConhecimento` — caso de uso que lista, lê e salva
  fichas; delega a invariante do marcador para `dominio.ficha_objecao.FichaDeObjecao.publicar`,
  nunca a reimplementa.

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-9 | `ServicoDeConhecimento.salvar_objecao` só chama `FichaDeObjecao.publicar()` (e portanto só valida o marcador) quando `dados["status"] == "publicado"` — salvar rascunho nunca valida | `tests/aplicacao/test_servico_conhecimento.py::test_salvar_rascunho_nunca_valida_marcador` |
| I-10 | Publicação recusada não persiste nada (a porta não é chamada) | `tests/aplicacao/test_servico_conhecimento.py::test_publicar_com_digito_fora_de_marcador_e_recusado_e_nada_e_persistido` |

### Entradas e saídas públicas acrescentadas

- `aplicacao.portas.repositorio_conhecimento.RepositorioDeConhecimento` — `Protocol` com
  `listar_objecoes() -> list[dict]`, `obter_objecao(id: str) -> dict | None`,
  `salvar_objecao(id: str, ficha: dict) -> None`.
- `aplicacao.servico_conhecimento.ServicoDeConhecimento(repositorio, agora: Callable[[], str] = <relógio real>).listar_objecoes() -> list[dict]`,
  `.obter_objecao(id: str) -> dict | None`, `.salvar_objecao(dados: dict) -> dict` (`agora` acrescentado na
  #53 — aditivo, com default de produção; todo chamador existente continua funcionando sem passar o valor).

### O que NÃO é responsabilidade desta seção

- Validar a forma do marcador (`dominio.ficha_objecao`) e persistir de verdade em disco
  (`infra.repositorio_conhecimento_json`) — `aplicacao` só orquestra os dois.
- A "Configuração comercial" (`ConfiguracaoComercial`, `encaminhar_lead_fora_do_padrao`) — fica
  para PR seguinte, depois do merge da #42 (dono do tipo, LEI 11).

### Decisões registradas

- 2026-09-13 — Armazenamento e servidor decididos em ADR-0004 (JSON versionado + `wsgiref` da
  stdlib, sem dependência nova).
- 2026-09-13 — issue #53 (achado #49, decisão da coordenação): `dominio.ficha_objecao.FichaDeObjecao.publicar`
  para de ler `datetime.now` e passa a exigir `instante` como parâmetro; `ServicoDeConhecimento` ganha
  o relógio injetável `agora` e o fornece na chamada. Porta `Relogio` formal (`Protocol` + adaptador)
  fica fora de escopo — ver `dominio/CONTRACT.md`, seção F13/#43.

---

## Seção da issue #42 — `ConfiguracaoComercial` em `conduzir_conversa` (append, R2/#16)

### O que esta frente acrescenta

- `aplicacao.servico_conversa.conduzir_conversa` ganha o parâmetro
  `configuracao: dominio.configuracao_comercial.ConfiguracaoComercial = ConfiguracaoComercial()`
  (aditivo — todo chamador existente continua funcionando sem passar o valor). Esta camada só
  **repassa** o valor a `dominio.politica.decidir`; não lê `conhecimento/` nem decide o padrão —
  isso é da infraestrutura (F13, #43).
- `extrair_dados_da_mensagem` converte a string livre de `SaidaDeLinguagem.intent` (território da
  F6/#9, que não muda) para `dominio.intencao.Intencao` — string desconhecida vira `None`, no
  mesmo padrão de silêncio de campo que `idade`/`veiculo_ano` já usam nesta função.
- `_texto_da_decisao` ganha os textos de `MotivoHandoff.LEAD_QUER_CONTRATAR` e
  `MotivoHandoff.RECUSA_REGRA_DE_ACEITACAO` (o segundo com a tabela de tradução dos motivos
  conhecidos da `/quote`, aprovada pelo dono na issue #42).

### Entradas e saídas públicas alteradas

- `aplicacao.servico_conversa.conduzir_conversa(portal: PortalDeCotacao, estado: EstadoDaConversa, trilha: ServicoDeTrilha | None = None, configuracao: ConfiguracaoComercial = ConfiguracaoComercial()) -> TurnoDaConversa`
  (linha 66 acima documentava a assinatura sem `configuracao` — o parâmetro novo é aditivo, com
  default, então nenhum chamador documentado ali precisa mudar).

### Decisões registradas

- 2026-09-13 — issue #42 (decisão do dono, #41): ver `dominio/CONTRACT.md`, seção "Decisões
  registradas", para o texto completo da decisão de recusa configurável e "quero contratar".

---

## Seção F13/#43 — bloqueantes B2/B4 da auditoria do PR #45 (append, R2/#16)

### O que esta frente acrescenta

- `ServicoDeConhecimento.salvar_objecao` ganha o parâmetro `ids_dos_planos: Iterable[str] = ()`
  (B2): a borda HTTP lê a `/planos` e repassa os ids aqui; o serviço só encaminha para
  `dominio.ficha_objecao.FichaDeObjecao.publicar`, nunca fala com rede.
- `aplicacao.servico_configuracao_comercial.ServicoDeConfiguracaoComercial` (B4): caso de uso que
  lê/grava `dominio.configuracao_comercial.ConfiguracaoComercial` via
  `aplicacao.portas.repositorio_configuracao_comercial.RepositorioDeConfiguracaoComercial` — a
  ligação com o agente (CLI carregando e passando a `conduzir_conversa`) é de `interfaces.cli`,
  documentada no CONTRACT de `interfaces`.

### Entradas e saídas públicas acrescentadas

- `aplicacao.portas.repositorio_configuracao_comercial.RepositorioDeConfiguracaoComercial` —
  `Protocol` com `carregar() -> ConfiguracaoComercial`, `salvar(configuracao) -> None`.
- `aplicacao.servico_configuracao_comercial.ServicoDeConfiguracaoComercial(repositorio).obter() -> ConfiguracaoComercial`,
  `.salvar(*, encaminhar_lead_fora_do_padrao: bool) -> ConfiguracaoComercial`.

### Decisões registradas

- 2026-09-13 — Achados B2 e B4 da auditoria do PR #45 (HEAD `9ee1135`): a premissa "a #42 está
  OPEN" estava vencida (já mergeada em `fabddf1`) e o vocabulário de marcadores era curto demais e
  escrito à mão. Consertado no mesmo push que resolve B1/B3/R1-R5.

---

## Seção da issue #52 — `_texto_da_decisao` traduz o motivo também no ramo ENCERRAR (append)

### O que esta frente acrescenta

- Achado da auditoria de arquitetura (13/09/2026): com `encaminhar_lead_fora_do_padrao=False`, o
  ramo `TipoDecisao.ENCERRAR` de `_texto_da_decisao` devolvia `resultado.motivo` **cru** da
  `/quote`, sem passar pela tabela `_motivo_da_recusa_traduzido` (dono único, já usada no ramo
  `ENCAMINHAR`/`RECUSA_REGRA_DE_ACEITACAO`). Decisão do dono (#41: "explica o motivo e encerra com
  educação") pedia texto traduzido; o ramo simplesmente não usava a tradução que já existia.
- Conserto: `ENCERRAR` passa a chamar a mesma `_motivo_da_recusa_traduzido`, com a frase aceita
  pela coordenação (sem a parte do corretor — config desligada não tem encaminhamento):
  `"Sinto muito, pelas regras da seguradora não consigo cotar online neste caso: {motivo}."`
- Nenhuma segunda tabela de tradução criada (LEI 11) — mesma função, segundo lugar de uso.

### Decisões registradas

- 2026-09-13 — issue #52, frase aceita pela coordenação sobre a Análise de impacto: deriva da
  frase já aprovada pelo dono para `ENCAMINHAR` (#42), sem o trecho de encaminhamento a corretor.

---

## Seção da issue #46 (PR 2 de 2) — `ServicoDeContato` (append, R2/#16)

### O que esta frente é dona de

- `aplicacao.portas.repositorio_contato.RepositorioDeContato` — a porta de persistência do contato
  real do lead (nome, WhatsApp, e-mail), fora do git (ADR-0005).
- `aplicacao.servico_contato.ServicoDeContato` — caso de uso que salva/obtém o contato; delega
  TODA a validação de forma para `dominio.contato_lead.ContatoLead.__post_init__`, nunca a
  reimplementa (LEI 11, mesmo molde de `ServicoDeConhecimento`/`FichaDeObjecao`). **Único caminho**
  de escrita/leitura do contato — nada mais no código chama `infra.repositorio_contato_json`
  direto.

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-11 | `ServicoDeContato.salvar` nunca grava um contato com nome/WhatsApp vazio — o `ValueError` de `ContatoLead` atravessa até quem chamou (a rota HTTP decide o 422, esta camada não engole a exceção) | `tests/aplicacao/test_servico_contato.py` |

### Entradas e saídas públicas acrescentadas

- `aplicacao.portas.repositorio_contato.RepositorioDeContato` — `Protocol` com
  `salvar(conversation_id: str, contato: ContatoLead) -> None` e
  `obter(conversation_id: str) -> ContatoLead | None`.
- `aplicacao.servico_contato.ServicoDeContato(repositorio).salvar(conversation_id, *, nome, whatsapp, email=None) -> ContatoLead`,
  `.obter(conversation_id) -> ContatoLead | None`.

### O que NÃO é responsabilidade desta seção

- Escrever nome/WhatsApp/e-mail na trilha (`aplicacao.servico_conversa`/`ServicoDeTrilha`) —
  `PROIBIDO` por construção: nada nesta seção conhece `EventoTrilha`.
- Decidir QUANDO chamar `salvar` (isso é `interfaces.servidor`, na borda HTTP, assim que o chat
  coleta nome+WhatsApp — antes do fim do fluxo, para o corretor ter o contato mesmo se o lead
  abandonar).

### Decisões registradas

- 2026-09-13 — ADR-0005: contato fora do git, um arquivo por lead — decisão de arquitetura das 3
  tratadas no ADR (estado entre turnos, painel regenerado por evento, contato fora do git).

---

## Seção da issue #57 (P9, PR 1 de 2) — texto de `LEAD_PEDIU_HUMANO` (append)

### O que esta frente acrescenta

- `_texto_da_decisao` (`src/aplicacao/servico_conversa.py`) ganha o `case MotivoHandoff.LEAD_PEDIU_HUMANO`,
  apontando para a MESMA constante de texto que `LEAD_QUER_CONTRATAR` já usava
  (`_TEXTO_ENCAMINHAMENTO_PARA_CORRETOR`, nova, LEI 11 — nunca duas strings iguais copiadas).
- Decisão da coordenação (13/09/2026): texto novo ao lead exigiria aprovação do dono (indisponível
  no momento desta frente) — por isso o mesmo texto já aprovado para "quero contratar" é reusado,
  em vez de uma frase nova sem aprovação.

### O que NÃO é responsabilidade desta seção

- O botão "Falar com um corretor" do chat (`interfaces.chat`, PR #62) continuar chamando
  `LEAD_QUER_CONTRATAR` em vez do motivo novo — troca de rota é do PR 2 desta frente, depois do
  merge do #62 (fronteira registrada na Análise de impacto da #57).

### Decisões registradas

- 2026-09-13 — issue #57 (P9): mesmo texto ao lead de `LEAD_QUER_CONTRATAR`, reason_code próprio
  (`LEAD_PEDIU_HUMANO`) preservado na trilha/evento `handoff` — só o texto visível é compartilhado.

---

## Seção da issue #68 (frente `robustez-quote-entrada`) — CEP normalizado em `montar_estado` (append)

### O que esta frente acrescenta

- `aplicacao.servico_conversa.montar_estado` passa o CEP recebido por `dominio.validacao.
  normalizar_cep` ANTES de gravar em `EstadoDaConversa` e antes de calcular
  `campos_obrigatorios_faltantes` — um CEP sem hífen vira `#####-###` (o único formato que
  `dominio.redator_pii` sabe mascarar); um CEP inválido vira `None`, e `campos_obrigatorios_
  faltantes` volta a pedir o campo ao lead (em vez de deixar um valor sem forma seguir para a
  `/quote` sem o agravo regional). Dono único do formato (LEI 11): nenhuma segunda regex aqui.

### Decisões registradas

- 2026-09-13 — decisão da coordenação sobre o ponto em aberto da Análise de impacto (#68): "as
  duas coisas" — normalizar na fronteira (aqui) E manter a rede de segurança rotulada no redator
  (`dominio/CONTRACT.md`), para cobrir texto livre do lead que este ponto não alcança.

---

## Seção da issue #57 (P14, PR 2 de 2) — status da conversa (append)

### O que esta frente acrescenta

- `aplicacao.servico_status_conversa.registrar_mudanca_de_status(trilha, conversation_id,
  novo_status, *, origem)` é o dono único (LEI 11) de COMO um `MudancaDeStatus` é gravado na
  trilha — `de` é sempre lido da PRÓPRIA trilha (`status_atual_da_conversa`), nunca recebido por
  parâmetro, para nunca haver dois lugares decidindo "qual era o status anterior". Três chamadores:
  `aplicacao.servico_conversa.registrar_status_do_turno` (via `conduzir_conversa`, `origem=
  "automatico"`), `aplicacao.servico_resposta_orientada.processar_mensagem_livre` (S8 da issue #58
  — fluxo que NÃO passa por `conduzir_conversa`, `origem="automatico"`) e `assumir`/`encerrar`
  (botões manuais, `origem="manual"`).
- `assumir(conversation_id, trilha)`/`encerrar(conversation_id, trilha)` validam a transição contra
  `dominio.status_conversa.pode_assumir`/`pode_encerrar` ANTES de gravar — nunca gravam uma
  transição que a tabela do domínio recusaria; levantam `TransicaoDeStatusInvalida` (a rota HTTP
  decide o 409, esta camada não engole a exceção).
- `ServicoDeTrilha.eventos_da_conversa(conversation_id)` (passthrough de leitura) — os três
  chamadores acima precisam saber o status ATUAL antes de decidir/gravar o próximo.
- Item 6 da issue #58 ("tentativas antes do corretor" da ficha — decisão registrada no PR #75):
  `montar_e_responder` ganha `tentativas_ja_feitas`; esgotado o `tentativas_antes_do_corretor` da
  ficha, encaminha sem chamar o LLM. `processar_mensagem_livre` conta, na trilha, quantos turnos já
  responderam objeção de preço. Limite conhecido (LEI 2, sinalizado no código): o LLM recebe todas
  as fichas publicadas juntas e escreve texto livre — não há como saber com certeza qual ficha
  embasou a resposta, então a contagem usa o MENOR `tentativas_antes_do_corretor` entre as fichas
  do contexto (leitura conservadora, nunca deixa passar do limite mais apertado).

### INVARIANTES acrescentadas

| # | invariante | teste que a cobre |
|---|---|---|
| I-12 | `registrar_mudanca_de_status` é o único lugar que escreve `MudancaDeStatus` — `registrar_status_do_turno`, `processar_mensagem_livre` e `assumir`/`encerrar` nunca constroem o evento por conta própria | `tests/aplicacao/test_servico_status_conversa.py`, `tests/aplicacao/test_servico_conversa.py::test_registrar_status_do_turno_grava_status_alterado_automatico_com_de_e_para`, `tests/aplicacao/test_servico_resposta_orientada_status.py::test_trilha_grava_status_alterado_aguardando_corretor_quando_encaminha_ao_corretor` |
| I-13 | `assumir`/`encerrar` nunca gravam quando a transição não é permitida pelo domínio — `TransicaoDeStatusInvalida` sobe, nada é gravado | `tests/aplicacao/test_servico_status_conversa.py::test_assumir_fora_de_aguardando_corretor_e_recusado` (confere `repositorio.gravados` inalterado) |

### Entradas e saídas públicas acrescentadas

- `aplicacao.servico_status_conversa.registrar_mudanca_de_status(trilha: ServicoDeTrilha, conversation_id: str, novo_status: StatusDaConversa, *, origem: str) -> None`.
- `aplicacao.servico_status_conversa.assumir(conversation_id: str, trilha: ServicoDeTrilha) -> StatusDaConversa` / `.encerrar(...)` — levantam `TransicaoDeStatusInvalida`.
- `aplicacao.servico_conversa.registrar_status_do_turno(trilha, conversation_id, decisao, resultado) -> StatusDaConversa`.
- `aplicacao.servico_trilha.ServicoDeTrilha.eventos_da_conversa(conversation_id: str) -> list[dict]`.

### O que NÃO é responsabilidade desta seção

- Decidir QUAL status vem a seguir — isso é 100% de `dominio.status_conversa` (`proxima_transicao_
  automatica`/`pode_assumir`/`pode_encerrar`); esta seção só sabe COMO gravar.
- A linha de integração em `conduzir_conversa` continuar chamando `registrar_status_do_turno` —
  isso é `aplicacao.servico_conversa`, já documentado na seção principal deste arquivo.

### Decisões registradas

- 2026-09-13/14 — issue #57 (P14, PR 2 de 2), achado ao integrar com a #58: `processar_mensagem_
  livre` não passa por `conduzir_conversa` e não constrói `dominio.decisao.Decisao` — por isso
  `registrar_mudanca_de_status` recebe o `StatusDaConversa` já decidido, em vez de receber uma
  `Decisao` e decidir por dentro (o que exigiria uma `Decisao` falsa nesse fluxo). Decisão da
  coordenação: a gravação mora na `aplicacao` (não no domínio), que continua puro/sem I/O.
