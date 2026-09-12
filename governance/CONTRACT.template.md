# CONTRACT — <módulo>

<!-- Um por módulo, em <módulo>/CONTRACT.md. O passo 2 lê a seção INVARIANTES antes de propor;
     o auditor confere se o PR quebrou alguma. Curto de propósito: contrato que ninguém lê não
     protege ninguém. -->

**Dono:** `<caminho do arquivo que decide a regra>` — **Vizinhos:** ver `governance/IMPACT_MATRIX.md`

## O que este módulo é dono de

- <o dado ou a regra que SÓ este módulo decide — ex.: "o preço final de uma diária">

## INVARIANTES (o que nunca pode ser falso)

<!-- Cada invariante tem o teste que ficaria vermelho se ela quebrasse. Invariante sem teste é desejo. -->

| # | invariante | teste que a cobre |
|---|---|---|
| I-1 | <ex.: `total >= 0` para qualquer combinação de descontos> | `tests/<modulo>.test.mjs` → `total nunca negativo` |
| I-2 |  |  |

## Entradas e saídas públicas

<!-- A assinatura que OUTROS módulos importam. Mudar aqui = varrer os chamadores (item 2 do PLANO). -->

- `<função/rota/tabela>` — `<tipo de entrada>` → `<tipo de saída>`

## O que NÃO é responsabilidade deste módulo

- <o que parece ser daqui mas tem outro dono — e quem é o dono>

## Decisões registradas

- <data> — <decisão em uma linha> → ADR `governance/adr/<arquivo>.md` (se houver)
