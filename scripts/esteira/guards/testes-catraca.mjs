#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: a dor do dono — regressão que passa batido. Apagar (ou "temporariamente" comentar,
 *   ou deletar o arquivo, ou renomear-e-reduzir) um teste é o jeito mais silencioso de deixar a suite
 *   verde escondendo um comportamento que parou de ser checado. O teste que pegava a regressão some, e
 *   ninguém vê. A catraca: um arquivo de teste não pode perder casos vs a base — o nº de `test(`/`it(`
 *   só cresce. Reescrever/renomear pode; REDUZIR só com opt-out explícito e auditável no diff.
 *
 * O QUE FAZ: pega os arquivos de teste (`*.test|spec|tests|specs.*` e tudo sob `__tests__/` — JS/TS; OU
 *   `test_*.py`/`*_test.py`/qualquer `.py` sob `tests/` — Python, R6 2026-09-11) MUDADOS vs a base (git)
 *   e, POR ARQUIVO, exige nº de casos no HEAD >= o da base. Em JS/TS conta `test(`/`it(`; em Python conta
 *   `def test_…`/`async def test_…` (inclusive método de classe `Test…` — é o MESMO token `def test_`, sem
 *   caso especial por nome de classe). Rename-aware: se o arquivo foi renomeado, a base é lida do caminho
 *   ANTIGO (git-base `-M`), senão o rename esconderia a perda. Conta sobre o código DESPIDO (o marcador em
 *   comentário/string não conta — `despirCodigo` em JS/TS, `despirPython` em Python). Arquivo NOVO é
 *   isento. Opt-out por-arquivo: o marcador `catraca-reduz-de-proposito` no fonte isenta AQUELE arquivo (o
 *   auditor vê o marcador no diff — mesmo idioma do `ignora-de-proposito` do empty-catch).
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. arquivo de teste com MENOS casos que na base, SEM o opt-out (apagar/comentar/deletar/renomear-e-
 *      reduzir esconde regressão). Deletar o arquivo INTEIRO zera os casos no HEAD → É reprovado.
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) se os testes NOVOS são bons/mordem — isso é o companion-red-green e
 *   o auditor; (b) esvaziar o CORPO de um teste mantendo o `test(` (vira teste-teatro) — o nº não cai,
 *   pego por leitura/auditoria; (c) teste em runner que não usa test()/it() — a convenção do kit é
 *   node:test; (d) `test` importado com ALIAS (`import { test as t }`) e chamado por outro nome — conta
 *   por TOKEN `test(`/`it(`, não resolve alias (pode até dar falso-positivo se você trocar pra alias —
 *   use os nomes canônicos); (e) a catraca é POR-ARQUIVO, de propósito: MOVER casos entre arquivos sem
 *   o opt-out trip a catraca — um total-ratchet mascararia deleção real "compensada" por teste-teatro em
 *   outro arquivo (falso-negativo no núcleo, pior que ausente); (f) o opt-out desliga a catraca só
 *   DAQUELE arquivo — não afere se o motivo é honesto (é o auditor que lê o marcador).
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial (onda 4): (HOLE 1, alta) renomear o arquivo no
 *   mesmo commit escondia a perda — `arquivosMudados` virou rename-aware (`-M`) e a base é lida do caminho
 *   ANTIGO. (HOLE 5) split/mover casos entre arquivos dava falso-positivo sem escape — agora há opt-out
 *   por-arquivo (recusei o total-ratchet: abriria falso-negativo no núcleo). (HOLE 4) a certidão MENTIA
 *   ("deletar o arquivo inteiro não é visto") — deleção zera os casos e É reprovada (a regressão mais
 *   silenciosa); certidão e fix-hint corrigidos. (HOLE 3) RE_TESTE não pegava `.tests.`/`__tests__/` —
 *   ampliado. (HOLE 2) alias de import documentado como limite conhecido.
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — TRATADA: conta `test(`/`it(` sobre o código DESPIDO. O opt-out é lido do
 *     fonte CRU de propósito (é um comentário, como o `ignora-de-proposito`); marcador em string "burla"
 *     a si mesmo e fica no diff pro auditor — mesmo modelo de ameaça aceito do empty-catch.
 *   BANCA: RENOMEAR — TRATADA: `-M` do git-base pareia delete+add; a base vem do caminho antigo.
 *   BANCA: VAZIO/NULO — TRATADA: deletar o arquivo (head vazio) → 0 casos < base → reprova.
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: opera sobre o diff do git (git-base), não segue import/link.
 *   BANCA: BASELINE — NÃO SE APLICA: a "base" é o commit-base do git, não um arquivo/allowlist editável.
 *   SUBSTITUIR(git mockável)/INVISÍVEL viram casos no repo git real do self-test.
 *
 * CONTRA-PROVA: node scripts/guards/testes-catraca.mjs --self-test — repo git real: N casos na base,
 *   HEAD com N-1 → reprova; deletar o arquivo → reprova; renomear-e-reduzir → reprova; rename puro → ok;
 *   reduzir COM opt-out → ok; N+1 → ok; teste novo → ok; diff só de fonte → ok.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { despirCodigo } from '../lib/despir-codigo.mjs';
