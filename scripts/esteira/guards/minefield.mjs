#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: a prova-de-vida garante que o self-test de um guard morde a mutação da PORTA; NÃO
 *   garante que o guard morde CÓDIGO REAL (uma violação de verdade) nem que fica QUIETO em código são.
 *   Um scanner (onda ≥2) pode ter self-test verde e, no mundo real, não pegar nada (fantasma) ou
 *   reprovar tudo (falso-positivo → --no-verify). O campo minado é o portão de aceite: uma árvore SÃ
 *   (referencia/limpo) que todo scanner tem que deixar passar, e uma mina por scanner
 *   (referencia/minado/<guard>) que só o dono da mina pode morder.
 *
 * O QUE FAZ: para cada `referencia/minado/<G>/`, roda `<G>.mjs --dir referencia/limpo` (espera exit 0),
 *   `--dir referencia/minado/<G>` (espera exit 1) e `--dir referencia/minado/<H>` para todo H≠G (espera
 *   exit 0). Reprova: falso-positivo no limpo, não-morder a própria mina, ou morder mina alheia.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. scanner que reprova a árvore SÃ (falso-positivo — o caminho do --no-verify);
 *   2. scanner que NÃO morde a própria mina (guard fantasma — self-test verde, inútil no real);
 *   3. scanner que morde a mina de OUTRO guard (impreciso — não sabe o que vigia);
 *   4. mina sem guard (referencia/minado/<X> sem scripts/guards/<X>.mjs).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: se o guard morde a mutação da própria PORTA (prova-de-vida) nem se está
 *   CABEADO (guard-wiring); nem a QUALIDADE da árvore `limpo` (que ela seja realista é de quem a monta).
 *   Só mede: passa no são, morde a própria mina, ignora a alheia. NEM o PORQUÊ do exit 1: um scanner que
 *   morde a própria mina por acaso (ou que ESTOURA — exceção do Node também sai 1) conta como "mordeu" —
 *   distinguir reprovação de crash é do self-test + prova-de-vida do scanner, não daqui. É contrato de
 *   scanner que aceita --dir; meta-guards sem --dir (guard-wiring, prova-de-vida, guards-catalog) não entram.
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial: veredito SÓLIDO (a lógica segura), só um lapso de
 *   doutrina — a classe INVISÍVEL da banca não estava cased nem NÃO SE APLICA; corrigido abaixo.
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — NÃO SE APLICA: não lê padrão em código; orquestra processos e julga exit codes.
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: descobre por NOME de subpasta (readdir) e roda por spawn com
 *     caminho explícito; sem import/alias/link a resolver. Os seams de teste são env, do próprio self-test.
 *   BANCA: BASELINE — NÃO SE APLICA: sem allowlist; todo `minado/<G>` é cobrado.
 *   BANCA: INVISÍVEL — NÃO SE APLICA: descobre a mina por NOME de subpasta (readdir) e casa com o guard
 *     por NOME de arquivo; um caractere invisível num nome não bate com nenhum guard → vira `mina-sem-guard`
 *     (fail-safe, exit 1), nunca uma aprovação silenciosa.
 *   VAZIO (minado vazio → 0 com contagem), NULO, RENOMEAR (mina sem guard), SUBSTITUIR (guard falso que
 *     só afirma) viram casos no self-test.
 *
 * CONTRA-PROVA: node scripts/guards/minefield.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, existsSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { raizDoProjeto } from '../lib/raiz-do-guard.mjs';

const NOME = 'minefield';
const GUARDS_DIR = dirname(fileURLToPath(import.meta.url));
// RAIZ (issue #21): sobe até achar esteira.json (kit OU projeto bootstrapado, scripts/esteira/guards/
// incluso); sem esteira.json em lugar nenhum, cai no de sempre (dois níveis acima) — dono único em
// ../lib/raiz-do-guard.mjs, usado também por guards-catalog.mjs.
const RAIZ = raizDoProjeto(GUARDS_DIR);

