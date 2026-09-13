# ADR-0001 — Guards python substitutos

- **Status:** aceita
- **Data:** 2026-09-12
- **Issue/PR:** #4

## Contexto

O kit `-base` roda uma rede de guards no `full-check`, mas 8 deles (`empty-catch`, `await-unhandled`,
`catch-silent-blocker`, `duplicate-logic`, `import-boundaries`, `cross-module-impact`,
`cochange-companion`, `todo-debt-ratchet`) só leem JavaScript/TypeScript. Num projeto declarado
`"stack":"python"` no `esteira.json`, eles saem `NÃO_APLICAVEL` de propósito (`stackDoProjeto()`) —
sem `pyproject.toml`, o próprio `python-check` do kit também sai `NÃO_APLICAVEL`, e o `full-check`
fica verde sem medir nenhuma linha do nosso Python. Verde vazio é pior que vermelho: esconde que a
máquina não está olhando para o código real.

## Decisão

Recolocar máquina equivalente com `ruff` (lint) e `import-linter` (fronteira de camadas), configurados
em `pyproject.toml` e `.importlinter` na raiz do projeto.

- `pyproject.toml`: `[tool.ruff]` com `extend-exclude = ["quote-service", "scripts", "dataset"]`
  (código da Namastex, herdado do fork — não é nosso) e `select` cobrindo 4 grupos de regras, cada
  um substituindo um guard cego:

  | Guard cego (kit) | Regras do ruff | O que preveniria |
  |---|---|---|
  | `empty-catch` | E722, BLE001, S110 | erro engolido em silêncio |
  | `catch-silent-blocker` | TRY400, TRY300 | erro que vira só log e o programa segue |
  | `await-unhandled` | RUF006, ASYNC110 | chamada assíncrona solta / espera ocupada |
  | `todo-debt-ratchet` | TD003, FIX002 | dívida marcada sem link de issue |

  Mais três regras bônus sem guard cego equivalente: `C901` (complexidade), `SLF001` (acesso a
  privado de fora), `TID252` (import relativo implícito).

- `.importlinter`: dois contratos `forbidden`, literais ao texto da issue #4/âncora #3 — `dominio`
  não importa `aplicacao`/`infra`/`interfaces`; `infra` não importa `interfaces`. Roda via
  `tests/arquitetura/test_fronteiras.py`, que fica no pre-commit (`companion:red-green`/`test:ci`).

- **`pylint --enable=R0801` (duplicação de código) e o guard próprio de teste-companheiro ficam FORA
  desta frente**, por decisão de escopo já registrada na issue #4 (auditoria externa, 2026-09-11):
  são os dois itens mais caros da lista e o prazo do desafio é de três dias. Entram só depois do
  checkpoint pós-F5, se houver tempo; até lá, `duplicate-logic` e `cochange-companion` continuam
  cobertos apenas pela auditoria fria — limite declarado no README.

- `tests/arquitetura/fixtures/`: um arquivo ruim por regra (`except_nu.py`, `except_generico.py`,
  `log_engole_erro.py`, `task_solta.py`, `todo_sem_issue.py`, `import_furando_camada/`), fora do
  `ruff check .` normal via `extend-exclude`, mas lintáveis quando um teste chama `ruff check
  <arquivo>` explicitamente (o exclude não vale para caminho passado na linha de comando, sem
  `force-exclude`). `tests/arquitetura/test_ruff_morde_fixtures.py` prova que cada uma morde.

- **Ambiente:** o `.venv` desta worktree foi criado com `uv venv` + `uv pip install
  ruff==0.16.7 pytest==9.1.1 import-linter==2.15 pylint==4.0.8` (pylint instalado para uso futuro —
  não é cobrado no pre-commit ainda, por decisão de escopo acima).

## Consequências

- **Melhora:** `npm run python-check` passa a medir de verdade (ruff + pytest reais); os 4 grupos de
  regra do ruff e o contrato de camadas do `import-linter` são cobrados a cada commit via
  `full-check` → `python-check` e `tests/arquitetura/` via `test:ci`.
- **Custo:** se `extend-exclude` for editado para menos, o pre-commit passa a lintar código da
  Namastex e trava commits por defeito alheio — `tests/arquitetura/test_escopo_do_lint.py` é o teste
  que pega essa regressão especificamente (vermelho comprovado sem `pyproject.toml`, verde com ele).
- **Fica PROIBIDO** remover `tests/arquitetura/fixtures/` do `extend-exclude` sem atualizar os testes
  que dependem dele ficar fora do `ruff check .` normal.
- **Guards que cobram esta decisão:** `python-check` (mede ruff+pytest), `docs-required` (não
  aplicável a este ADR), `adr-sequence`/`reserva-de-numero` (numeração deste próprio arquivo),
  `changelog-update` (linha no CHANGELOG citando #4), `file-loc-ceiling`/`text-encoding`/
  `secret-leak`/`testes-catraca` (já enxergam `.py` nativamente, sem depender desta decisão).

## Alternativas descartadas

- **Portar os 8 guards cegos para Python** (reescrever a lógica de AST em `ast`/`libcst`): custo alto
  para reimplementar o que `ruff` já faz, mais rápido e mais testado, em C.
- **Incluir `pylint --enable=R0801` já nesta frente:** descartado por decisão de escopo do dono
  (auditoria externa, 2026-09-11) — prazo de três dias, item caro, cobertura substituta (auditoria
  fria) já declarada.
- **Um único contrato "layers" no import-linter em vez de dois "forbidden":** descartado por inventar
  mais restrição do que o texto da issue #4 pede (LEI DO NÃO-CHUTE) — a issue não diz, por exemplo,
  que `aplicacao` não pode importar `interfaces`.

## Emenda — 2026-09-13 (issue #50, achado da auditoria de arquitetura #49)

**O que mudou:** um 3º contrato `forbidden` entrou no `.importlinter` — `aplicacao` não importa
`infra` nem `interfaces`.

**Por que isto não contradiz "Alternativas descartadas" acima:** a decisão original (12/09) recusou
esta mesma restrição por LEI DO NÃO-CHUTE, porque o texto da issue #4/âncora #3 não a pedia. Isso
mudou de mão em 12/09, DEPOIS desta ADR: a F4 (#7) escreveu `src/aplicacao/CONTRACT.md` I-2
afirmando *"`aplicacao` nunca importa `infra` nem `interfaces`... coberto por
`tests/arquitetura/test_fronteiras.py`"* — uma decisão de módulo, publicada, nunca refletida de
volta no `.importlinter`. A auditoria de arquitetura #49 mediu por mutação (`import infra.config`
em `src/aplicacao/servico_conhecimento.py`) que `lint-imports`/`test_fronteiras.py` ficavam VERDES
mesmo com a violação — o contrato citado no `CONTRACT.md` não existia na máquina. Não é uma
restrição nova inventada agora: é a máquina alcançando uma decisão que já estava publicada e não
cobrada. Prova colada na issue #50 e no PR desta emenda.

**Consequência adicional:** `governance/IMPACT_MATRIX.md` e `src/aplicacao/CONTRACT.md` não mudam
de texto — só passam a ser verdade.
