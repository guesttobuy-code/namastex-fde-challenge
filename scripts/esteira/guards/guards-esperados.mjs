/**
 * DONO ÚNICO da lista de guards que a rede espera existir.
 *
 * POR QUE É UM MÓDULO À PARTE: `run-selftests.mjs` roda `main()`/`selfTest()` no rodapé ao ser
 * carregado (é CLI por definição — issue #17), então NÃO pode ser importado por quem só quer a lista.
 * Esta lista é dado puro, sem efeito colateral: `run-selftests` (cobra que a pasta não encolha),
 * `guard-wiring` (cobra que todo .mjs de guard esteja aqui e cabeado) e `roadmap-progresso` importam
 * daqui — um dono só, sem regex frágil sobre o texto de outro arquivo.
 *
 * REGRA: guard novo entra AQUI no mesmo PR em que nasce (Parte 7 de governance/COMO-CRIAR-GUARD.md).
 * NÃO são guards (não entram): `run-selftests.mjs` (o runner) e `guards-esperados.mjs` (este dado).
 */
export const GUARDS_ESPERADOS = [
  'adr-sequence.mjs',
  'auditoria-vigente.mjs',
  'await-unhandled.mjs',
  'catch-silent-blocker.mjs',
  'changelog-update.mjs',
  'cochange-companion.mjs',
  'companion-red-green.mjs',
  'cross-module-impact.mjs',
  'docs-required.mjs',
  'duplicate-logic.mjs',
  'empty-catch.mjs',
  'file-loc-ceiling.mjs',
  'frente-registro.mjs',
  'guard-change-ritual.mjs',
  'guard-wiring.mjs',
  'guards-catalog.mjs',
  'import-boundaries.mjs',
  'leis-integrity.mjs',
  'minefield.mjs',
  'plano-na-issue.mjs',
  'prova-colada.mjs',
  'prova-de-vida.mjs',
  'reserva-de-numero.mjs',
  'secret-leak.mjs',
  'testes-catraca.mjs',
  'text-encoding.mjs',
  'todo-debt-ratchet.mjs',
];

/** Arquivos em scripts/guards/ que NÃO são guards (o runner e este próprio dado). */
export const NAO_SAO_GUARDS = Object.freeze(['run-selftests.mjs', 'guards-esperados.mjs']);

/**
 * DONO ÚNICO da lista de self-tests que provam um COMANDO (não um guard) e por isso moram FORA de
 * `scripts/guards/` — `run-selftests.mjs` só varre esta pasta (`guardsDaPasta()`), então sem esta lista
 * `node scripts/reservar-numero.mjs --self-test` nunca rodaria no `full-check`/CI e um "guard mudo" nesse
 * comando passaria batido (o mesmo incidente de origem deste runner, um nível acima).
 *
 * Caminho RELATIVO À PASTA-MÃE de `scripts/guards/` — `scripts/` no kit, `scripts/esteira/` num projeto
 * nascido do bootstrap (que copia `scripts/` inteira para lá, mantendo a MESMA estrutura relativa) —
 * NUNCA relativo à raiz do repo (isso quebraria no projeto: `scripts/esteira/scripts/...` não existe).
 * Cada entrada roda com `<pasta-mãe>/<entrada> --self-test` e é cobrada pela MESMA doutrina (linha
 * "SELF-TEST OK — N/N casos", N > 0, exit 0) — ver `rodarGuard`/`julgarSaida` em `run-selftests.mjs`.
 * REGRA: comando novo com self-test fora de scripts/guards entra AQUI no mesmo PR em que nasce.
 */
export const SELFTESTS_FORA_DE_GUARDS = Object.freeze(['reservar-numero.mjs', 'python-check.mjs']);
