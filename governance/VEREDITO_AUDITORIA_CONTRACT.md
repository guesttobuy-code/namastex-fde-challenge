# Contrato do veredito de auditoria (passo 4 da esteira)

**Dono único:** este arquivo. **Enforcement:** `scripts/esteira/guards/auditoria-vigente.mjs` (motor
+ `--self-test`) e `.github/workflows/auditoria-vigente.yml` (commit status `auditoria-vigente`).
A skill `/4-auditar-pr-base` aponta para cá em vez de repetir o template.

## A forma normativa

O veredito é um **comentário de PR** (não uma review) cuja **primeira linha não-vazia** é:

```
## Auditoria para merge <qualificador opcional> — <DECISÃO> (HEAD `<sha>`) <observação opcional>
```

| Elemento | Regra |
|---|---|
| Prefixo | `## Auditoria para merge` — literalmente, na **primeira linha**. Caixa livre. No meio do corpo **não conta**. |
| Qualificador | livre e opcional: `(auditor EXTERNO, viés declarado)`, `(re-auditoria)`, `(3ª rodada)`. |
| Decisão | uma de `APROVADO`, `APROVADO COM RESSALVAS`, `REPROVADO`. |
| `DRAFT` | a palavra `DRAFT` em qualquer lugar da primeira linha **anula a aprovação**. |
| `NÃO APROVADO` | conta como `REPROVADO` (com ou sem acento). |
| Sha do HEAD | 7 a 40 hexadecimais, com ou sem crase. **Obrigatório para aprovar.** |

## As três regras que o CI aplica

1. **Só o último veredito conta.** Aprovação anterior não ressuscita depois de uma reprovação.
2. **`DRAFT` não aprova.**
3. **Aprovação tem que citar o sha do HEAD.** Vigência é por sha, **não por data** — a data do
   commit não é a data do push. Consequência desejada: **todo push novo derruba o check** até uma
   auditoria nova.

## Exemplos que aprovam

```
## Auditoria para merge — APROVADO (HEAD `cd9b39c5e`)
## Auditoria para merge (auditor EXTERNO, viés declarado) — APROVADO COM RESSALVAS (HEAD `cd9b39c5e`); as 2 ressalvas são de higiene
```

## Exemplos que NÃO aprovam

```
## Auditoria para merge — REPROVADO                                  → reprovado
## Auditoria para merge — DRAFT: APROVADO COM RESSALVAS (HEAD `x`)   → draft
## Auditoria para merge — APROVADO COM RESSALVAS                     → não cobre o HEAD (sem sha)
## Auditoria para merge — APROVADO (HEAD `9b6a731d1`)                → não cobre o HEAD (sha de outro commit)
## Auditoria para merge — NÃO APROVADO (HEAD `cd9b39c5e`)            → reprovado
## Auditoria para merge — vou revisar amanhã                         → sem decisão (derruba o verde de propósito)
```

## O corpo (abaixo da primeira linha)

`**Chat dono:** <app_session_id> · **Auditor:** <app_session_id> · **Base:** <sha> · **HEAD auditado:** <sha>`,
a tabela plano × diff, a tabela de ângulos com saída colada, `## Prova executada`,
`## O que NÃO verifiquei (e por quê)`, achados de passagem, ordem de merge, e a linha final
**"Merge é ato do dono. Este comentário não autoriza nada."** O veredito passa pela régua
`prova-colada` antes de ser publicado (`&&`, nunca `;`).
