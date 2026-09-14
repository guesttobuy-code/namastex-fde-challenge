# CONTRACT — interfaces

**Dono:** `src/interfaces/` já tinha `cli.py` (F5/#8) e `painel/` (F10/#13), mas sem CONTRACT
próprio até agora. Primeira frente a documentar este módulo: F13 (servidor local, issue #43).
Camadas seguintes acrescentam seção própria por append, no fim deste arquivo — nunca editando
linha alheia (R2, #16).

## O que este módulo é dono de

- Os pontos de entrada do processo: `cli.py` (terminal), `painel/gerar.py` (geração estática
  offline) e, desta frente, `servidor.py` (HTTP).
- Tradução entre o mundo externo (stdin, HTTP, arquivo) e as chamadas de `aplicacao` — nunca
  decide regra de negócio.

## INVARIANTES (o que nunca pode ser falso)

| # | invariante | teste que a cobre |
|---|---|---|
| I-1 | `interfaces` nunca importa nada de `dominio` para decidir — só repassa dados; decisão é sempre de `aplicacao` | leitura de código (sem guard automático; `import-linter` não restringe `interfaces` importar `dominio`, só cobra `dominio`/`infra` não importarem `interfaces`) |
| I-2 | `servidor.py` nunca escreve em `conhecimento/` diretamente — sempre via `aplicacao.servico_conhecimento` | `tests/interfaces/test_servidor.py` (usa dublê de repositório, nunca grava fora dele) |
| I-3 | Toda rota estática (`/painel/...`) resolve o caminho e confere contra a raiz do diretório antes de ler — nenhum `id`/caminho vindo de fora escapa do diretório servido | `tests/interfaces/test_servidor.py::test_painel_recusa_escapar_do_diretorio` |
| I-4 | Só `cli.py`, `servidor.py` e `painel/gerar.py` são raízes de composição — só eles podem importar `infra` direto. Telas do painel (`painel/tela_*.py`) recebem dado pronto por parâmetro, nunca importam `infra`. | `tests/arquitetura/test_fronteiras.py::test_telas_do_painel_nao_importam_infra_direto` (varre `painel/*.py` exceto `gerar.py`; `.importlinter` não restringe `interfaces`→`infra`, achado da auditoria do PR #64) |

## Entradas e saídas públicas

- `interfaces.cli.main()` — CLI de terminal (F5/#8).
- `interfaces.painel.gerar.gerar_paineis(caminho_trilha, dir_saida) -> list[Path]` — geração
  estática offline (F10/#13), continua funcionando sem o servidor de pé.
- `interfaces.servidor.criar_app(*, servico, painel_dir, servico_configuracao, buscar_planos=infra.planos_http.buscar_planos)`
  — fábrica do app WSGI (stdlib `wsgiref`), testável sem abrir socket (chamada direta com
  `environ`/`start_response`) e sem bater na rede de verdade (`buscar_planos` injetável).
- `interfaces.servidor.main()` — sobe o servidor real via `wsgiref.simple_server.make_server`,
  lendo `CONHECIMENTO_DIR`/`CONFIGURACAO_COMERCIAL_ARQUIVO`/`PAINEL_DIR`/`SERVIDOR_PORT` do
  ambiente.
- Rotas: `GET/PUT /api/objecoes[/<id>]` (fichas), `GET/PUT /api/configuracao-comercial`, `GET /`
  (tela de edição), `GET /painel/...` (estático já gerado).

## O que NÃO é responsabilidade deste módulo

- Decidir a regra de negócio (`dominio`), orquestrar caso de uso (`aplicacao`) ou persistir de
  verdade (`infra`) — `interfaces` só traduz o mundo externo para uma chamada de `aplicacao`.
- Gerar o painel a partir de uma REQUISIÇÃO do servidor — `servidor.py` só SERVE o que já está em
  disco; nunca chama `painel/gerar.py` dentro do `app(environ, start_response)`. A geração em
  BUILD-TIME do `Dockerfile` (achado B1 da auditoria do PR #45: sem ela, `/painel/` dava 404 num
  clone limpo) é etapa de imagem, não do servidor — a mesma disciplina de "painel independente do
  servidor" continua valendo em runtime.

## Decisões registradas

- 2026-09-13 — `servidor.py` usa `wsgiref` (stdlib), zero dependência nova — ADR-0004, mesma linha
  de `infra.cliente_quote`/`infra.adaptador_de_linguagem` (stdlib em vez de SDK/framework).
- 2026-09-13 — Achados da auditoria do PR #45 (HEAD `9ee1135`), corrigidos no mesmo push:
  `Dockerfile` gera o painel de `examples/*.jsonl` em build-time (B1); vocabulário de marcadores
  passa a incluir `coberturas` e `franquia_<id do plano>` por plano, lido da `/planos` na borda
  HTTP (B2); a tela nunca mais sugere um texto de resposta nem um número de tentativas (B3/R1); os
  argumentos permitidos viram checkbox de lista fechada (R2); a primeira publicação sai como
  versão 1 (R3); as mensagens de erro do domínio são frase para o dono (R4); e a configuração
  comercial ganhou rota + tela + ligação real com `interfaces.cli` (B4) — `rodar_conversa` carrega
  `dominio.configuracao_comercial.ConfiguracaoComercial` de `conhecimento/configuracao_comercial.json`
  por padrão e passa para `aplicacao.servico_conversa.conduzir_conversa`.
- 2026-09-13 — issues #51/#55: `interfaces.cli` deixou de gravar a trilha em parte (`coletar_dados`
  não gravava nada) e em parte errado (`coletar_dados_por_texto_livre` chamava
  `trilha.registrar_evento` direto) — agora as duas passam por
  `aplicacao.servico_conversa.registrar_pergunta_de_coleta`/`registrar_resposta_de_coleta` (dono
  único da escrita da trilha). `interfaces.painel.tela_regras` deixou de importar `infra` direto
  (I-4 acima): `planos` e a política de retry chegam prontos por parâmetro, buscados só em
  `painel/gerar.py`.

---

## Seção da issue #46 (PR 2 de 2) — chat centralizado ligado ao agente real (append, R2/#16)

### O que esta frente acrescenta

- `interfaces.chat.tela_chat` (novo pacote, mesmo molde de `interfaces.conhecimento.tela_edicao`):
  `render()` monta o chat via `layout.pagina`, sem `css_extra_da_tela` — decisão desta frente, sem
  oitavo mock em `docs/design/` (CSS inline em `_corpo.html`, documentado no docstring do módulo).
- `servidor.py`: `GET /` passa a servir `interfaces.chat.tela_chat.render()` (o placeholder do PR 1
  sai de cena); `GET /api/planos` (proxy só-leitura de `infra.planos_http.buscar_planos`, o MESMO
  cliente que a base de conhecimento já usa — nunca um segundo cliente HTTP); `GET
  /docs/design/paises.json` (estático, lista de países para o seletor do WhatsApp); `POST
  /api/chat/contato` (único caminho de escrita do contato real do lead, via
  `aplicacao.servico_contato.ServicoDeContato`); `POST /api/chat/cotar` (monta/atualiza
  `EstadoDaConversa` em memória, chama `aplicacao.servico_conversa.conduzir_conversa` — o MESMO
  caso de uso que `interfaces.cli` já chama, nunca reimplementado aqui —, grava a trilha e
  regenera o painel); `POST /api/chat/contratar` ("Quero contratar" e "Falar com um corretor" —
  ver a nota da decisão abaixo — marcam `ultimo_intent=QUER_CONTRATAR` e chamam `conduzir_conversa`
  de novo); `POST /api/chat/mensagem`, roteada para `interfaces.chat_mensagem.responder_chat_mensagem`
  (módulo próprio, separado de `servidor.py` para não empurrar o arquivo perto do teto do guard
  `file-loc-ceiling` — importa os helpers de borda HTTP de `interfaces.http_comum`, abaixo; issue
  #51, parte 2: registra uma pergunta ou resposta de um dos 9 passos da coleta guiada na trilha,
  pelas MESMAS funções `aplicacao.servico_conversa.registrar_pergunta_de_coleta`/
  `registrar_resposta_de_coleta` que `interfaces.cli` já usa — dono único da escrita da trilha;
  nunca chama `gerar_paineis`, mesmo padrão mais leve de `/api/chat/contato`. Campo obrigatório
  `campo`, um dos 9 nomes de passo do fluxo guiado — nome/whatsapp/email são mascarados no servidor
  antes de chegar na trilha, incondicional ao texto que o cliente mandou; CEP é normalizado por
  `dominio.validacao.normalizar_cep` antes de gravar, mesma disciplina de `/api/chat/cotar`,
  issue #68 — achado durante a prova: CEP sem hífen não batia em nenhum padrão do redator e
  chegaria em claro).
- `interfaces.http_comum` (novo, issue #51 parte 2): utilitários de borda HTTP compartilhados —
  `json_resposta`, `ler_corpo_json`, `conversation_id_ou_400`, `METODO_NAO_SUPORTADO`,
  `CONVERSATION_ID_VALIDO` — extraídos de `servidor.py` (dono único, sem duplicar) porque o merge
  com outras frentes levou o arquivo a 603 linhas, acima do teto do `file-loc-ceiling`; `servidor.py`
  e `chat_mensagem.py` importam de lá, sem mudança de assinatura/comportamento.
- Estado da conversa entre turnos (ADR-0005, decisão 1): `_ESTADOS_EM_MEMORIA`, um
  `dict[str, EstadoDaConversa]` a nível de MÓDULO em `servidor.py` — não escondido atrás de uma
  classe. Perdido ao reiniciar o processo, limite aceito e declarado no ADR.
- O painel é regenerado a cada `/api/chat/cotar`/`/api/chat/contratar` bem-sucedido (ADR-0005,
  decisão 2) — chamando `interfaces.painel.gerar.gerar_paineis` de novo, com
  `repositorio_contato=` para a Fila humana ganhar nome/WhatsApp.

### Leitura de I-1 pedida pela orientação da coordenação (PLANO, item 7)

A análise de impacto original supôs que "`servidor.py` nunca importa `dominio` direto" contradizia
a I-1 já registrada, mas a I-1 real diz "`interfaces` nunca importa `dominio` PARA DECIDIR — só
repassa dados". `servidor.py` já importava `dominio.ficha_objecao.MarcadorInvalido` (para capturar
a exceção) antes desta frente; esta frente acrescenta `dominio.estado_conversa.EstadoDaConversa` e
`dominio.intencao.Intencao` pelo MESMO motivo — são tipos de dado que atravessam a borda HTTP
(quem monta o `EstadoDaConversa`/decide o que `Intencao.QUER_CONTRATAR` significa continua sendo
`aplicacao.servico_conversa`/`dominio.politica`, nunca `servidor.py`). Nenhuma contradição; a
leitura correta da I-1 já estava certa, só precisava ser registrada explicitamente — como pedido.

### Decisão registrada — "Falar com um corretor" cai no mesmo endpoint de "Quero contratar"

O domínio (issue #42) só tem UM sinal de escalonamento explícito do lead:
`Intencao.QUER_CONTRATAR` → `MotivoHandoff.LEAD_QUER_CONTRATAR`, incondicional e antes de qualquer
outra regra (`dominio.politica.decidir`). Não existe um segundo `reason_code` para "pedir humano
sem contratar" — inventar um exigiria mudar `dominio` (fora do escopo desta frente e da leitura da
LEI 2/LEI 11: duplicar um handoff que já existe, não criar um novo dono). Por isso os dois botões
do chat ("Quero contratar" e "Falar com um corretor") chamam a MESMA rota `POST /api/chat/contratar`
— o texto que o lead vê muda (o que ele digitou/clicou), o texto que volta do backend é sempre
"Logo um corretor vai entrar em contato para te dar todo o suporte." (issue #46, aprovado no #41).

### Cotação: resposta única, sem polling ao vivo (decisão desta frente)

`POST /api/chat/cotar` devolve o resultado FINAL de `conduzir_conversa` de uma vez (não expõe
progresso por tentativa via um segundo endpoint) — a issue permitia os dois caminhos ("decida pelo
mais simples que ainda mostra a tentativa final"). O número de tentativas que a `/quote` levou
aparece no corpo da resposta (`tentativas: {realizada, max}`, lido dos eventos
`tentativa_de_cotacao` já gravados na trilha desta chamada) e o chat mostra "tentativa X de 3" no
resultado — não ao vivo durante a espera. Mais simples de implementar e testar no prazo; menos
fiel ao protótipo (que anima tentativa por tentativa). Documentado aqui e no relatório do PR.

### Entradas e saídas públicas acrescentadas

- `interfaces.chat.tela_chat.render(*, caminho_ui_css=None) -> str`.
- `interfaces.servidor.criar_app(...)` ganha os parâmetros aditivos `servico_contato`,
  `trilha_dir`, `repositorio_contato`, `portal_de_cotacao` (todos com default seguro — nenhum
  chamador existente precisa mudar; ver docstring de `criar_app`).
- `interfaces.servidor.main()` lê `TRILHA_DIR` (padrão `"examples"`) e `CONTATO_DIR` (padrão
  `"contato/leads"`) do ambiente, além das variáveis já existentes.

### O que NÃO é responsabilidade desta seção

- Decidir o texto de preço/recusa/handoff (`dominio.redator`/`_texto_da_decisao` em
  `aplicacao.servico_conversa`) — o JS do chat só EXIBE o que `/api/chat/cotar`/`contratar`
  devolveu, nunca calcula nem reformata valor monetário.
- Responder com o LLM/base de conhecimento — fora de escopo (declarado na issue #46), o chat é
  guiado e determinístico de propósito.

---

## Seção das issues #67/#68/#69 (frente `robustez-quote-entrada`) — validação de fronteira e resposta não-JSON (append)

### O que esta frente acrescenta

- `servidor._responder_chat_cotar` (#68): CEP fora do formato (`abc`, 7 ou 9 dígitos) é recusado
  com 400 ANTES de chegar a `montar_estado` — usa `dominio.validacao.normalizar_cep`, a mesma
  função que o `aplicacao.servico_conversa.montar_estado` já usa (dono único, nunca uma segunda
  regex na borda HTTP).
- `servidor._responder_salvar_configuracao` (#69): `PUT /api/configuracao-comercial` recusa com
  400 qualquer valor de `encaminhar_lead_fora_do_padrao` que não seja `bool` JSON de verdade —
  `bool("nao")` é `True`, então mandar `"nao"` LIGAVA a configuração em silêncio (o oposto do
  pedido). `true`/`false` JSON continuam aceitos sem mudança.
- `servidor._responder_ler_ficha` (#69): `GET /api/objecoes/<id>` com id fora do formato seguro
  (inclusive tentativa de path traversal, já BLOQUEADA antes de qualquer leitura de arquivo) passa
  a devolver 400 em vez de 500 — o `ValueError` de `_validar_id` (dono: `infra.repositorio_
  conhecimento_json`) já era tratado no `PUT`, faltava no `GET`.
- `interfaces/chat/_corpo.html` (#67): `cotar()` e `contratar()` tinham `await resposta.json()`
  FORA do `try` de rede — uma resposta com corpo não-JSON (o cenário que motivou o #67, antes do
  conserto do backend) travava o card em "Consultando…"/"Um momento…" para sempre. Agora o parse
  do corpo está dentro do mesmo `try`, com o mesmo tratamento visível de falha e o botão "Tentar de
  novo" que o erro de rede já usava.

- 2026-09-13 — decisão da coordenação: os 3 achados de validação (#67 JS, #68 CEP na rota, #69
  configuração/ficha) entram juntos nesta frente, mesmo módulo de fronteira HTTP, mesmo PR.

---

## Seção da issue #57 (P14, PR 2 de 2) — rotas de status e caixa de entrada (append)

### O que esta frente acrescenta

- `interfaces.rotas_status_conversa` (novo, mesmo padrão de `interfaces.rotas_resposta_orientada`
  — módulo próprio pelo teto de linhas do `file-loc-ceiling`): `POST /api/conversa/assumir`/
  `encerrar`, despachadas em `_rotear_chat` numa única entrada (`if caminho in (...)`). Glue HTTP
  (`_json`/`_ler_corpo_json`/`_conversation_id_ou_400`) vem de `interfaces.http_comum` (PR #76),
  nunca duplicada.
- `_responder_chat_contratar` ganha o campo `motivo` (`"contratar"` default | `"humano"`) —
  `Intencao.QUER_CONTRATAR`/`QUER_FALAR_COM_HUMANO`, cada um com seu `MotivoHandoff` (#63).
  `_corpo.html::contratar(textoDoLead, motivo)` — os 5 call-sites (3 do card de preço/ENCERRAR + 2
  de `habilitarCampoDeObjecao`, #75) mandam o campo.
- `interfaces.painel.tela_conversas` ganha caixa de entrada de verdade (S13, pedido do dono ao
  testar a tela): lista à esquerda, UMA conversa por vez à direita, seleção por clique + hash da
  URL, motivo/contato/contexto coletado do handoff (S12, `interfaces.painel.motivos`, dono único) e
  botões Assumir/Encerrar chamando as rotas acima — nunca uma regra de habilitação em JS (o
  `disabled` vem do `dominio.status_conversa` já calculado no servidor). `interfaces.painel.layout`:
  item "Fila humana" aponta pro Histórico filtrado (`?status=aguardando_corretor`), rótulo/ícone
  intactos.
- `interfaces.painel.tela_fila_humana` REMOVIDA (pré-auditoria do PR #87): o catálogo de "todo
  motivo com descrição" que ela mostrava migrou para `interfaces.painel.tela_regras` (que já tinha
  a MESMA lista de códigos, só faltava a descrição — `interfaces.painel.motivos.descricao_do_motivo`
  acrescentada); o motivo/contato/contexto POR CONVERSA migrou para `tela_conversas` (acima). Nenhum
  caso de teste sumiu — todos migraram, listados no tombstone de `test_tela_fila_humana.py`.
  `interfaces.painel.gerar.gerar_paineis` não gera mais `handoffs.html` (cinco telas, não seis).

### O que NÃO é responsabilidade desta seção

- A caixa de resposta do corretor, a consulta periódica e a continuidade do chat do lead (issue
  #86, decisão do dono 13/09/2026 ~22:45) — o cabeçalho da conversa selecionada em `tela_conversas`
  fica isolado de propósito como ponto de extensão, sem construir nada disso agora.

### Decisões registradas

- 2026-09-13/14 — issue #57 (P14, PR 2 de 2): status/filtro/botões entram nesta frente; a extração
  de `_DESCRICAO_MOTIVO` (`interfaces.painel.motivos`) só aconteceu depois do merge do PR #75
  (#58), que já tinha acrescentado `RESPOSTA_ORIENTADA_INDISPONIVEL` ao mapa — evitando perder essa
  entrada num conflito de merge, por instrução explícita da coordenação.
- 2026-09-14 — pré-auditoria do PR #87: a decisão inicial desta frente era MANTER `tela_fila_humana.py`
  (o catálogo de motivos não tinha substituto ainda). A auditoria mediu que `tela_regras.py` já
  mostrava o MESMO catálogo (só sem descrição) — decisão revertida: catálogo com descrição vai para
  `tela_regras`, `tela_fila_humana.py` é removida. Ver ADR-0006 (revisão).

## Seção da issue #95 — chat encaminha quando `/api/planos` fica indisponível (append)

### O que esta frente acrescenta

- `interfaces.rotas_planos_indisponivel` (novo, mesmo padrão de `rotas_status_conversa`/
  `chat_mensagem` — módulo próprio pelo teto do `file-loc-ceiling`, 597/600 antes desta linha):
  `POST /api/chat/planos-indisponivel`, despachada em `_rotear_chat`. **Nunca recebe
  `portal_de_cotacao`** — a rota é estruturalmente incapaz de chamar a `/quote` de verdade (ver
  `aplicacao.CONTRACT.md`, I-15). Idade/veículo/CEP vêm do CORPO da requisição, não de
  `_ESTADOS_EM_MEMORIA` — esse dict só é preenchido por `/api/chat/cotar`, e o lead nunca chega lá
  quando `/api/planos` falha antes (exatamente o caso que esta rota cobre).
- `_corpo.html::PASSOS.plano()`: conta falhas consecutivas de `GET /api/planos`; na 2ª falha
  seguida, chama `encaminharPorPlanosIndisponiveis()` (nova) em vez de repetir "Tentar de novo" —
  decide só QUANDO chamar o servidor, nunca o motivo (isso é 100% do servidor/aplicação).

### O que NÃO é responsabilidade desta seção

- `tela_conversas.py`/painel — não mudam (a rota já grava `handoff`/`status_alterado` pelo mesmo
  caminho que as outras, então o painel já sabe desenhar sem alteração nenhuma). `examples/` — não
  regenerado por esta frente.

### Decisões registradas

- 2026-09-14 — issue #95, achado ao ler `_payload_da_quote`: chamar `/api/chat/cotar` (rota já
  existente) quando `/api/planos` falha PARECIA a reutilização mais simples, mas foi descartado —
  `_payload_da_quote` usa `plano_id or "essencial"`; se a `/quote` estiver de pé e só `/api/planos`
  tiver falhado (timeouts/retry diferentes: `buscar_planos` é 1 tentativa de 2s sem retry,
  `ClienteQuoteHTTP` são 3×3s com orçamento de 10s), isso cotaria de verdade pro plano "essencial"
  sem o lead ter escolhido nada. A rota nova constrói `ENCAMINHAR`/`QUOTE_INDISPONIVEL` direto, sem
  nunca tentar a `/quote`.
