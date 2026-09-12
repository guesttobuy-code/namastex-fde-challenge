/**
 * Suíte de self-test do guard `changelog-update` (dono do julgamento: scripts/guards/changelog-update.mjs
 * — este arquivo só carrega os casos, fixtures e helpers de teste; PASSO 3b da reestruturação, guard
 * passou de 600 linhas visuais). O guard importa este módulo dinamicamente em `--self-test`
 * ('./selftest/changelog-update.mjs'), então a PORTA pública continua sendo
 * `node scripts/guards/changelog-update.mjs --self-test`, com a mesma saída e o mesmo exit de sempre.
 *
 * `meu` (o caminho do guard usado pelos casos PORTA-como-processo) é calculado a partir do PRÓPRIO
 * import.meta.url deste arquivo — não de process.argv — porque a prova-de-vida copia a árvore `scripts/`
 * inteira para um tmpdir e muta só a cópia do guard: como este companheiro é copiado junto e fica no
 * MESMO lugar relativo (`selftest/` ao lado do guard), o caminho computado aponta pro guard MUTADO da
 * cópia, não pro original — é assim que a mutação é exercitada de verdade.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../../lib/guard-doctrine.mjs';
import { envSemGit } from '../../lib/git-base.mjs';
import {
  NOME, CHANGELOG_PATH, ehCodigoNaoTeste, ehLinhaBulletComReferencia,
  linhasDespidas, linhasGenuinamenteNovas, julgar, medir,
} from '../changelog-update.mjs';

// ─── contra-prova com repo git REAL ──────────────────────────────────────────
function repoBase() {
  const dir = mkdtempSync(join(tmpdir(), 'cu-self-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'x.mjs'), 'export const x = 1;\n');
  writeFileSync(join(dir, CHANGELOG_PATH), '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n');
  writeFileSync(join(dir, 'README.md'), 'doc\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']); g(['branch', 'base']);
  return { dir, g, x: join(dir, 'src', 'x.mjs'), changelog: join(dir, CHANGELOG_PATH), readme: join(dir, 'README.md') };
}

/** Repo git "cru" (sem o fixture de repoBase) num tmpdir — usado pelos cenários que precisam controlar
 *  o conteúdo da base do zero (ex.: base com HISTORY.md em vez de CHANGELOG.md). */
