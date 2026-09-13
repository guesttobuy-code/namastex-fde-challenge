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
| I-4 | Só `cli.py`, `servidor.py` e `painel/gerar.py` são raízes de composição — só eles podem importar `infra` direto. Telas do painel (`painel/tela_*.py`) recebem dado pronto por parâmetro, nunca importam `infra`. | leitura de código (sem guard automático; .importlinter não restringe interfaces→infra) + tests/interfaces/painel/test_tela_regras.py (render não aceita URL nem lê infra) |

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