import { despirPython } from '../lib/despir-python.mjs';
import { RE_TESTE_PY } from '../lib/python-test.mjs';
import { paresBaseHead, baseDaEsteira, temHead, refExiste, repoRaiz, envSemGit } from '../lib/git-base.mjs';

const NOME = 'testes-catraca';
// Convenção de arquivo de teste JS/TS: sufixo `.test|spec|tests|specs.<ext>` OU qualquer arquivo sob `__tests__/`.
const RE_EXT = 'mjs|cjs|js|jsx|ts|tsx|mts|cts';
const RE_TESTE = new RegExp(`(?:^|/)(?:[^/]*\\.(?:test|spec|tests|specs)\\.(?:${RE_EXT})|__tests__/(?:[^/]+/)*[^/]*\\.(?:${RE_EXT}))$`, 'i');
// RE_TESTE_PY (convenção de teste Python — test_*.py/*_test.py/qualquer .py sob tests/): dono único em
// lib/python-test.mjs — companion-red-green.mjs usa a MESMA convenção pra achar o teste a rodar (LEI 11).
// Opt-out por-arquivo (idioma do `ignora-de-proposito` do empty-catch): isenta a REDUÇÃO daquele arquivo.
// Lido do fonte CRU de propósito — é um comentário; e fica no diff pro auditor validar o motivo.
const MARCADOR_OPTOUT = 'catraca-reduz-de-proposito';