/** Env do filho sem GIT_* (hooks do git contaminam repos temporários) e sem passthrough do npm. */
function envParaFilho() {
  const limpo = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  return { ...limpo, npm_lifecycle_event: '' };
}

/** Roda `node <guardsDir>/<guard>.mjs --dir <dir>` e devolve o exit code cru (null se o processo nem rodou). */
function rodarScanner(guardsDir, guard, dir) {
  const r = spawnSync(process.execPath, [join(guardsDir, `${guard}.mjs`), '--dir', dir], { encoding: 'utf8', timeout: 120_000, env: envParaFilho(), windowsHide: true });
  return r.status;
}

/**
 * FUNÇÃO PURA: dado o resultado de cada scanner (exit no limpo, na própria mina, nas alheias), lista os
 * problemas. Esperado: limpo=0, própria=1, alheias=0. Qualquer outra coisa é um problema nomeado.
 */
export function julgar(resultados) {
  const problemas = [];
  for (const r of resultados) {
    if (r.semGuard) { problemas.push({ tipo: 'mina-sem-guard', guard: r.guard, detalhe: `referencia/minado/${r.guard}/ existe mas scripts/guards/${r.guard}.mjs não` }); continue; }
    if (r.limpo !== 0) problemas.push({ tipo: r.limpo === 1 ? 'falso-positivo-limpo' : 'erro-no-limpo', guard: r.guard, detalhe: `${r.guard} reprovou/errou a árvore SÃ (exit ${r.limpo}, esperava 0)` });
    if (r.propria !== 1) problemas.push({ tipo: r.propria === 0 ? 'nao-morde-propria-mina' : 'erro-na-propria-mina', guard: r.guard, detalhe: `${r.guard} não mordeu a própria mina (exit ${r.propria}, esperava 1)` });
    for (const a of (r.alheias || [])) if (a.exit !== 0) problemas.push({ tipo: a.exit === 1 ? 'morde-mina-alheia' : 'erro-na-mina-alheia', guard: r.guard, detalhe: `${r.guard} reagiu à mina de ${a.guard} (exit ${a.exit}, esperava 0)` });
  }
  return { ok: problemas.length === 0, problemas };
}

/**
 * Roda o campo minado real. `referenciaRoot`/`guardsDir` injetáveis (o self-test aponta pra árvores tmp).
 * Lança se houver mina mas faltar a árvore `limpo` (NÃO MEDIU → o rodapé sai 2).
 */
