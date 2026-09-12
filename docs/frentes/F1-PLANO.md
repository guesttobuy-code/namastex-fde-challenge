# F1 — `pyproject.toml` + máquina para os 8 guards que não leem Python

> **Status:** rascunho local, escrito em 2026-09-11 no chat de coordenação, ANTES do bootstrap.
> Vira o corpo da issue da frente F1 e o comentário `## PLANO` assim que a esteira nascer (o guard
> `plano-na-issue` exige o plano publicado antes da primeira linha de código).
> **Nada aqui foi commitado.** Nenhum push acontece sem ordem explícita do dono.

## Pronto quando

| Efeito | Prova executada |
|---|---|
| `python-check` do kit sai do estado NÃO APLICÁVEL e passa a medir só o **nosso** código | `npm run python-check` verde com `pyproject.toml` presente; e a saída mostrando que nenhum arquivo de `quote-service/`, `scripts/` ou `dataset/` foi lintado |
| Os 6 buracos com ferramenta pronta passam a ser cobrados a cada commit | `pytest` vermelho contra as fixtures ruins e verde depois do conserto (bloco colado na issue) |
| Os 2 buracos sem ferramenta ganham guard nosso | o guard próprio reprovando um diff real que mexe na fonte sem tocar no teste companheiro |
| A decisão fica registrada | ADR criado por `npm run adr:nova -- "guards-python-substitutos"` + linha no `CHANGELOG.md` citando a issue |

## 1. Arquivos que a frente toca

| Arquivo | O que entra |
|---|---|
| `pyproject.toml` (novo) | `[tool.ruff]` com as regras medidas; `extend-exclude = ["quote-service", "scripts", "dataset"]` (código da Namastex não é nosso); `[tool.pytest.ini_options]` com `testpaths = ["tests"]`; dependências de desenvolvimento (`ruff`, `pytest`, `import-linter`, `pylint`) |
| `.importlinter` (novo) | contrato de fronteira entre camadas — nasce mínimo e cresce quando a arquitetura do agente for decidida |
| `tests/arquitetura/test_fronteiras.py` (novo) | roda `lint-imports`; falha se um contrato quebrar |
| `tests/arquitetura/test_duplicacao.py` (novo) | roda `pylint --enable=R0801` sobre `src/`; falha se houver clone de regra |
| `tests/arquitetura/test_companheiro.py` (novo) | guard nosso (~40 linhas): lê o `git diff` e reprova fonte alterada sem o teste companheiro no mesmo diff |
| `tests/arquitetura/fixtures/` (novo) | os arquivos ruins que provam que a configuração morde (erro engolido, log no lugar de exception, task solta, TODO sem issue, import furando camada, função duplicada) |
| `.gitignore` | acrescenta `_PRIVADO/` e `*.token`; **conserta duas armadilhas medidas** (abaixo) |
| `CHANGELOG.md`, `governance/adr/NNNN-*.md` | registro obrigatório da decisão |

### As duas armadilhas do `.gitignore` (medidas em 2026-09-11)

1. **`*.log` ignora o log de execução**, que é entregável explícito do desafio ("log de uma execução completa"). Conserto: gravar em `.jsonl`/`.md`, ou abrir exceção declarada.
2. **`.env.*` ignora o `.env.example`**, que é justamente o arquivo que documenta as variáveis sem segredo. Conserto: `!.env.example`.

## 2. As regras do `ruff`, e por que cada uma

Substituem guards do kit que **não leem Python** (medido: os 8 saem NÃO APLICÁVEL). Prova colada na sonda de 2026-09-11 — os 7 achados apareceram numa fixture proposital.

| Regra | Guard do kit que ela substitui |
|---|---|
| `E722`, `BLE001`, `S110` | `empty-catch` — erro engolido em silêncio |
| `TRY400`, `TRY300` | `catch-silent-blocker` — erro que vira só log e o programa segue |
| `RUF006`, `ASYNC110` | `await-unhandled` — chamada assíncrona solta |
| `TD003`, `FIX002` | `todo-debt-ratchet` — dívida marcada sem issue |
| `C901`, `SLF001`, `TID252` (bônus) | complexidade, acesso a privado, import relativo |
| `lint-imports` (import-linter 2.15) | `import-boundaries` — camada importando o que não pode |
| `pylint R0801` (pylint 4.0.8) | `duplicate-logic` — a mesma regra escrita em dois lugares |
| guard nosso, lendo o diff | `cochange-companion` — fonte mudou sem o teste companheiro |
| **sem cobertura** | `cross-module-impact` — fica com a auditoria fria, declarado |

## 3. A regressão que isto pode causar

**Comportamento que funciona hoje:** o `full-check` passa, porque sem `pyproject.toml` o `python-check` sai NÃO APLICÁVEL.
**O risco:** criar o `pyproject.toml` liga o `ruff` e o `pytest` de verdade. Se o `extend-exclude` estiver errado, **o pre-commit passa a lintar o código da Namastex** (`quote-service/`, `scripts/`) e trava todo commit por defeito que não é nosso. O inverso também morde: excluir demais e deixar o nosso código sem medição.

## 4. O teste que pega essa regressão — escrito ANTES do conserto

`tests/arquitetura/test_escopo_do_lint.py`: roda o `ruff` com a nossa configuração e afirma que **nenhum arquivo medido está sob `quote-service/`, `scripts/` ou `dataset/`**, e que **pelo menos um arquivo de `src/` está**. Vermelho hoje (não existe configuração), verde depois. É o primeiro teste da frente.

## 5. O que fica FORA desta frente

Código do agente; workflow de CI; `docs/COMO-TRABALHAMOS.md`; melhorias no documento de guards do kit (o kit tem dono único); o contrato de camadas definitivo (depende da arquitetura); colocar o `pylint` no pre-commit **antes de medir o custo** — se for lento, fica só no CI, decisão registrada no ADR.

## 6. Rollback

Reverter o commit da frente. Sem `pyproject.toml`, o `python-check` volta a NÃO APLICÁVEL e o pre-commit fica como está hoje. Nenhuma alteração em ferramenta externa, nenhum efeito fora do repositório.

## Medições que sustentam este plano (2026-09-11)

- `ruff 0.16.7`, `import-linter 2.15`, `pylint 4.0.8` instalados e executados numa pasta temporária; os três reprovaram as fixtures propositais (saídas coladas na issue quando ela nascer).
- `scripts/python-check.mjs` do kit: roda `<python> -m ruff check .` + `<python> -m pytest -q` e **declara na própria certidão que não julga a qualidade das regras** — logo, a força da rede em Python depende deste `pyproject.toml`.
- Áreas de issue confirmadas pelo dono: `agente`, `quote-api`, `dataset`, `pii-lgpd`, `entrega`, `processo`, `infra`.