/** FUNÇÃO PURA: nº de casos de teste (test()/it(), com .only/.skip/.each) no código DESPIDO (JS/TS). */
export function contarTestes(fonte) {
  return (despirCodigo(String(fonte ?? '')).match(/\b(?:test|it)\b(?:\s*\.\s*\w+)?\s*\(/g) || []).length;
}

/** FUNÇÃO PURA (R6, 2026-09-11): nº de casos de teste Python (`def test_…`/`async def test_…`, inclusive
 *  método de classe `Test…` — o mesmo token `def test_`, sem caso especial por nome de classe) no código
 *  DESPIDO (comentário `#`/string apagados por `despirPython`). */
export function contarTestesPython(fonte) {
  return (despirPython(String(fonte ?? '')).match(/\bdef\s+test_\w*\s*\(/g) || []).length;
}

/** Dispara a contagem certa pra `caminho` (Python vs JS/TS — dono único desta decisão neste guard). */
function contarCasos(caminho, fonte) {
  return RE_TESTE_PY.test(String(caminho ?? '')) ? contarTestesPython(fonte) : contarTestes(fonte);
}

/** FUNÇÃO PURA: o fonte tem o opt-out explícito? (lido no CRU — é um comentário, `//` em JS ou `#` em Python). */
export function temOptOut(fonte) {
  return String(fonte ?? '').includes(MARCADOR_OPTOUT);
}

/** FUNÇÃO PURA: julga cada mudança {arquivo, fonteBase, fonteHead}. Só cobra o que a base já tinha.
 *  Por-arquivo de propósito (ver "O QUE NÃO VÊ" (e)). Opt-out `catraca-reduz-de-proposito` no HEAD isenta.
 *  A contagem (JS/TS ou Python) é escolhida pelo CAMINHO do arquivo (`contarCasos`). */
export function julgar(mudancas) {
  const problemas = [];
  for (const m of mudancas) {
    if (!m.fonteBase) continue; // arquivo de teste novo — nada a catracar
    if (temOptOut(m.fonteHead)) continue; // redução declarada e auditável no diff
    const cb = contarCasos(m.arquivo, m.fonteBase), ch = contarCasos(m.arquivo, m.fonteHead);
    if (cb > 0 && ch < cb) problemas.push({ tipo: 'testes-removidos', arquivo: m.arquivo, detalhe: `casos de teste caíram de ${cb} pra ${ch} (catraca por-arquivo: só cresce; renomear/reescrever pode, reduzir/apagar só com "${MARCADOR_OPTOUT}")` });
  }
  return { ok: problemas.length === 0, problemas };
}

/** Coleta as mudanças de arquivos de teste vs a base (git). paresBaseHead: DONO ÚNICO em lib/git-base.mjs
 *  (LEI 11) — teste deletado: head '' → 0 casos → reprova; rename-aware (HOLE 1, via `old`). */
export function medir({ repo, base }) {
  const mudancas = paresBaseHead(base, repo, (e) => RE_TESTE.test(e.path) || RE_TESTE_PY.test(e.path));
  return { mudancas, julgamento: julgar(mudancas) };
}

function main() {
  const argv = process.argv.slice(2);
  const flagBase = (() => { const i = argv.indexOf('--base'); return i >= 0 ? argv[i + 1] : undefined; })();
  const repo = repoRaiz(process.cwd());
  if (!repo) { console.error(`[${NOME}] NÃO MEDIU: não estou num repositório git.`); process.exitCode = 2; return; }
  const base = flagBase || baseDaEsteira(repo);
  if (!base) { console.error(`[${NOME}] NÃO MEDIU: informe --base <ref> (ou rode num projeto com esteira.json).`); process.exitCode = 2; return; }
  if (!temHead(repo)) { console.log(`[${NOME}] NAO_APLICAVEL: repositório ainda sem commit (primeiro commit).`); process.exitCode = 0; return; }
  if (!refExiste(base, repo)) { console.error(`[${NOME}] NÃO MEDIU: a base "${base}" não existe — git fetch primeiro.`); process.exitCode = 2; return; }
  let resultado;
  try { resultado = medir({ repo, base }); }
  catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; return; }
  const { mudancas, julgamento } = resultado;
  console.log(`[${NOME}] base ${base} · ${mudancas.length} arquivo(s) de teste mudado(s) no diff`);
  if (julgamento.ok) { console.log(`[${NOME}] ✅ nenhum arquivo de teste perdeu casos (catraca intacta).`); process.exitCode = 0; return; }
  for (const p of julgamento.problemas) console.error(`[${NOME}] FALHA (${p.tipo}): ${p.arquivo} — ${p.detalhe}`);
  console.error(`[${NOME}] COMO PASSAR: (1) mantenha os casos — renomear/reescrever não reduz o total; (2) se o comportamento saiu MESMO (feature removida) ou você MOVEU os casos pra outro arquivo, escreva um comentário \`// ${MARCADOR_OPTOUT}: <motivo>\` NO arquivo (pra deleção total, deixe um tombstone: arquivo com só esse comentário) — o auditor lê o motivo no diff. NUNCA use --no-verify.`);
  console.error(`[${NOME}] POR QUE EXISTE: teste apagado esconde regressão — a suite fica verde sem checar o que quebrou.`);
  process.exitCode = 1;
}

// ─── contra-prova com repo git REAL ──────────────────────────────────────────
const testeFonte = (n) => `import test from 'node:test';\nimport assert from 'node:assert/strict';\n${Array.from({ length: n }, (_, k) => `test('t${k}', () => { assert.ok(true); });`).join('\n')}\n`;

function repoComTeste(nCasosBase) {
  const dir = mkdtempSync(join(tmpdir(), 'tc-self-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  mkdirSync(join(dir, 'tests'), { recursive: true }); mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'tests', 'soma.test.mjs'), testeFonte(nCasosBase));
  writeFileSync(join(dir, 'src', 'soma.mjs'), 'export const soma = (a, b) => a + b;\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']); g(['branch', 'base']);
  return { dir, g, teste: join(dir, 'tests', 'soma.test.mjs'), fonte: join(dir, 'src', 'soma.mjs') };
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── funções puras ──
  check('contarTestes: conta test() e it()', contarTestes("test('a',()=>{}); it('b',()=>{});") === 2);
  check('contarTestes: pega test.only/it.skip/test.each', contarTestes("test.only('a',()=>{}); it.skip('b',()=>{}); test.each([1])('c',()=>{});") === 3);
  check('contarTestes: describe NÃO conta (é grupo, não caso)', contarTestes("describe('g',()=>{ test('a',()=>{}); });") === 1);
  check('BYPASS (COMENTÁRIO/STRING): test( em comentário/string não conta (despido)', contarTestes("// test('x',()=>{})\nconst s='it(y)';\ntest('real',()=>{});") === 1);
  check('julgar: casos caíram → testes-removidos', julgar([{ arquivo: 't', fonteBase: testeFonte(3), fonteHead: testeFonte(2) }]).problemas.some((p) => p.tipo === 'testes-removidos'));
  check('julgar: mais casos → ok', julgar([{ arquivo: 't', fonteBase: testeFonte(3), fonteHead: testeFonte(4) }]).ok === true);
  check('julgar: mesmo nº → ok', julgar([{ arquivo: 't', fonteBase: testeFonte(3), fonteHead: testeFonte(3) }]).ok === true);
  check('julgar: teste NOVO (sem base) → ok', julgar([{ arquivo: 't', fonteBase: '', fonteHead: testeFonte(2) }]).ok === true);
  check('temOptOut: com o marcador → true; sem → false', temOptOut('// ' + MARCADOR_OPTOUT + ': x\n' + testeFonte(1)) === true && temOptOut(testeFonte(1)) === false);
  check('julgar: casos caíram MAS com opt-out no head → ok (redução declarada)', julgar([{ arquivo: 't', fonteBase: testeFonte(3), fonteHead: '// ' + MARCADOR_OPTOUT + '\n' + testeFonte(1) }]).ok === true);
  check('RE_TESTE: casa .test.mjs/.spec.ts, não casa fonte comum', RE_TESTE.test('tests/soma.test.mjs') && RE_TESTE.test('a/b.spec.ts') && !RE_TESTE.test('src/soma.mjs'));
  check('RE_TESTE (HOLE 3): amplo — .tests. plural e __tests__/ dir; não casa fonte/doc', RE_TESTE.test('a/foo.tests.js') && RE_TESTE.test('pkg/__tests__/foo.mjs') && RE_TESTE.test('__tests__/deep/bar.ts') && !RE_TESTE.test('src/soma.mjs') && !RE_TESTE.test('README.md'));

  // ── STACK (R6, 2026-09-11): teste Python — contarTestesPython/RE_TESTE_PY/despirPython ──
  check('RE_TESTE_PY: casa test_*.py, *_test.py e qualquer .py sob tests/; não casa fonte comum', RE_TESTE_PY.test('test_soma.py') && RE_TESTE_PY.test('soma_test.py') && RE_TESTE_PY.test('tests/unit/test_soma.py') && RE_TESTE_PY.test('tests/helpers.py') && !RE_TESTE_PY.test('src/soma.py'));
  check('contarTestesPython: conta def test_ e async def test_', contarTestesPython('def test_a():\n    pass\nasync def test_b():\n    pass\n') === 2);
  check('contarTestesPython: método de classe Test... conta igual (mesmo token def test_)', contarTestesPython('class TestSoma:\n    def test_soma(self):\n        pass\n    def test_subtracao(self):\n        pass\n') === 2);
  check('BYPASS (COMENTÁRIO/STRING) Python: def test_ em comentário "#" ou string não conta', contarTestesPython('# def test_fantasma():\n s = "def test_outro():"\ndef test_real():\n    pass\n') === 1);
  check('contarTestesPython: def helper_test_algo (nome não começa com test_) não conta', contarTestesPython('def helper_test_algo():\n    pass\n') === 0);
  check('temOptOut Python: comentário "#" com o marcador isenta igual ao "//"', temOptOut('# catraca-reduz-de-proposito: movi pra outro arquivo\ndef test_a():\n    pass\n') === true);
  check('julgar (Python): casos caíram (2→1) sem opt-out → testes-removidos', julgar([{ arquivo: 'tests/test_soma.py', fonteBase: 'def test_a():\n    pass\ndef test_b():\n    pass\n', fonteHead: 'def test_a():\n    pass\n' }]).problemas.some((p) => p.tipo === 'testes-removidos'));
  check('julgar (Python): reduzir COM opt-out → ok', julgar([{ arquivo: 'tests/test_soma.py', fonteBase: 'def test_a():\n    pass\ndef test_b():\n    pass\n', fonteHead: '# catraca-reduz-de-proposito: motivo\ndef test_a():\n    pass\n' }]).ok === true);

  // ── repo git REAL ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (cwd, args) => spawnSync(process.execPath, [meu, ...args], { cwd, encoding: 'utf8', timeout: 120_000, env: { ...envSemGit(), npm_lifecycle_event: '' } }).status;
  let t;
  try {
    t = repoComTeste(3);
    const { dir, g, teste, fonte } = t;
    writeFileSync(teste, testeFonte(2)); g(['add', '-A']); g(['commit', '-q', '-m', 'apagou 1 teste']);
    check('REPO REAL: teste perdeu 1 caso vs base → testes-removidos', medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'testes-removidos'));
    check('PORTA: testes caíram → exit 1', porta(dir, ['--base', 'base']) === 1);
    writeFileSync(teste, testeFonte(4)); g(['add', '-A']); g(['commit', '-q', '-m', 'mais testes']);
    check('REPO REAL: teste ganhou casos → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: sem regressão → exit 0', porta(dir, ['--base', 'base']) === 0);
    // diff só de FONTE (sem teste no diff) → ok
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'sofonte']); writeFileSync(fonte, 'export const soma = (a, b) => a + b; // tweak\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'so fonte']);
    check('REPO REAL: diff só de fonte (nenhum teste mudado) → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    // HOLE 4: deletar o arquivo de teste INTEIRO → head 0 casos → testes-removidos (a regressão mais silenciosa)
    const tDel = repoComTeste(3);
    try {
      rmSync(tDel.teste); tDel.g(['add', '-A']); tDel.g(['commit', '-q', '-m', 'deletou o arquivo de teste']);
      check('HOLE 4: deletar o arquivo de teste inteiro → testes-removidos', medir({ repo: tDel.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'testes-removidos'));
      check('HOLE 4 PORTA: deletar o arquivo → exit 1', porta(tDel.dir, ['--base', 'base']) === 1);
    } finally { try { rmSync(tDel.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
    // HOLE 1: rename-aware. (a) rename+reduz → reprova; (b) rename PURO (mesmos casos) → ok (sem falso-positivo de deleção)
    const tRen = repoComTeste(4);
    try {
      tRen.g(['mv', 'tests/soma.test.mjs', 'tests/soma-renomeado.test.mjs']);
      writeFileSync(join(tRen.dir, 'tests', 'soma-renomeado.test.mjs'), testeFonte(2));
      tRen.g(['add', '-A']); tRen.g(['commit', '-q', '-m', 'rename + tirou testes']);
      check('HOLE 1a: renomear escondendo perda (4→2) → testes-removidos', medir({ repo: tRen.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'testes-removidos'));
    } finally { try { rmSync(tRen.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
    const tRenOk = repoComTeste(4);
    try {
      tRenOk.g(['mv', 'tests/soma.test.mjs', 'tests/soma-renomeado.test.mjs']);
      tRenOk.g(['add', '-A']); tRenOk.g(['commit', '-q', '-m', 'rename puro']);
      check('HOLE 1b: rename puro (4→4) → ok (rename-aware, sem falso-positivo)', medir({ repo: tRenOk.dir, base: 'base' }).julgamento.ok === true);
    } finally { try { rmSync(tRenOk.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
    // HOLE 5: reduzir COM o opt-out explícito → ok (split/mover casos; o marcador fica no diff pro auditor)
    const tOpt = repoComTeste(3);
    try {
      writeFileSync(tOpt.teste, `// ${MARCADOR_OPTOUT}: movi 2 casos pra outro arquivo\n` + testeFonte(1));
      tOpt.g(['add', '-A']); tOpt.g(['commit', '-q', '-m', 'reduz com opt-out']);
      check('HOLE 5: reduzir (3→1) COM opt-out → ok; sem opt-out reprovaria', medir({ repo: tOpt.dir, base: 'base' }).julgamento.ok === true);
    } finally { try { rmSync(tOpt.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
    check('PORTA: fora de repositório git → exit 2', porta(tmpdir(), ['--base', 'base']) === 2);
    check('PORTA: base inexistente → exit 2', porta(dir, ['--base', 'nao-existe-de-verdade']) === 2);
    check('PORTA: sem --base → exit 2', porta(dir, []) === 2);
  } catch (e) {
    check(`REPO REAL: montagem falhou (${e?.message || e})`, false);
  } finally {
    if (t) { try { rmSync(t.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }

  // ── STACK (R6, 2026-09-11): repo git REAL com teste Python — a catraca também pega perda em .py ──
  let tPy;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'tc-py-self-'));
    const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
    g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
    mkdirSync(join(dir, 'tests'), { recursive: true });
    const testePy = join(dir, 'tests', 'test_soma.py');
    writeFileSync(testePy, 'def test_a():\n    pass\n\n\ndef test_b():\n    pass\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'base']); g(['branch', 'base']);
    tPy = { dir, g, testePy };
    writeFileSync(testePy, 'def test_a():\n    pass\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'apagou 1 teste python']);
    check('STACK REPO REAL (Python): perdeu 1 caso vs base → testes-removidos', medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'testes-removidos'));
    check('STACK PORTA (Python): perda de caso → exit 1', porta(dir, ['--base', 'base']) === 1);
    writeFileSync(testePy, 'def test_a():\n    pass\ndef test_b():\n    pass\ndef test_c():\n    pass\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'mais testes python']);
    check('STACK PORTA (Python): ganhou casos → exit 0', porta(dir, ['--base', 'base']) === 0);
  } catch (e) {
    check(`STACK REPO REAL (Python): montagem falhou (${e?.message || e})`, false);
  } finally {
    if (tPy) { try { rmSync(tPy.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