export function medir({ referenciaRoot, guardsDir }) {
  const minadoRoot = join(referenciaRoot, 'minado');
  const limpo = join(referenciaRoot, 'limpo');
  if (!existsSync(minadoRoot)) return { resultados: [], count: 0 };
  const guards = readdirSync(minadoRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  if (guards.length === 0) return { resultados: [], count: 0 };
  if (!existsSync(limpo)) throw new Error(`referencia/limpo ausente — sem árvore SÃ pra baseline dos scanners`);
  const resultados = guards.map((g) => {
    if (!existsSync(join(guardsDir, `${g}.mjs`))) return { guard: g, semGuard: true };
    const limpoExit = rodarScanner(guardsDir, g, limpo);
    const propria = rodarScanner(guardsDir, g, join(minadoRoot, g));
    const alheias = guards.filter((h) => h !== g).map((h) => ({ guard: h, exit: rodarScanner(guardsDir, g, join(minadoRoot, h)) }));
    return { guard: g, limpo: limpoExit, propria, alheias };
  });
  return { resultados, count: guards.length };
}

export function principal({ env = process.env } = {}) {
  const referenciaRoot = env.MINEFIELD_REFERENCIA || join(RAIZ, 'referencia');
  const guardsDir = env.MINEFIELD_GUARDS || GUARDS_DIR;
  const { resultados, count } = medir({ referenciaRoot, guardsDir }); // lança se limpo faltar → rodapé → 2
  if (count === 0) { console.log(`[${NOME}] 0 scanners no campo minado (referencia/minado vazio) — pronto, nada a gatear ainda.`); return 0; }
  const r = julgar(resultados);
  if (r.ok) { console.log(`[${NOME}] ✅ ${count} scanner(s): cada um passa no limpo e morde SÓ a própria mina.`); return 0; }
  for (const p of r.problemas) console.error(`[${NOME}] FALHA (${p.tipo}): ${p.detalhe}`);
  console.error(`[${NOME}] COMO PASSAR: o scanner tem que sair 0 em referencia/limpo, 1 em referencia/minado/<ele>, e 0 nas minas alheias.`);
  console.error(`[${NOME}] POR QUE EXISTE: self-test verde não prova que o guard morde CÓDIGO real nem que fica quieto no são.`);
  return 1;
}

// ── fixtures da banca: scanners FALSOS que aceitam --dir e reprovam conforme o modo ──
function fakeScannerSrc(nome, modo) {
  const cond = { honesto: `files.includes('MINA-${nome}')`, nunca: 'false', sempre: 'true', guloso: `files.some((f) => f.startsWith('MINA-'))` }[modo];
  return `#!/usr/bin/env node\nimport { readdirSync } from 'node:fs';\nconst i = process.argv.indexOf('--dir');\nconst files = i >= 0 ? readdirSync(process.argv[i + 1]) : [];\nprocess.exitCode = (${cond}) ? 1 : 0;\n`;
}

/** Monta referenciaRoot (limpo/ + minado/<nome>/MINA-<nome>) e guardsDir (<nome>.mjs falsos) e chama fn. */
function comCampoMinado(specs, fn) {
  const base = mkdtempSync(join(tmpdir(), 'mf-'));
  try {
    const ref = join(base, 'referencia'); const gdir = join(base, 'guards');
    mkdirSync(join(ref, 'limpo'), { recursive: true }); writeFileSync(join(ref, 'limpo', 'ok.txt'), 'nada aqui\n');
    mkdirSync(gdir, { recursive: true });
    for (const { nome, modo } of specs) {
      mkdirSync(join(ref, 'minado', nome), { recursive: true });
      writeFileSync(join(ref, 'minado', nome, `MINA-${nome}`), 'x\n');
      writeFileSync(join(gdir, `${nome}.mjs`), fakeScannerSrc(nome, modo));
    }
    return fn({ referenciaRoot: ref, guardsDir: gdir, base });
  } finally { rmSync(base, { recursive: true, force: true }); }
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const normPath = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');

  // ── RAIZ do projeto (issue #21): minefield assumia dirname(dirname(GUARDS_DIR)) — só bate no
  // layout do KIT. Casos novos (dono único em ../lib/raiz-do-guard.mjs, compartilhado com
  // guards-catalog.mjs): kit (esteira.json 2 níveis acima → mesma raiz de antes), bootstrapado
  // (scripts/esteira/guards/, esteira.json mais acima → acha a raiz certa) e sem esteira.json em
  // lugar nenhum (fallback = comportamento de hoje).
  {
    const t = mkdtempSync(join(tmpdir(), 'rg-kit-'));
    try {
      writeFileSync(join(t, 'esteira.json'), '{}');
      const guardsDir = join(t, 'scripts', 'guards');
      mkdirSync(guardsDir, { recursive: true });
      check('RAIZ: layout do kit (esteira.json 2 níveis acima) → mesma raiz de antes', normPath(raizDoProjeto(guardsDir)) === normPath(dirname(dirname(guardsDir))));
    } finally { rmSync(t, { recursive: true, force: true }); }
  }
  {
    const t = mkdtempSync(join(tmpdir(), 'rg-boot-'));
    try {
      writeFileSync(join(t, 'esteira.json'), '{}');
      const guardsDir = join(t, 'app', 'scripts', 'esteira', 'guards'); // codigo="app": esteira.json bem mais acima
      mkdirSync(guardsDir, { recursive: true });
      const r = raizDoProjeto(guardsDir);
      check('RAIZ: layout bootstrapado (scripts/esteira/guards/) — acha a raiz certa via esteira.json', normPath(r) === normPath(t) && normPath(r) !== normPath(dirname(dirname(guardsDir))));
    } finally { rmSync(t, { recursive: true, force: true }); }
  }
  {
    const t = mkdtempSync(join(tmpdir(), 'rg-sem-'));
    try {
      const guardsDir = join(t, 'scripts', 'guards'); // sem esteira.json em lugar nenhum
      mkdirSync(guardsDir, { recursive: true });
      // `finder` fake força "não achei" — determinístico, não depende de %TEMP% estar livre de um
      // esteira.json perdido (medido: já não estava, na máquina do dono).
      check('RAIZ: sem esteira.json em lugar nenhum → cai no comportamento de hoje (dois níveis acima)', normPath(raizDoProjeto(guardsDir, () => null)) === normPath(dirname(dirname(guardsDir))));
    } finally { rmSync(t, { recursive: true, force: true }); }
  }
  // BYPASS (issue #21, item 3): num projeto bootstrapado `referencia/` nunca é copiado (não é um
  // "minado vazio" — a pasta-RAIZ inteira não existe). medir() já tolera isso (existsSync em cascata),
  // mas sem este caso ninguém prova: passar um MINEFIELD_REFERENCIA cuja pasta nem existe tem que
  // sair 0 com contagem 0, nunca vermelho — trata "referencia/ ausente" igual a "minado/ vazio".
  {
    const pai = mkdtempSync(join(tmpdir(), 'mf-nao-existe-'));
    const semReferencia = join(pai, 'referencia'); // deliberadamente NUNCA criado
    try {
      const m = medir({ referenciaRoot: semReferencia, guardsDir: GUARDS_DIR });
      check('BYPASS (referencia/ ausente, não só minado/ vazio): count 0, nunca lança', m.count === 0 && m.resultados.length === 0);
      const st = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', timeout: 60_000, env: { ...envParaFilho(), MINEFIELD_REFERENCIA: semReferencia, MINEFIELD_GUARDS: GUARDS_DIR } });
      check('PORTA (projeto bootstrapado sem referencia/): exit 0, nunca vermelho por pasta ausente', st.status === 0);
    } finally { rmSync(pai, { recursive: true, force: true }); }
  }

  // ── julgar: função pura, todos os modos de falha ──
  check('julgar: tudo certo (limpo 0, própria 1, alheia 0) → ok', julgar([{ guard: 'a', limpo: 0, propria: 1, alheias: [{ guard: 'b', exit: 0 }] }]).ok === true);
  check('julgar: falso-positivo no limpo → reprova', julgar([{ guard: 'a', limpo: 1, propria: 1, alheias: [] }]).problemas.some((p) => p.tipo === 'falso-positivo-limpo'));
  check('julgar: não morde a própria mina → reprova', julgar([{ guard: 'a', limpo: 0, propria: 0, alheias: [] }]).problemas.some((p) => p.tipo === 'nao-morde-propria-mina'));
  check('julgar: morde mina alheia → reprova', julgar([{ guard: 'a', limpo: 0, propria: 1, alheias: [{ guard: 'b', exit: 1 }] }]).problemas.some((p) => p.tipo === 'morde-mina-alheia'));
  check('julgar: mina sem guard → reprova', julgar([{ guard: 'x', semGuard: true }]).problemas.some((p) => p.tipo === 'mina-sem-guard'));
  check('julgar: exit 2 (erro) no limpo/própria não é confundido com bite/pass', (() => { const p = julgar([{ guard: 'a', limpo: 2, propria: 2, alheias: [] }]).problemas; return p.some((x) => x.tipo === 'erro-no-limpo') && p.some((x) => x.tipo === 'erro-na-propria-mina'); })());

  // ── medir + julgar end-to-end com scanners FALSOS ──
  comCampoMinado([{ nome: 'bom', modo: 'honesto' }], ({ referenciaRoot, guardsDir }) => {
    check('CONTROLE: scanner honesto (passa limpo, morde a própria) → ok', julgar(medir({ referenciaRoot, guardsDir }).resultados).ok === true);
  });
  comCampoMinado([{ nome: 'bom', modo: 'honesto' }, { nome: 'ruim', modo: 'nunca' }], ({ referenciaRoot, guardsDir }) => {
    check('BYPASS: scanner que nunca morde → nao-morde-propria-mina', julgar(medir({ referenciaRoot, guardsDir }).resultados).problemas.some((p) => p.tipo === 'nao-morde-propria-mina' && p.guard === 'ruim'));
  });
  comCampoMinado([{ nome: 'bom', modo: 'honesto' }, { nome: 'fp', modo: 'sempre' }], ({ referenciaRoot, guardsDir }) => {
    check('BYPASS: scanner que sempre reprova → falso-positivo-limpo', julgar(medir({ referenciaRoot, guardsDir }).resultados).problemas.some((p) => p.tipo === 'falso-positivo-limpo' && p.guard === 'fp'));
  });
  comCampoMinado([{ nome: 'bom', modo: 'honesto' }, { nome: 'guloso', modo: 'guloso' }], ({ referenciaRoot, guardsDir }) => {
    check('BYPASS: scanner guloso (morde qualquer MINA-) → morde-mina-alheia', julgar(medir({ referenciaRoot, guardsDir }).resultados).problemas.some((p) => p.tipo === 'morde-mina-alheia' && p.guard === 'guloso'));
  });

  // ── PORTA (issue #17): processo real, via seams MINEFIELD_REFERENCIA / MINEFIELD_GUARDS ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (env) => spawnSync(process.execPath, [meu], { encoding: 'utf8', timeout: 120_000, env: { ...envParaFilho(), ...env } }).status;
  comCampoMinado([{ nome: 'bom', modo: 'honesto' }], ({ referenciaRoot, guardsDir }) => {
    check('PORTA: campo minado íntegro → exit 0', porta({ MINEFIELD_REFERENCIA: referenciaRoot, MINEFIELD_GUARDS: guardsDir }) === 0);
  });
  comCampoMinado([{ nome: 'ruim', modo: 'nunca' }], ({ referenciaRoot, guardsDir }) => {
    check('PORTA: scanner que não morde → exit 1', porta({ MINEFIELD_REFERENCIA: referenciaRoot, MINEFIELD_GUARDS: guardsDir }) === 1);
  });
  // VAZIO: minado vazio → exit 0 com contagem 0
  const vazio = mkdtempSync(join(tmpdir(), 'mf-vazio-'));
  try {
    mkdirSync(join(vazio, 'minado'), { recursive: true }); mkdirSync(join(vazio, 'limpo'), { recursive: true });
    check('PORTA VAZIO: minado sem scanner → exit 0 (pronto, nada a gatear)', porta({ MINEFIELD_REFERENCIA: vazio, MINEFIELD_GUARDS: GUARDS_DIR }) === 0);
  } finally { rmSync(vazio, { recursive: true, force: true }); }
  // NÃO MEDIU: minado com scanner mas SEM limpo → medir lança → rodapé → exit 2
  const semLimpo = mkdtempSync(join(tmpdir(), 'mf-sl-'));
  try {
    mkdirSync(join(semLimpo, 'minado', 'bom'), { recursive: true }); writeFileSync(join(semLimpo, 'minado', 'bom', 'MINA-bom'), 'x\n');
    check('PORTA: mina sem árvore SÃ (limpo ausente) → medir rejeita → catch do rodapé → exit 2', porta({ MINEFIELD_REFERENCIA: semLimpo, MINEFIELD_GUARDS: GUARDS_DIR }) === 2);
  } finally { rmSync(semLimpo, { recursive: true, force: true }); }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) selfTest();
  else { try { process.exitCode = principal(); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; } }
}