function repoCru() {
  const dir = mkdtempSync(join(tmpdir(), 'cu-cru-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  return { dir, g };
}

/** Roda a suíte inteira e devolve o exit code (relatarSelfTest da lib) — o guard atribui isto a
 *  `process.exitCode`; esta função nunca mexe em process.exitCode diretamente (dono é o guard). */
export function rodarSelfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const limpar = (dir) => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } };

  // ── funções puras: ehCodigoNaoTeste ──
  check('ehCodigoNaoTeste: arquivo .mjs comum → true', ehCodigoNaoTeste('src/x.mjs') === true);
  check('ehCodigoNaoTeste: arquivo .test.mjs não conta (é teste)', ehCodigoNaoTeste('src/x.test.mjs') === false);
  check('ehCodigoNaoTeste: sob __tests__/ não conta', ehCodigoNaoTeste('src/__tests__/y.mjs') === false);
  check('ehCodigoNaoTeste: .md não é código → false', ehCodigoNaoTeste('README.md') === false);
  check('PATH: extensão em CAIXA ALTA ainda conta como código', ehCodigoNaoTeste('src/X.MJS') === true);
  check('VAZIO/NULO: caminho vazio/undefined → false, não quebra', ehCodigoNaoTeste('') === false && ehCodigoNaoTeste(undefined) === false);
  check('CU-7: ehCodigoNaoTeste reconhece .ps1 como código', ehCodigoNaoTeste('scripts/abrir.ps1') === true);
  check('CU-7: ehCodigoNaoTeste reconhece .psm1 como código', ehCodigoNaoTeste('scripts/lib/Esteira.psm1') === true);
  check('CU-7: ehCodigoNaoTeste reconhece .sh como código', ehCodigoNaoTeste('scripts/algo.sh') === true);
  check('CU-7: ehCodigoNaoTeste reconhece .py como código', ehCodigoNaoTeste('scripts/algo.py') === true);
  check('CU-7: ehCodigoNaoTeste reconhece hook sem extensão sob .githooks/ como código', ehCodigoNaoTeste('.githooks/pre-commit') === true);
  check('CU-7: hook sob .githooks/ NÃO vira código se casar RE_TESTE (coerência com a mesma exceção)', ehCodigoNaoTeste('.githooks/algo.test.mjs') === false);

  // ── funções puras: ehLinhaBulletComReferencia ──
  check('ehLinhaBulletComReferencia: bullet "- " com #N → true', ehLinhaBulletComReferencia('- corrigiu bug (#42)') === true);
  check('ehLinhaBulletComReferencia: bullet "* " com #N → true', ehLinhaBulletComReferencia('* corrigiu bug (#42)') === true);
  check('ehLinhaBulletComReferencia: texto com #N mas SEM bullet → false (prosa não é entrada)', ehLinhaBulletComReferencia('corrigiu bug (#42)') === false);
  check('ehLinhaBulletComReferencia: bullet SEM #N → false', ehLinhaBulletComReferencia('- corrigiu bug sem numero') === false);
  check('INVISÍVEL: CRLF residual (\\r) não escapa a checagem → true', ehLinhaBulletComReferencia('- corrigiu bug (#7)\r') === true);
  check('VAZIO/NULO: linha vazia/undefined → false', ehLinhaBulletComReferencia('') === false && ehLinhaBulletComReferencia(undefined) === false);
  check('CU-6: bullet "+" (3º marcador CommonMark válido) com #N conta como entrada', ehLinhaBulletComReferencia('+ corrigiu bug (#6)') === true);
  check('CU-6: lista numerada "1. " com #N conta como entrada', ehLinhaBulletComReferencia('1. corrigiu bug (#7)') === true);
  check('CU-6: lista numerada "2) " com #N conta como entrada', ehLinhaBulletComReferencia('2) corrigiu bug (#8)') === true);
  check('CU-6: "1.5 texto (#9)" (decimal, não lista) → false (não confunde com marcador numerado)', ehLinhaBulletComReferencia('1.5 texto (#9)') === false);
  // Fixado nesta reestruturação (dado do teste, não lógica — nome do caso preservado, invariante
  // PASSO 3c): a string original era '- nbsp (#11)' — a palavra "nbsp" digitada por extenso, sem
  // NENHUM caractere U+00A0 real; como "- " ali é um espaço ASCII comum, a linha CASAVA como bullet
  // válido (RE_BULLET) e o caso falhava (esperava false, RE_BULLET devolvia true) — decorativo
  // (prometia testar NBSP, testava outra coisa; mesma classe do achado CU-8 original). A defesa em si
  // (RE_BULLET = /^(?:[-*+]|\d+[.)])[ \t]/, só ASCII) já era genuína — REPLAY independente confirmou
  // com um NBSP de verdade fora desta suíte (repo git isolado, ver relatório da reconciliação).
  // Consertado aqui com escape \u00A0 explícito (não byte invisível cru — não repete o modo de falha).
  check(
    'BYPASS (CU-2, extra — NBSP): bullet com NBSP (U+00A0) depois do marcador NÃO conta (RE_BULLET'
      + ' exige espaço/tab ASCII)',
    ehLinhaBulletComReferencia('-\u00A0nbsp (#11)') === false,
  );

  // ── funções puras: linhasDespidas / linhasGenuinamenteNovas (repurposam os antigos slots de
  //    "linhasAdicionadasDoDiff", removida nesta reconciliação — a extração de "+" do git diff foi
  //    trocada por confronto de conteúdo, ver O QUE FAZ) ──
  check('linhasDespidas: remove \\r residual da linha (CRLF do Windows)', linhasDespidas('- a (#1)\r\n- b (#2)\r\n').every((l) => !l.includes('\r')));
  check('linhasDespidas: apaga o conteúdo de um comentário HTML preservando nº de linha', (() => {
    const ls = linhasDespidas('- a (#1)\n<!--\n- fantasma (#2)\n-->\n- c (#3)\n');
    return ls.length === 6 && ls[0] === '- a (#1)' && !/fantasma/.test(ls.join('\n')) && ls[4] === '- c (#3)';
  })());
  check(
    'linhasGenuinamenteNovas: linha vazia nunca conta como "nova" (não polui o multiset)',
    linhasGenuinamenteNovas(['', '- a (#1)'], ['', '', '- a (#1)']).length === 0,
  );
  check(
    'linhasGenuinamenteNovas: reordenar as mesmas duas linhas → zero linhas novas (fecha CU-1/A2)',
    linhasGenuinamenteNovas(['- a (#1)', '- b (#2)'], ['- b (#2)', '- a (#1)']).length === 0,
  );
  check(
    'linhasGenuinamenteNovas: espaço a mais no fim de uma linha existente → zero linhas novas'
      + ' (fecha CU-1/A1)',
    linhasGenuinamenteNovas(['- a (#1)'], ['- a (#1) ']).length === 0,
  );
  check(
    'linhasGenuinamenteNovas: MULTISET — repetir uma linha que só existia 1x na base conta'
      + ' a 2ª cópia como nova',
    linhasGenuinamenteNovas(['- a (#1)'], ['- a (#1)', '- a (#1)']).length === 1,
  );
  check(
    'linhasGenuinamenteNovas: linha de verdade nova sobra depois do multiset',
    linhasGenuinamenteNovas(['- a (#1)'], ['- a (#1)', '- nova (#9)'])[0] === '- nova (#9)',
  );

  // ── julgar: função pura ──
  check('julgar (VAZIO): sem código no diff → aplicavel false, ok true (não é "aprovar por não ter o que reprovar")',
    julgar({ arquivosCodigo: [], changelogTocado: false, linhasNovas: [] }).aplicavel === false &&
    julgar({ arquivosCodigo: [], changelogTocado: false, linhasNovas: [] }).ok === true);
  check('BYPASS: código mudou, CHANGELOG não tocado → changelog-ausente',
    julgar({ arquivosCodigo: ['src/x.mjs'], changelogTocado: false, linhasNovas: [] }).problemas.some((p) => p.tipo === 'changelog-ausente'));
  check(
    'BYPASS: código mudou, CHANGELOG tocado mas linha nova sem #N → entrada-sem-referencia',
    julgar({
      arquivosCodigo: ['src/x.mjs'], changelogTocado: true, linhasNovas: ['- sem referencia aqui'],
    }).problemas.some((p) => p.tipo === 'entrada-sem-referencia'),
  );
  check('NUNCA BLOQUEIA: código mudou, CHANGELOG tocado com bullet+#N novo → ok',
    julgar({ arquivosCodigo: ['src/x.mjs'], changelogTocado: true, linhasNovas: ['- com ref (#3)'] }).ok === true);
  check('NULO: campos undefined → trata como vazio, não quebra',
    julgar({ changelogTocado: false }).ok === true && julgar().ok === true);

  // ── repo git REAL (via medir + PORTA como processo) ──
  const meu = fileURLToPath(new URL('../changelog-update.mjs', import.meta.url));
  const porta = (cwd, args) => spawnSync(
    process.execPath, [meu, ...args],
    { cwd, encoding: 'utf8', timeout: 120_000, env: { ...envSemGit(), npm_lifecycle_event: '' } },
  ).status;
  let t;
  try {
    t = repoBase();
    check('REPO REAL: recém-criado, HEAD === base → sem diff → NAO_APLICAVEL (ok)', medir({ repo: t.dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: sem diff nenhum → exit 0', porta(t.dir, ['--base', 'base']) === 0);

    // BYPASS 1: código muda sem tocar CHANGELOG
    const t1 = repoBase();
    try {
      writeFileSync(t1.x, 'export const x = 2;\n'); t1.g(['add', '-A']); t1.g(['commit', '-q', '-m', 'muda codigo sem changelog']);
      check(
        'REPO REAL — BYPASS: código muda sem tocar CHANGELOG.md → changelog-ausente',
        medir({ repo: t1.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'changelog-ausente'),
      );
      check('PORTA — BYPASS: changelog ausente → exit 1', porta(t1.dir, ['--base', 'base']) === 1);
    } finally { limpar(t1.dir); }

    // BYPASS 2: toca CHANGELOG mas linha nova sem #N
    const t2 = repoBase();
    try {
      writeFileSync(t2.x, 'export const x = 3;\n');
      writeFileSync(t2.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n- mudou algo sem citar issue\n');
      t2.g(['add', '-A']); t2.g(['commit', '-q', '-m', 'muda codigo e changelog sem referencia']);
      check(
        'REPO REAL — BYPASS: CHANGELOG mudou mas linha nova sem #N → entrada-sem-referencia',
        medir({ repo: t2.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'entrada-sem-referencia'),
      );
      check('PORTA — BYPASS: entrada sem referência → exit 1', porta(t2.dir, ['--base', 'base']) === 1);
    } finally { limpar(t2.dir); }

    // NUNCA BLOQUEIA 1: código + CHANGELOG com bullet+#N → ok
    const t3 = repoBase();
    try {
      writeFileSync(t3.x, 'export const x = 4;\n');
      writeFileSync(t3.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n- corrigiu Y (#12)\n');
      t3.g(['add', '-A']); t3.g(['commit', '-q', '-m', 'muda codigo e changelog com referencia']);
      check('REPO REAL — NUNCA BLOQUEIA: código + CHANGELOG com bullet e #N novo → ok', medir({ repo: t3.dir, base: 'base' }).julgamento.ok === true);
      check('PORTA — NUNCA BLOQUEIA: com referência → exit 0', porta(t3.dir, ['--base', 'base']) === 0);
    } finally { limpar(t3.dir); }

    // NUNCA BLOQUEIA 2: só doc muda
    const t4 = repoBase();
    try {
      writeFileSync(t4.readme, 'doc mudou\n'); t4.g(['add', '-A']); t4.g(['commit', '-q', '-m', 'so doc']);
      const j4 = medir({ repo: t4.dir, base: 'base' }).julgamento;
      check('REPO REAL — NUNCA BLOQUEIA: diff só de doc → NAO_APLICAVEL', j4.aplicavel === false && j4.ok === true);
      check('PORTA — NUNCA BLOQUEIA: só doc muda → exit 0', porta(t4.dir, ['--base', 'base']) === 0);
    } finally { limpar(t4.dir); }

    // NUNCA BLOQUEIA 3: só teste muda (arquivo novo de teste)
    const t5 = repoBase();
    try {
      writeFileSync(join(t5.dir, 'src', 'x.test.mjs'), "import test from 'node:test';\ntest('a', () => {});\n");
      t5.g(['add', '-A']); t5.g(['commit', '-q', '-m', 'so teste']);
      const j5 = medir({ repo: t5.dir, base: 'base' }).julgamento;
      check('REPO REAL — NUNCA BLOQUEIA: diff só de teste → NAO_APLICAVEL', j5.aplicavel === false && j5.ok === true);
      check('PORTA — NUNCA BLOQUEIA: só teste muda → exit 0', porta(t5.dir, ['--base', 'base']) === 0);
    } finally { limpar(t5.dir); }

    // ÍNDICE (staged, não-commitado) conta — "mais o índice se houver"
    const t6 = repoBase();
    try {
      writeFileSync(t6.x, 'export const x = 5;\n'); t6.g(['add', '-A']); t6.g(['commit', '-q', '-m', 'muda codigo sem changelog ainda']);
      writeFileSync(t6.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n- staged com referencia (#99)\n');
      t6.g(['add', CHANGELOG_PATH]); // só STAGED — sem commit
      check('REPO REAL: CHANGELOG só STAGED (índice) com referência já conta → ok', medir({ repo: t6.dir, base: 'base' }).julgamento.ok === true);
      check('PORTA: staged com referência conta → exit 0', porta(t6.dir, ['--base', 'base']) === 0);
    } finally { limpar(t6.dir); }

    // BANCA: RENOMEAR — renomear arquivo de código sem tocar CHANGELOG continua reprovando
    const t7 = repoBase();
    try {
      t7.g(['mv', 'src/x.mjs', 'src/y.mjs']); t7.g(['commit', '-q', '-m', 'renomeia codigo sem tocar changelog']);
      check(
        'BANCA RENOMEAR: renomear arquivo de código sem tocar CHANGELOG → changelog-ausente',
        medir({ repo: t7.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'changelog-ausente'),
      );
    } finally { limpar(t7.dir); }

    // BANCA: RENOMEAR — renomear CHANGELOG.md PARA FORA (deleção disfarçada) continua reprovando
    const t8 = repoBase();
    try {
      writeFileSync(t8.x, 'export const x = 6;\n');
      t8.g(['mv', CHANGELOG_PATH, 'CHANGELOG.old.md']); t8.g(['add', '-A']); t8.g(['commit', '-q', '-m', 'muda codigo e renomeia changelog pra fora']);
      check(
        'BANCA RENOMEAR: CHANGELOG.md renomeado PARA FORA (não é mais CHANGELOG.md) → changelog-ausente',
        medir({ repo: t8.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'changelog-ausente'),
      );
    } finally { limpar(t8.dir); }

    // CU-8: cenário REAL (antes decorativo — duplicava "sem diff nenhum") — git rm de um arquivo de
    // TESTE que já existia na BASE (não só criado no próprio diff) → continua NAO_APLICAVEL.
    const t10 = repoBase();
    try {
      writeFileSync(join(t10.dir, 'src', 'x.test.mjs'), "import test from 'node:test';\ntest('a', () => {});\n");
      t10.g(['add', '-A']); t10.g(['commit', '-q', '-m', 'base ganha um teste']);
      t10.g(['branch', '-f', 'base']); // avança 'base' pra incluir o teste — ele já EXISTIA na base
      t10.g(['rm', '-q', 'src/x.test.mjs']); t10.g(['commit', '-q', '-m', 'remove teste que ja existia na base']);
      const j10 = medir({ repo: t10.dir, base: 'base' }).julgamento;
      check('CU-8: remover (git rm) um teste que JÁ EXISTIA na base → ainda NAO_APLICAVEL, não exige CHANGELOG', j10.aplicavel === false && j10.ok === true);
      check('PORTA — CU-8: git rm de teste pré-existente na base → exit 0', porta(t10.dir, ['--base', 'base']) === 0);
    } finally { limpar(t10.dir); }

    // CU-2: entrada "fantasma" dentro de comentário HTML <!-- --> não conta como entrada válida
    const t11 = repoBase();
    try {
      writeFileSync(t11.x, 'export const x = 7;\n');
      writeFileSync(t11.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n<!--\n- fantasma (#77)\n-->\n');
      t11.g(['add', '-A']); t11.g(['commit', '-q', '-m', 'muda codigo e so muda comentario no changelog']);
      check(
        'BYPASS (CU-2): entrada dentro de comentário HTML <!-- --> não conta → entrada-sem-referencia',
        medir({ repo: t11.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'entrada-sem-referencia'),
      );
      check('PORTA — BYPASS CU-2 (comentário HTML) → exit 1', porta(t11.dir, ['--base', 'base']) === 1);
    } finally { limpar(t11.dir); }

    // CU-2: entrada dentro de cerca de código ``` não conta
    const t12 = repoBase();
    try {
      writeFileSync(t12.x, 'export const x = 8;\n');
      writeFileSync(t12.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n```\n- fantasma (#78)\n```\n');
      t12.g(['add', '-A']); t12.g(['commit', '-q', '-m', 'muda codigo e so muda cerca no changelog']);
      check(
        'BYPASS (CU-2): entrada dentro de cerca de código ``` não conta → entrada-sem-referencia',
        medir({ repo: t12.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'entrada-sem-referencia'),
      );
      check('PORTA — BYPASS CU-2 (cerca de código) → exit 1', porta(t12.dir, ['--base', 'base']) === 1);
    } finally { limpar(t12.dir); }

    // CU-6 (I): config de cor do autor (color.diff/color.ui=always) não quebra mais o parse — o
    // conteúdo vem de `git show`, nunca de `git diff`.
    const t13 = repoBase();
    try {
      t13.g(['config', 'color.diff', 'always']); t13.g(['config', 'color.ui', 'always']);
      writeFileSync(t13.x, 'export const x = 9;\n');
      writeFileSync(t13.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n- legit (#8)\n');
      t13.g(['add', '-A']); t13.g(['commit', '-q', '-m', 'com color.diff sempre ligado']);
      check(
        'BYPASS (CU-6, I): color.diff/color.ui=always no repo do autor não quebra o parse'
          + ' → aprova entrada legítima',
        medir({ repo: t13.dir, base: 'base' }).julgamento.ok === true,
      );
      check('PORTA — CU-6 (I): com cor sempre ligada → exit 0', porta(t13.dir, ['--base', 'base']) === 0);
    } finally { limpar(t13.dir); }

    // CU-7: PR muda .ps1 e .githooks/pre-commit (sem CHANGELOG) → agora É cobrado
    const t14 = repoBase();
    try {
      mkdirSync(join(t14.dir, 'scripts'), { recursive: true });
      writeFileSync(join(t14.dir, 'scripts', 'abrir.ps1'), 'Remove-Item -Recurse -Force .\n');
      mkdirSync(join(t14.dir, '.githooks'), { recursive: true });
      writeFileSync(join(t14.dir, '.githooks', 'pre-commit'), '#!/bin/sh\nexit 0\n');
      t14.g(['add', '-A']); t14.g(['commit', '-q', '-m', 'muda ps1 e hook sem changelog']);
      check(
        'BYPASS (CU-7): PR muda .ps1 e .githooks/pre-commit sem CHANGELOG → changelog-ausente'
          + ' (antes era NAO_APLICAVEL)',
        medir({ repo: t14.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'changelog-ausente'),
      );
      check('PORTA — BYPASS CU-7 (.ps1 + hook sem CHANGELOG) → exit 1', porta(t14.dir, ['--base', 'base']) === 1);
    } finally { limpar(t14.dir); }

    // CU-1, A1: espaço no fim de uma entrada ANTIGA não "empresta" aprovação
    const t15 = repoBase();
    try {
      writeFileSync(t15.x, 'export const x = 10;\n');
      writeFileSync(t15.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1) \n'); // só espaço no fim da linha existente
      t15.g(['add', '-A']); t15.g(['commit', '-q', '-m', 'so espaco no fim de entrada velha']);
      check(
        'BYPASS (CU-1, A1): espaço no fim de entrada ANTIGA não empresta aprovação → entrada-sem-referencia',
        medir({ repo: t15.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'entrada-sem-referencia'),
      );
      check('PORTA — BYPASS CU-1 A1 (espaço no fim) → exit 1', porta(t15.dir, ['--base', 'base']) === 1);
    } finally { limpar(t15.dir); }

    // CU-1, A2: só REORDENAR entradas existentes não "empresta" aprovação
    const t17 = repoCru();
    try {
      mkdirSync(join(t17.dir, 'src'), { recursive: true });
      writeFileSync(join(t17.dir, 'src', 'x.mjs'), 'export const x = 1;\n');
      writeFileSync(join(t17.dir, CHANGELOG_PATH), '# Changelog\n\n## [Unreleased]\n- a (#1)\n- b (#2)\n');
      t17.g(['add', '-A']); t17.g(['commit', '-q', '-m', 'base com duas entradas']); t17.g(['branch', 'base']);
      writeFileSync(join(t17.dir, 'src', 'x.mjs'), 'export const x = 2;\n');
      writeFileSync(join(t17.dir, CHANGELOG_PATH), '# Changelog\n\n## [Unreleased]\n- b (#2)\n- a (#1)\n'); // só REORDENOU
      t17.g(['add', '-A']); t17.g(['commit', '-q', '-m', 'so reordena entradas existentes']);
      check(
        'BYPASS (CU-1, A2): só REORDENAR entradas existentes não empresta aprovação → entrada-sem-referencia',
        medir({ repo: t17.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'entrada-sem-referencia'),
      );
      check('PORTA — BYPASS CU-1 A2 (reordenar) → exit 1', porta(t17.dir, ['--base', 'base']) === 1);
    } finally { limpar(t17.dir); }

    // CU-1, A3: renomear HISTORY.md → CHANGELOG.md carregando um bullet velho não "empresta" aprovação
    const t18 = repoCru();
    try {
      mkdirSync(join(t18.dir, 'src'), { recursive: true });
      writeFileSync(join(t18.dir, 'src', 'x.mjs'), 'export const x = 1;\n');
      writeFileSync(join(t18.dir, 'HISTORY.md'), '- velho (#1)\n');
      t18.g(['add', '-A']); t18.g(['commit', '-q', '-m', 'base com HISTORY.md']); t18.g(['branch', 'base']);
      writeFileSync(join(t18.dir, 'src', 'x.mjs'), 'export const x = 2;\n');
      t18.g(['mv', 'HISTORY.md', CHANGELOG_PATH]);
      t18.g(['add', '-A']); t18.g(['commit', '-q', '-m', 'rename HISTORY para CHANGELOG + muda codigo, sem entrada nova']);
      check(
        'BYPASS (CU-1, A3): renomear HISTORY.md→CHANGELOG.md sem entrada NOVA não empresta aprovação',
        medir({ repo: t18.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'entrada-sem-referencia'),
      );
      check('PORTA — BYPASS CU-1 A3 (rename com conteúdo velho) → exit 1', porta(t18.dir, ['--base', 'base']) === 1);
    } finally { limpar(t18.dir); }

    // CU-3, C1: entrada COMMITADA, depois revertida SÓ NO ÍNDICE (mais código, sem commitar) → não empresta
    const t19 = repoBase();
    try {
      writeFileSync(t19.x, 'export const x = 11;\n');
      writeFileSync(t19.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n- nova (#5)\n');
      t19.g(['add', '-A']); t19.g(['commit', '-q', '-m', 'commit com entrada nova (#5)']);
      writeFileSync(t19.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n'); // STAGE: volta ao conteúdo da base
      writeFileSync(t19.x, 'export const x = 12;\n'); // mais código, também só staged
      t19.g(['add', '-A']); // sem commitar
      check(
        'BYPASS (CU-3, C1): CHANGELOG revertido SÓ NO ÍNDICE não empresta a entrada do commit anterior',
        medir({ repo: t19.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'entrada-sem-referencia'),
      );
      check('PORTA — BYPASS CU-3 C1 (revertido no índice) → exit 1', porta(t19.dir, ['--base', 'base']) === 1);
    } finally { limpar(t19.dir); }

    // CU-3, C2: entrada COMMITADA, depois o CHANGELOG.md inteiro é removido SÓ DO ÍNDICE
    const t20 = repoBase();
    try {
      writeFileSync(t20.x, 'export const x = 13;\n');
      writeFileSync(t20.changelog, '# Changelog\n\n## [Unreleased]\n- inicial (#1)\n- nova (#5)\n');
      t20.g(['add', '-A']); t20.g(['commit', '-q', '-m', 'commit com entrada nova (#5)']);
      t20.g(['rm', '--cached', '-q', CHANGELOG_PATH]); // DELETADO no índice, sem commitar
      const j20 = medir({ repo: t20.dir, base: 'base' }).julgamento;
      check(
        'BYPASS (CU-3, C2): CHANGELOG deletado no ÍNDICE (git rm --cached) → reprova',
        j20.problemas.some((p) => p.tipo === 'changelog-ausente' || p.tipo === 'entrada-sem-referencia'),
      );
      check('PORTA — BYPASS CU-3 C2 (deletado no índice) → exit 1', porta(t20.dir, ['--base', 'base']) === 1);
    } finally { limpar(t20.dir); }

    // CU-4: caminhos PORTA sem self-test dedicado — branch órfã (sem merge-base) e repo sem commit
    const t9 = repoBase();
    try {
      t9.g(['checkout', '-q', '--orphan', 'orfa']);
      t9.g(['commit', '-q', '-m', 'primeiro commit de uma branch sem historia comum com base']);
      check('PORTA — CU-4: branch órfã (sem merge-base com --base) → exit 2 (NÃO MEDIU)', porta(t9.dir, ['--base', 'base']) === 2);
    } finally { limpar(t9.dir); }

    const dirVazio = mkdtempSync(join(tmpdir(), 'cu-vazio-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dirVazio, stdio: 'ignore', env: envSemGit() });
      check('PORTA — CU-4: repo git sem NENHUM commit → NAO_APLICAVEL, exit 0', porta(dirVazio, ['--base', 'main']) === 0);
    } finally { limpar(dirVazio); }

    // CU-5: erro real do git (base que não existe) nunca vira "entrada-sem-referencia" (exit 1) — sai
    // pela PORTA de NÃO MEDIU (exit 2). Não sobrou try/catch supérfluo mascarando isso (ver certidão).
    check(
      'CU-5: erro real do git (base inexistente) → NÃO MEDIU (exit 2), nunca reprovação disfarçada'
        + ' (exit 1)',
      porta(t.dir, ['--base', 'nao-existe-de-verdade']) === 2,
    );

    // PORTA: casos-limite (pré-existentes)
    check('PORTA: fora de repositório git → exit 2', porta(tmpdir(), ['--base', 'base']) === 2);
    check('PORTA: base inexistente → exit 2', porta(t.dir, ['--base', 'nao-existe-de-verdade']) === 2);
    check('PORTA: sem --base → exit 2', porta(t.dir, []) === 2);
  } catch (e) {
    check(`REPO REAL: montagem falhou (${e?.message || e})`, false);
  } finally {
    if (t) limpar(t.dir);
  }
  return relatarSelfTest(NOME, casos);
}
