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
- `interfaces.servidor.criar_app(*, servico, painel_dir)` — fábrica do app WSGI (stdlib
  `wsgiref`), testável sem abrir socket (chamada direta com `environ`/`start_response`).
- `interfaces.servidor.main()` — sobe o servidor real via `wsgiref.simple_server.make_server`,
  lendo `CONHECIMENTO_DIR`/`PAINEL_DIR`/`SERVIDOR_PORT` do ambiente.

## O que NÃO é responsabilidade deste módulo

- Decidir a regra de negócio (`dominio`), orquestrar caso de uso (`aplicacao`) ou persistir de
  verdade (`infra`) — `interfaces` só traduz o mundo externo para uma chamada de `aplicacao`.
- Gerar o painel a partir do servidor — `servidor.py` só SERVE o que `painel/gerar.py` já
  escreveu em disco; nunca chama a geração dentro de uma requisição HTTP (mantém o painel estático
  independente do servidor, cuidado da coordenação na #43).

## Decisões registradas

- 2026-09-13 — `servidor.py` usa `wsgiref` (stdlib), zero dependência nova — ADR-0004, mesma linha
  de `infra.cliente_quote`/`infra.adaptador_de_linguagem` (stdlib em vez de SDK/framework).
