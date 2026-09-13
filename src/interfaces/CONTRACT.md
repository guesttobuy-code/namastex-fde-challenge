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
  de novo).
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
