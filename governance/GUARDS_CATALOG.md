# Catálogo de guards (GERADO — não edite à mão)

27 guard(s):

- `adr-sequence.mjs` — ADR é registro permanente (LEI DO REGISTRO) e é referenciado por NÚMERO (#ADR-0003, "substituída por ADR-0007"): se dois ADRs nascerem com o MESMO número, ou…
- `auditoria-vigente.mjs` — o veredito de auditoria (passo 4) existia só como comentário em prosa, e NADA no servidor sabia qual valia.
- `await-unhandled.mjs` — a dor do dono ("diz que funciona e não funciona") na forma async — uma Promise cuja REJEIÇÃO não é tratada.
- `catch-silent-blocker.mjs` — irmão do empty-catch, a MESMA dor ("diz que funciona e não funciona") por outra porta.
- `changelog-update.mjs` — "mapear e documentar cada PR vencido" é um inegociável do kit — sem isso, um PR que muda código (corrige bug, muda comportamento, adiciona feature) entra e sai…
- `cochange-companion.mjs` — a dor do dono — "mudou a fonte, mexeu no teste" é inegociável.
- `companion-red-green.mjs` — teste escrito DEPOIS do conserto nasce verde e nunca provou nada.
- `cross-module-impact.mjs` — mudar a SUPERFÍCIE PÚBLICA de um módulo (o barrel `index.*`, ou um arquivo que ele RE-EXPORTA) parece local mas quebra quem depende dela sem que ninguém rode o…
- `docs-required.mjs` — a LEI DA FONTE diz que regra de negócio só existe se estiver ESCRITA (CONTRACT/ADR/ doc) — mas essa lei não se aplica sozinha.
- `duplicate-logic.mjs` — o vício nº 1 da IA — reimplementar em vez de reusar.
- `empty-catch.mjs` — a dor do dono — "a IA diz que funciona e não funciona".
- `file-loc-ceiling.mjs` — arquivo gigante é monólito que ninguém revisa de verdade — 2000 linhas escondem bug no meio, viram dono-de-tudo (um arquivo, N responsabilidades → o oposto do…
- `frente-registro.mjs` — LEI 73 — 1 chat = 1 branch = 1 worktree = 1 PR = 1 frente rastreável.
- `guard-change-ritual.mjs` — "consertar" um guard pode ENFRAQUECÊ-LO sem ninguém ver — apagar casos do self-test pra ele parar de reprovar (LEI 74: o número de casos só cresce), ou gutar a…
- `guard-wiring.mjs` — guard sem chamador não existe.
- `guards-catalog.mjs` — a rede caminha para ~110 guards.
- `import-boundaries.mjs` — `.arch-layers.json` é a arquitetura-alvo DESENHADA (Clean Architecture em camadas + cápsulas de módulo) — mas sem um guard que a LEIA e trave, ela é só um…
- `leis-integrity.mjs` — a Bússola (a seção "AS 12 LEIS DO DESENVOLVIMENTO" do CLAUDE.md) é a única fonte de verdade que toda sessão de IA lê antes de trabalhar.
- `minefield.mjs` — a prova-de-vida garante que o self-test de um guard morde a mutação da PORTA; NÃO garante que o guard morde CÓDIGO REAL (uma violação de verdade) nem que fica…
- `plano-na-issue.mjs` — o passo 3 da esteira exige um `## PLANO` publicado na issue ANTES da primeira linha de código (arquivos · chamadores colados · a regressão · quem pega · fora ·…
- `prova-colada.mjs` — o CI verde não lê o corpo do PR, e o corpo é onde a IA (e o dono) declaram "pronto".
- `prova-de-vida.mjs` — a issue #17 mostrou que um guard pode ter self-test verde e o `main()` (a PORTA, o exit code) silenciado ao mesmo tempo — nada na bateria cobrava que o…
- `reserva-de-numero.mjs` — ADR-0004 — recurso NUMERADO e compartilhado (ADR, migration) colide quando duas frentes em paralelo escolhem "o próximo número" olhando só a própria árvore.
- `secret-leak.mjs` — segredo commitado é o incidente que não tem "desfazer" — uma vez no histórico do git (e num repo remoto), vazou, mesmo que um commit depois o remova.
- `testes-catraca.mjs` — a dor do dono — regressão que passa batido.
- `text-encoding.mjs` — este projeto é acentuado (pt-BR) e roda em Windows com editores variados.
- `todo-debt-ratchet.mjs` — dívida técnica marcada e não-rastreada (o "depois eu arrumo" que nunca vem) se acumula em silêncio.

Gerado por `guards-catalog.mjs`. Para atualizar: `npm run guards-catalog -- --write`.
