#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE (auditoria fria do kit, 2026-09-10, issue #11): uma linha em `lib/guard-doctrine.mjs`
 *   (`ehEntrypoint` devolvendo false) silenciava os 5 guards — saída vazia, exit 0 — e
 *   `guards:selftest`, `full-check` e o job do CI (`node guard --self-test || exit 1`) saíam VERDES.
 *   É o "guard mudo" que a própria doutrina cita como incidente de origem, reproduzido no kit.
 *   O erro de desenho: cobrar exit code sem cobrar EVIDÊNCIA de que o self-test rodou.
 *
 * O QUE FAZ: roda cada guard com `--self-test` como processo filho e exige a linha
 *   `SELF-TEST OK — N/N casos` com N > 0 na saída. Saída vazia, linha ausente, N = 0 ou exit ≠ 0 =
 *   vermelho, com o nome do guard. Antes disso, roda os casos das três funções da doutrina
 *   (`ehEntrypoint`, `selfTestPedido`, `relatarSelfTest`) no próprio processo. Também roda, com a MESMA
 *   doutrina, todo self-test de COMANDO (não guard) que more fora de `scripts/guards/` — lista em
 *   `SELFTESTS_FORA_DE_GUARDS` (`./guards-esperados.mjs`, hoje só `scripts/reservar-numero.mjs`): sem
 *   isso, o self-test do comando nunca roda no `full-check`/CI e um guard mudo ali passa batido.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. guard que sai 0 sem imprimir `SELF-TEST OK` (M17: ehEntrypoint=false);
 *   2. relator que mente (M16: `relatarSelfTest` devolvendo 0 com falhas);
 *   3. passthrough do npm (`npm run <guard> -- --self-test`) virando contra-prova (M18);
 *   4. o próprio runner aceitando saída vazia.
 *
 * LIMITE CONHECIDO: confere a FORMA da evidência (a linha), não a verdade de cada caso — essa é dos
 *   self-tests de cada guard e da mutação feita pelo auditor.
 *
 * CONTRA-PROVA: `node scripts/guards/run-selftests.mjs --self-test` — inclui um guard falso mudo e
 *   um relator falso.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { ehEntrypoint, selfTestPedido, relatarSelfTest, mesmoArquivo } from '../lib/guard-doctrine.mjs';
import { GUARDS_ESPERADOS, NAO_SAO_GUARDS, SELFTESTS_FORA_DE_GUARDS } from './guards-esperados.mjs';

const NOME = 'run-selftests';
// RUN_SELFTESTS_DIR existe SÓ para o self-test do próprio runner apontar para uma pasta vazia (prova do R1).
const AQUI = process.env.RUN_SELFTESTS_DIR || dirname(fileURLToPath(import.meta.url));
// PASTA_MAE nunca muda com RUN_SELFTESTS_DIR (esse env só finge uma pasta de GUARDS vazia/fake pro
// self-test deste runner) — é sempre a pasta-mãe REAL de scripts/guards/ (`scripts/` no kit,
// `scripts/esteira/` num projeto nascido do bootstrap): SELFTESTS_FORA_DE_GUARDS é relativo A ELA, não
// à raiz do repo (repo-relativo quebraria no projeto: scripts/esteira/scripts/... não existe).
const PASTA_MAE = dirname(dirname(fileURLToPath(import.meta.url)));
const RE_OK = /SELF-TEST OK — (\d+)\/(\d+) casos/;

/** FUNÇÃO PURA: julga a saída de um guard rodado com --self-test. */
export function julgarSaida({ stdout = '', stderr = '', status = null } = {}) {
  const texto = `${stdout}\n${stderr}`;
  const m = RE_OK.exec(texto);
  if (status !== 0) return { ok: false, motivo: `exit ${status}${/SELF-TEST FALHOU/.test(texto) ? ' (SELF-TEST FALHOU)' : ''}` };
  if (!m) return { ok: false, motivo: texto.trim() === '' ? 'saída VAZIA com exit 0 — guard mudo' : 'exit 0 sem a linha "SELF-TEST OK — N/N casos"' };
  const n = Number(m[1]), total = Number(m[2]);
  if (n === 0 || total === 0 || n !== total) return { ok: false, motivo: `linha diz ${n}/${total}` };
  return { ok: true, motivo: `${n}/${total}` };
}

