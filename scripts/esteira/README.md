# `scripts/esteira/` — de onde estes arquivos vieram, e como lê-los

Estes 63 arquivos (guards, bibliotecas e scripts de frente) **não foram escritos para este projeto**. Eles vêm de um kit de engenharia reutilizável, copiados para cá no commit que instalou a esteira. A partir daquele momento, **são arquivos deste repositório** — mantidos, corrigidos e auditados aqui.

## ⚠️ Números de issue e de ADR citados nos comentários são do KIT, não deste repositório

Ao ler o código você vai encontrar frases como *"issue #14"*, *"issue #17"*, *"ADR-0003"*, *"#21"*. **Elas se referem ao repositório de origem do kit**, e não às issues deste projeto — onde esses números existem e significam outra coisa. A auditoria fria de 2026-09-12 apontou isso como rastreabilidade quebrada, e ela tem razão: sem este aviso, um leitor seguiria o número errado.

Regra para quem mexer aqui: **ao tocar um destes arquivos, cite as issues DESTE repositório** e, se precisar referenciar a origem, escreva "issue N do kit" por extenso.

## As adaptações locais — o que difere da origem, e por quê

Cada uma nasceu de um defeito que travou um commit de verdade, foi medida, está explicada no próprio arquivo e reportada ao repositório de origem.

| Arquivo | Mudança | Motivo |
|---|---|---|
| `lib/varredura.mjs` e 5 guards | varredor pula `.venv`, `venv`, `.uv`, `__pycache__`, `site-packages` | media biblioteca de terceiro e reprovava commit por arquivo que não é nosso |
| `guards/companion-red-green.mjs` | roteia teste por extensão: `.py` no pytest, o resto no `node --test` | teste Node era entregue ao pytest, que coletava zero e saía 4 — lido como "pytest ausente" |
| `guards/companion-red-green.mjs` | a réplica da base recebe junção do `.venv`, como já recebia do `node_modules` | sem isso o guard **nunca** mede em projeto Python |
| `lib/esteira.mjs`, `lib/Esteira.ps1` | checagem por nome de outro projeto virou checagem estrutural | este repositório é público e não cita outro cliente |

## Limite conhecido, declarado

Oito guards de qualidade de código (`empty-catch`, `duplicate-logic`, `import-boundaries`, `cross-module-impact`, `await-unhandled`, `catch-silent-blocker`, `cochange-companion`, `todo-debt-ratchet`) respondem **NÃO APLICÁVEL** neste projeto porque a porta deles é a *stack declarada* (`python`), não a extensão real do arquivo. Consequência medida pela auditoria: **eles nunca medem o próprio JavaScript desta pasta.** Um `catch` vazio plantado aqui passa batido.

Isso está registrado como melhoria a fazer, com prova, nas issues deste projeto. Enquanto não for fechado, a qualidade **deste** diretório depende da revisão humana e da auditoria fria — e é honesto dizer isso em voz alta em vez de exibir um verde que não mediu nada.

## Nunca

**Não rode o bootstrap do kit sobre este repositório.** Ele copia por cima e apaga as adaptações acima em silêncio. Re-sincronizar com a origem, se um dia fizer sentido, é trabalho próprio, com auditoria.