export function rodarGuard(caminho, env = process.env) {
  // env limpo de GIT_* (hooks do git exportam GIT_DIR/GIT_INDEX_FILE e contaminam repos temporários dos self-tests)
  const limpo = Object.fromEntries(Object.entries(env).filter(([k]) => !/^GIT_/i.test(k)));
  const r = spawnSync(process.execPath, [caminho, '--self-test'], { encoding: 'utf8', timeout: 600_000, env: { ...limpo, npm_lifecycle_event: '' }, windowsHide: true });
  // stdout/stderr do filho voltam junto do veredito (issue #27, causa 3) — main() os imprime quando
  // reprova; sem isso o log do CI só tinha o resumo ("exit 1"), e reproduzir em container era a única
  // forma de descobrir o que o guard já tinha impresso e foi descartado aqui.
  return { ...julgarSaida({ stdout: r.stdout, stderr: r.stderr, status: r.status }), stdout: r.stdout, stderr: r.stderr };
}

// Imprime a saída do guard reprovado (issue #27, causa 3) — prioriza linhas com "✗" (os casos que
// falharam), cai pras últimas linhas se o padrão não bater. "SELF-TEST OK" é mascarado como
// "SELF-TEST OK[eco]" ao ecoar: hoje não vira falso-verde (julgarSaida olha o `status` do PROCESSO
// PAI antes do texto — o eco é side-effect de imprimir, nunca entra em julgarSaida), mas é o
// instrumento imprimindo, no seu próprio canal, a frase que ELE MESMO usa pra julgar (§5.1.7 do
// método: "o instrumento não pode morar dentro do que ele mede") — a máscara fecha essa porta antes
// que alguém mude a ordem das checagens de julgarSaida.
function ecoarSaidaReprovada(stdout = '', stderr = '') {
  const texto = `${stdout}${stderr}`.replace(/SELF-TEST OK/g, 'SELF-TEST OK[eco]');
  const linhas = texto.split('\n').map((l) => l.trimEnd()).filter((l) => l !== '');
  const comFalha = linhas.filter((l) => l.includes('✗'));
  for (const l of (comFalha.length ? comFalha : linhas.slice(-15))) console.log(`      ${l}`);
}

// A lista ESPERADA (issue #17, mutante R1): se a pasta devolver menos do que isto, o runner reprova —
// "todos os guards passaram" com zero guards rodados era verde. Dono único: ./guards-esperados.mjs
// (importável sem efeito colateral, ao contrário deste runner). Guard novo entra lá no mesmo PR.

function guardsDaPasta() {
  return readdirSync(AQUI).filter((f) => /^[a-z0-9-]+\.mjs$/.test(f) && !NAO_SAO_GUARDS.includes(f)).sort();
}

/** Casos do próprio runner (rodam no main — mutante R2 "julgarSaida sempre ok" cai aqui, não só no --self-test). */
function casosRunner(check) {
  check('runner: linha OK com N>0 → ok', julgarSaida({ stdout: '[x] SELF-TEST OK — 12/12 casos (incl. 3 tentativas de bypass).', status: 0 }).ok === true);
  check('runner BYPASS (M17): saída VAZIA com exit 0 → reprova como MUDO', (() => { const r = julgarSaida({ stdout: '', status: 0 }); return r.ok === false && /mudo/i.test(r.motivo); })());
  check('runner BYPASS: exit 0 sem a linha → reprova', julgarSaida({ stdout: 'rodou tudo, confia', status: 0 }).ok === false);
  check('runner BYPASS: "0/0 casos" → reprova', julgarSaida({ stdout: 'SELF-TEST OK — 0/0 casos', status: 0 }).ok === false);
  check('runner BYPASS: linha OK mas exit 1 → reprova', julgarSaida({ stdout: 'SELF-TEST OK — 3/3 casos', status: 1 }).ok === false);
  const achados = guardsDaPasta();
  const faltam = GUARDS_ESPERADOS.filter((g) => !achados.includes(g));
  check(`runner BYPASS (R1): os ${GUARDS_ESPERADOS.length} guards esperados estão na pasta${faltam.length ? ` — faltam: ${faltam.join(', ')}` : ''}`, faltam.length === 0);
  check('runner: SELFTESTS_FORA_DE_GUARDS lista reservar-numero.mjs (self-test do comando, fora de scripts/guards, relativo à pasta-mãe)', SELFTESTS_FORA_DE_GUARDS.includes('reservar-numero.mjs'));
}

// ─── casos da doutrina (as três funções que todo guard usa) ──────────────────
function casosDoutrina(check) {
  const meuCaminho = fileURLToPath(import.meta.url);
  check('doutrina: execução direta é entrypoint', ehEntrypoint(import.meta.url, meuCaminho, (p) => p) === true);
  check('doutrina: execução via JUNCTION continua entrypoint (fail-open resolvendo link)', ehEntrypoint(import.meta.url, '/link/atalho.mjs', (p) => (p === '/link/atalho.mjs' ? meuCaminho : p)) === true);
  check('doutrina: import de verdade (argv aponta para OUTRO arquivo) não é entrypoint', ehEntrypoint(import.meta.url, `${meuCaminho}.outro`, (p) => p) === false);
  check('doutrina: sem argv[1] → RODA (fail-open)', ehEntrypoint(import.meta.url, '', (p) => p) === true);
  check('doutrina: URL ilegível → RODA (fail-open)', ehEntrypoint('não-é-url', 'c:/x.mjs', (p) => p) === true);
  check('doutrina: mesmoArquivo ignora caixa e barra', mesmoArquivo('C:\\Repo\\G.mjs', 'c:/repo/g.mjs', (p) => p) === true);
  const mudo = () => {};
  check('doutrina: node direto com --self-test é contra-prova', selfTestPedido(['node', 'g.mjs', '--self-test'], {}, mudo) === true);
  check('doutrina: npm run <guard>:selftest é contra-prova', selfTestPedido(['node', 'g.mjs', '--self-test'], { npm_lifecycle_event: 'x:selftest' }, mudo) === true);
  check('BYPASS (M18): npm run <guard> -- --self-test NÃO é contra-prova', selfTestPedido(['node', 'g.mjs', '--self-test'], { npm_lifecycle_event: 'prova-colada' }, mudo) === false);
  check('doutrina: sem a flag nunca é contra-prova', selfTestPedido(['node', 'g.mjs'], {}, mudo) === false);
  const silencio = { log: console.log, error: console.error }; console.log = () => {}; console.error = () => {};
  try {
    check('BYPASS (M16): relator com 1 falha devolve 1', relatarSelfTest('x', [{ nome: 'a', ok: true }, { nome: 'b', ok: false }]) === 1);
    check('doutrina: relator com tudo verde devolve 0', relatarSelfTest('x', [{ nome: 'a', ok: true }]) === 0);
  } finally { console.log = silencio.log; console.error = silencio.error; }
}

function main() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  casosDoutrina(check);
  casosRunner(check);
  const falhas = casos.filter((c) => !c.ok);
  for (const c of casos) console.log(`  ${c.ok ? '✓' : '✗'} ${c.nome}`);
  if (falhas.length) { console.error(`[${NOME}] ❌ doutrina/runner reprovou ${falhas.length} caso(s) — nenhum guard é confiável com a base quebrada.`); process.exitCode = 1; return; }
  console.log(`[${NOME}] doutrina+runner OK — ${casos.length}/${casos.length}\n`);

  // Contagem FUNCIONAL (issue #17): sem `ruins++` numa linha à parte — apagar essa linha era o
  // mutante que mascarava um guard vermelho. `ruins` deriva do array; não há linha de incremento
  // para deletar, e o self-test PORTA abaixo roda o runner contra um guard vermelho para provar.
  const resultadosGuards = guardsDaPasta().map((g) => ({ g, r: rodarGuard(join(AQUI, g)) }));
  // self-tests de COMANDO fora de scripts/guards/ (ex.: reservar-numero.mjs) — mesma doutrina, resolvidos
  // SEMPRE contra a pasta-mãe real (PASTA_MAE), nunca contra o AQUI fake do self-test deste runner.
  const resultadosFora = SELFTESTS_FORA_DE_GUARDS.map((rel) => ({ g: rel, r: rodarGuard(join(PASTA_MAE, rel)) }));
  const resultados = [...resultadosGuards, ...resultadosFora];
  for (const { g, r } of resultados) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${g.padEnd(28)} ${r.motivo}`);
    if (!r.ok) ecoarSaidaReprovada(r.stdout, r.stderr);
  }
  const rodados = resultados.length;
  const ruins = resultados.filter((x) => !x.r.ok).length;
  const totalEsperado = GUARDS_ESPERADOS.length + SELFTESTS_FORA_DE_GUARDS.length;
  if (rodados < totalEsperado) { console.error(`\n[${NOME}] ❌ rodaram ${rodados}; esperados ${totalEsperado} (${GUARDS_ESPERADOS.length} guards + ${SELFTESTS_FORA_DE_GUARDS.length} self-test(s) fora de scripts/guards).`); process.exitCode = 1; return; }
  if (ruins) { console.error(`\n[${NOME}] ❌ ${ruins} sem evidência de self-test. Exit 0 sem a linha "SELF-TEST OK — N/N" é guard MUDO, não guard verde.`); process.exitCode = 1; return; }
  console.log(`\n[${NOME}] ✅ ${rodados} (guards + self-tests fora de scripts/guards) imprimiram SELF-TEST OK com N > 0.`);
  process.exitCode = 0;
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  casosDoutrina(check);
  casosRunner(check);
  check('SELF-TEST FALHOU com exit 1 → reprova citando', /FALHOU/.test(julgarSaida({ stderr: '[x] SELF-TEST FALHOU: 1/9', status: 1 }).motivo));
  // PORTA do próprio runner (issue #17): como processo, com a pasta de guards VAZIA → tem que reprovar (R1)
  const vazio = mkdtempSync(join(tmpdir(), 'rst-vazio-'));
  try {
    const st = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, npm_lifecycle_event: '', RUN_SELFTESTS_DIR: vazio } }).status;
    check('PORTA BYPASS (R1): runner com pasta de guards vazia → exit 1', st === 1);
  } finally { rmSync(vazio, { recursive: true, force: true }); }
  // PORTA: um guard VERMELHO entre os esperados → o runner TEM que sair 1 (mata o mutante que apaga
  // `if (!r.ok) ruins++` e a inversão do predicado de contagem — o guard mudo do #17, um nível acima).
  const comRed = mkdtempSync(join(tmpdir(), 'rst-red-'));
  try {
    GUARDS_ESPERADOS.forEach((g, i) => writeFileSync(join(comRed, g), i === 0
      ? "console.error('[fake] SELF-TEST FALHOU: 1/2'); process.exit(1);\n"
      : "console.log('[fake] SELF-TEST OK — 2/2 casos (incl. 1 tentativas de bypass).'); process.exit(0);\n"));
    const st = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, npm_lifecycle_event: '', RUN_SELFTESTS_DIR: comRed } }).status;
    check('PORTA: 1 guard vermelho entre os esperados → runner exit 1 (não mascara guard mudo)', st === 1);
  } finally { rmSync(comRed, { recursive: true, force: true }); }
  // PORTA (issue #27, causa 3): a saída do guard reprovado aparece IMPRESSA pelo runner, não só o
  // resumo "exit 1" — sem isso, reproduzir em container era a única forma de saber por que um guard
  // caiu. Sem o conserto de rodarGuard/ecoarSaidaReprovada este caso reprova (vermelho-antes real).
  const comEco = mkdtempSync(join(tmpdir(), 'rst-eco-'));
  try {
    const sinal = 'SINAL-DE-TESTE-CAUSA-3-ISSUE-27';
    GUARDS_ESPERADOS.forEach((g, i) => writeFileSync(join(comEco, g), i === 0
      // o sinal mora na MESMA linha do "✗" — igual a um guard de verdade, onde o motivo da falha é o
      // texto do próprio caso (ecoarSaidaReprovada prioriza linhas com "✗"; uma 2ª linha em stderr,
      // sem "✗", seria descartada pelo filtro e o caso nunca provaria nada).
      ? `console.log('  ✗ caso fake que carrega o sinal: ${sinal}'); console.error('[fake] SELF-TEST FALHOU: 1/2'); process.exit(1);\n`
      : "console.log('[fake] SELF-TEST OK — 2/2 casos (incl. 1 tentativas de bypass).'); process.exit(0);\n"));
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, npm_lifecycle_event: '', RUN_SELFTESTS_DIR: comEco } });
    check(
      `PORTA (causa 3, issue #27): saída do guard reprovado aparece impressa pelo runner, não só o resumo — procurando "${sinal}"`,
      r.stdout.includes(sinal),
    );
  } finally { rmSync(comEco, { recursive: true, force: true }); }
  // PORTA: self-test FORA de scripts/guards (scripts/reservar-numero.mjs, real) roda de verdade e conta
  // pro relatório/total — pasta de guards fake toda verde, RAIZ continua sendo a raiz REAL do repo.
  const comOk = mkdtempSync(join(tmpdir(), 'rst-ok-'));
  try {
    GUARDS_ESPERADOS.forEach((g) => writeFileSync(join(comOk, g), "console.log('[ok] SELF-TEST OK — 1/1 casos (incl. 0 tentativas de bypass).'); process.exit(0);\n"));
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 600_000, env: { ...process.env, npm_lifecycle_event: '', RUN_SELFTESTS_DIR: comOk } });
    check(
      'PORTA: self-test fora de scripts/guards (scripts/reservar-numero.mjs) roda e aparece no relatório, contribuindo pro exit',
      /reservar-numero\.mjs/.test(r.stdout) && r.status === 0,
    );
  } finally { rmSync(comOk, { recursive: true, force: true }); }
  const dir = mkdtempSync(join(tmpdir(), 'rst-'));
  try {
    const mudo = join(dir, 'mudo.mjs'); writeFileSync(mudo, 'process.exit(0);\n');
    const ok = join(dir, 'ok.mjs'); writeFileSync(ok, "console.log('[ok] SELF-TEST OK — 2/2 casos (incl. 1 tentativas de bypass).');\n");
    check('guard falso MUDO (exit 0, sem saída) → reprovado pelo runner', rodarGuard(mudo).ok === false);
    check('guard falso com a linha → aprovado pelo runner', rodarGuard(ok).ok === true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  process.exitCode = relatarSelfTest(NOME, casos);
}

// SEM portão de entrypoint, de propósito: este runner vigia a doutrina, então não pode depender dela
// para decidir se roda — com `ehEntrypoint` mutado para false (M17), o runner ficaria mudo junto
// com os guards e o CI sairia verde (medido em 2026-09-10). Ele é CLI por definição; roda sempre.
if (selfTestPedido()) selfTest(); else main();
