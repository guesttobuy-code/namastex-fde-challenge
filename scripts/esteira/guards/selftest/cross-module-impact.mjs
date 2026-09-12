#!/usr/bin/env node
/**
 * cross-module-impact/selftest.mjs — suíte de contra-prova do guard `cross-module-impact`.
 *
 * POR QUE ESTE ARQUIVO EXISTE (PASSO 3b da reconciliação R2, 2026-09-11): depois de quebrar as linhas
 * da certidão do guard em ~110 colunas (regra "linhas visuais" do coordenador), o guard sozinho passou
 * do teto de 600 linhas visuais. A suíte de self-test — fixtures, casos, helpers — é só CONTRA-PROVA,
 * não é a PORTA; sai pra cá. O guard continua sendo a PORTA: `node scripts/guards/cross-module-impact.mjs
 * --self-test` importa `selfTest` DAQUI dinamicamente (import relativo), com a mesma saída e o mesmo
 * exit code de antes da reconciliação.
 *
 * Importa as funções PURAS do guard por caminho relativo ('../cross-module-impact.mjs') e calcula o
 * caminho do PRÓPRIO guard a partir de `import.meta.url` (não do argv) — a prova-de-vida copia a árvore
 * `scripts/` inteira pra um tmp e muta só o guard; como este arquivo é copiado junto (mesma estrutura
 * relativa scripts/guards/selftest/), o import '../cross-module-impact.mjs' resolve pro guard MUTADO da
 * cópia, e os casos de PORTA (que spawnam esse mesmo caminho como processo) exercitam a mutação real.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../../lib/guard-doctrine.mjs';
import { envSemGit } from '../../lib/git-base.mjs';
import {
  NOME,
  MARCADOR_OPTOUT,
  acharModulosImpactados,
  ehTesteDoModulo,
  julgar,
  unirGrafos,
  medir,
} from '../cross-module-impact.mjs';

// Caminho do guard sendo testado, calculado do PRÓPRIO import.meta.url (não do argv) — assim a
// prova-de-vida, que copia toda a árvore scripts/ e muta só o guard, exercita a cópia MUTADA.
const CAMINHO_GUARD = fileURLToPath(new URL('../cross-module-impact.mjs', import.meta.url));

// ─── fixtures dos repos de self-test (LEI 11: fábrica comum) ─────────────────
const CFG_MODULOS = Object.freeze({
  modulos: { raiz: 'src/modules', barrel: ['index.mjs', 'index.js', 'index.ts', 'index.tsx'] },
  ignorar: ['node_modules/**', '**/*.test.*', '**/*.spec.*', 'tests/**', '**/__tests__/**'],
});

function repoGitVazio(prefixo) {
  const dir = mkdtempSync(join(tmpdir(), prefixo));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  return { dir, g };
}

// Repo git com `.arch-layers.json`=cfgArch + `arquivos` ({caminho: conteúdo}), commit "base" + branch
// `base` — fábrica comum dos repos de self-test (LEI 11).
function repoGitComArquivos(prefixo, arquivos, cfgArch) {
  const { dir, g } = repoGitVazio(prefixo);
  writeFileSync(join(dir, '.arch-layers.json'), JSON.stringify(cfgArch, null, 2));
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), conteudo);
  }
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']); g(['branch', 'base']);
  return { dir, g };
}

// repo venda (barrel reexporta venda-impl.mjs, que só IMPORTA venda-interno.mjs) + estoque (depende de
// venda) + relatorio (sem dependentes). venda-interno.mjs distingue "reexportado" (F5) de "nunca bloqueia".
function repoComModulos() {
  const { dir, g } = repoGitComArquivos('cmi-self-', {
    'src/modules/venda/venda-interno.mjs': 'export const formatarPreco = (v) => `R$ ${v}`;\n',
    'src/modules/venda/venda-impl.mjs': "import { formatarPreco } from './venda-interno.mjs';\nexport const venda = () => formatarPreco(1);\n",
    'src/modules/venda/index.mjs': "export { venda } from './venda-impl.mjs';\n",
    'src/modules/estoque/estoque.mjs': "import { venda } from '../venda/index.mjs';\nexport const estoque = () => venda();\n",
    'src/modules/estoque/estoque.test.mjs':
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
      "test('estoque ok', () => { assert.ok(true); });\n",
    'src/modules/relatorio/index.mjs': "export const relatorio = () => 'r';\n",
  }, CFG_MODULOS);
  return {
    dir, g,
    vendaBarrel: join(dir, 'src/modules/venda/index.mjs'),
    vendaImpl: join(dir, 'src/modules/venda/venda-impl.mjs'),
    vendaInterno: join(dir, 'src/modules/venda/venda-interno.mjs'),
    estoqueTeste: join(dir, 'src/modules/estoque/estoque.test.mjs'),
    relatorioBarrel: join(dir, 'src/modules/relatorio/index.mjs'),
  };
}

/** repo com `.arch-layers.json` SEM `modulos.raiz` (só `camadas` — como o próprio kit). */
function repoSemModulosRaiz() {
  const { dir, g } = repoGitComArquivos('cmi-nomod-', { 'a.mjs': 'export const x = 1;\n' }, { camadas: {} });
  writeFileSync(join(dir, 'a.mjs'), 'export const x = 2;\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'muda']);
  return dir;
}

/** repo com `.arch-layers.json` INVÁLIDO (JSON quebrado). */
function repoComArchInvalido() {
  const { dir, g } = repoGitVazio('cmi-badcfg-');
  writeFileSync(join(dir, '.arch-layers.json'), '{ isto nao eh json');
  writeFileSync(join(dir, 'a.mjs'), 'export const x = 1;\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']); g(['branch', 'base']);
  writeFileSync(join(dir, 'a.mjs'), 'export const x = 2;\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'muda']);
  return dir;
}

// F3: BASE já tem o opt-out (HERDADO); um commit seguinte remove o export real sem re-confirmar o
// marcador — opt-out não isenta pra sempre.
function repoComOptOutHerdado() {
  const { dir, g } = repoGitComArquivos('cmi-optout-', {
    'src/modules/venda/venda-impl.mjs': 'export const venda = () => 1;\n',
    'src/modules/venda/index.mjs': `// ${MARCADOR_OPTOUT}: mudanca antiga, so tipo\nexport { venda } from './venda-impl.mjs';\n`,
    'src/modules/estoque/estoque.mjs': "import { venda } from '../venda/index.mjs';\nexport const estoque = () => venda();\n",
    'src/modules/estoque/estoque.test.mjs':
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
      "test('estoque ok', () => { assert.ok(true); });\n",
  }, CFG_MODULOS);
  writeFileSync(join(dir, 'src/modules/venda/index.mjs'), `// ${MARCADOR_OPTOUT}: mudanca antiga, so tipo\nexport const outra = 1;\n`);
  g(['add', '-A']); g(['commit', '-q', '-m', 'F3: remove export venda do barrel, marcador so herdado']);
  return dir;
}

/** repo venda/estoque com `modulos.raiz` PARAMETRIZADO (F4: prova normalização e prova raiz errada). */
function repoComModulosRaiz(raizConfig) {
  const { dir, g } = repoGitComArquivos('cmi-root-', {
    'src/modules/venda/venda-impl.mjs': 'export const venda = () => 1;\n',
    'src/modules/venda/index.mjs': "export { venda } from './venda-impl.mjs';\n",
    'src/modules/estoque/estoque.mjs': "import { venda } from '../venda/index.mjs';\nexport const estoque = () => venda();\n",
  }, { modulos: { raiz: raizConfig, barrel: ['index.mjs'] } });
  writeFileSync(join(dir, 'src/modules/venda/index.mjs'), "export { venda } from './venda-impl.mjs';\nexport const outraCoisa = 1;\n");
  g(['add', '-A']); g(['commit', '-q', '-m', 'muda barrel de venda, sem teste de estoque']);
  return dir;
}

// F12 (issue #21, 2ª rodada): `modulos.raiz` EXISTE (raiz != NÃO MEDIU) mas ainda não tem NENHUM
// módulo — dois sabores (pasta 100% vazia; pasta só com arquivo solto tipo `.gitkeep`, o que o
// bootstrap planta) — os dois têm que dar NAO_APLICAVEL, nunca NÃO MEDIU (isso travava o pre-commit do
// 1º commit de todo projeto node recém-bootstrapado).
function repoComRaizVazia() {
  const { dir } = repoGitComArquivos('cmi-raizvazia-', { 'README.md': 'x\n' }, { modulos: { raiz: 'src/modules', barrel: ['index.mjs'] } });
  mkdirSync(join(dir, 'src', 'modules'), { recursive: true }); // existe no disco, 0 arquivos e 0 subpastas
  return dir;
}
function repoComRaizSoArquivos() {
  const { dir } = repoGitComArquivos('cmi-raizarq-', { 'src/modules/.gitkeep': '' }, { modulos: { raiz: 'src/modules', barrel: ['index.mjs'] } });
  return dir;
}

export function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const porta = (cwd, args) => spawnSync(
    process.execPath,
    [CAMINHO_GUARD, ...args],
    { cwd, encoding: 'utf8', timeout: 120_000, env: { ...envSemGit(), npm_lifecycle_event: '' } },
  ).status;
  const limpar = (d) => { if (d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } } };
  // Roda fn(dir) sobre repo de fabricar() (string ou {dir,...}); limpa sempre; erro de montagem vira caso
  // FALHO (nunca silencioso) — corta a repetição try/catch/finally dos repos de self-test (LEI 11).
  const comRepo = (fabricar, fn) => {
    let r;
    try { r = fabricar(); fn(typeof r === 'string' ? r : r.dir, r); }
    catch (e) { check(`montagem de repo falhou: ${e?.message || e}`, false); }
    finally { limpar(typeof r === 'string' ? r : r?.dir); }
  };
  const reprovaEstoque = (dir) => medir({ repo: dir, base: 'base' }).julgamento.problemas.some(
    (p) => p.tipo === 'dependente-nao-provado' && p.moduloDependente === 'estoque',
  );
  const okDir = (dir) => medir({ repo: dir, base: 'base' }).julgamento.ok === true;

  // ── acharModulosImpactados (pura) ──
  check(
    'acharModulosImpactados: barrel mudado (sem opt-out) → módulo impactado',
    acharModulosImpactados([{ arquivo: 'src/modules/venda/index.mjs', optoutAdicionado: false }], CFG_MODULOS).has('venda'),
  );
  check(
    'NUNCA BLOQUEIA: arquivo interno (não-barrel) mudado → nenhum módulo impactado',
    acharModulosImpactados([{ arquivo: 'src/modules/venda/venda-impl.mjs', optoutAdicionado: false }], CFG_MODULOS).size === 0,
  );
  check(
    'F6: index.* numa SUBPASTA interna (3 segmentos depois da raiz) não conta como barrel',
    acharModulosImpactados([{ arquivo: 'src/modules/venda/interno/index.mjs', optoutAdicionado: false }], CFG_MODULOS).size === 0,
  );
  check(
    'NUNCA BLOQUEIA (opt-out): marcador já resolvido como ACRESCENTADO no diff → isenta o módulo',
    acharModulosImpactados([{ arquivo: 'src/modules/venda/index.mjs', optoutAdicionado: true }], CFG_MODULOS).size === 0,
  );
  check(
    'BANCA VAZIO: barrel DELETADO (o caminho segue no diff, status D) ainda impacta',
    acharModulosImpactados([{ arquivo: 'src/modules/venda/index.mjs', old: null, optoutAdicionado: false }], CFG_MODULOS).has('venda'),
  );
  check('BANCA VAZIO: nenhuma mudança → nenhum módulo impactado', acharModulosImpactados([], CFG_MODULOS).size === 0);
  check(
    'BANCA NULO: arquivo fora de modulos.raiz → não conta',
    acharModulosImpactados([{ arquivo: 'README.md', optoutAdicionado: false }], CFG_MODULOS).size === 0,
  );
  check(
    'BYPASS (F7): rename index.mjs → Index.mjs (só CAIXA) ainda conta como barrel',
    acharModulosImpactados(
      [{ arquivo: 'src/modules/venda/Index.mjs', old: 'src/modules/venda/index.mjs', optoutAdicionado: false }],
      CFG_MODULOS,
    ).has('venda'),
  );
  check(
    'BYPASS (F1): barrel renomeado pra FORA da lista (index.mjs → index.zzz) impacta via o caminho ANTIGO',
    acharModulosImpactados(
      [{ arquivo: 'src/modules/venda/index.zzz', old: 'src/modules/venda/index.mjs', optoutAdicionado: false }],
      CFG_MODULOS,
    ).has('venda'),
  );

  // ── ehTesteDoModulo (pura) ──
  check('ehTesteDoModulo: sob <raiz>/<modulo>/ → true', ehTesteDoModulo('src/modules/estoque/estoque.test.mjs', 'estoque', 'src/modules') === true);
  check(
    'F2: "/<modulo>/" fora da pasta OFICIAL do módulo não conta mais → false',
    ehTesteDoModulo('outra/estoque/x.spec.ts', 'estoque', 'src/modules') === false,
  );
  check(
    'F2: nome começa com "<modulo>." fora da pasta (bypass do nome-prefixo) → false',
    ehTesteDoModulo('qualquer/estoque.test.mjs', 'estoque', 'src/modules') === false,
  );
  check('ehTesteDoModulo: teste de OUTRO módulo → false', ehTesteDoModulo('src/modules/venda/venda.test.mjs', 'estoque', 'src/modules') === false);
  check(
    'ehTesteDoModulo: arquivo não-teste (sem .test./.spec.) → false',
    ehTesteDoModulo('src/modules/estoque/estoque.mjs', 'estoque', 'src/modules') === false,
  );
  check('F2: extensão não-código (.md), mesmo com ".test." no nome → false', ehTesteDoModulo('docs/estoque.test.md', 'estoque', 'src/modules') === false);
  check(
    'BYPASS (F2): "prova" do dependente é teste na PASTA do módulo IMPACTADO (venda), não do dependente (estoque) → false',
    ehTesteDoModulo('src/modules/venda/estoque.test.mjs', 'estoque', 'src/modules') === false,
  );

  // ── julgar (pura) ──
  const grafoEV = new Map([['estoque', new Set(['venda'])]]);
  check(
    'BYPASS: A impactado, B depende de A, SEM teste de B no diff → dependente-nao-provado',
    julgar({
      modulosImpactados: new Set(['venda']),
      grafo: grafoEV,
      mudancas: [{ arquivo: 'src/modules/venda/index.mjs' }],
      cfg: CFG_MODULOS,
    }).problemas.some((p) => p.moduloDependente === 'estoque'),
  );
  check(
    'NUNCA BLOQUEIA: A impactado, B depende de A, COM teste de B no diff → ok',
    julgar({
      modulosImpactados: new Set(['venda']),
      grafo: grafoEV,
      mudancas: [
        { arquivo: 'src/modules/venda/index.mjs' },
        { arquivo: 'src/modules/estoque/estoque.test.mjs' },
      ],
      cfg: CFG_MODULOS,
    }).ok === true,
  );
  check(
    'NUNCA BLOQUEIA: módulo impactado SEM dependentes no grafo → ok',
    julgar({
      modulosImpactados: new Set(['relatorio']),
      grafo: grafoEV,
      mudancas: [{ arquivo: 'src/modules/relatorio/index.mjs' }],
      cfg: CFG_MODULOS,
    }).ok === true,
  );
  check('NUNCA BLOQUEIA: dependência existe mas o módulo dependido NÃO está impactado → ok',
    julgar({ modulosImpactados: new Set(), grafo: grafoEV, mudancas: [], cfg: CFG_MODULOS }).ok === true);
  check(
    'BANCA VAZIO: nenhum módulo impactado (conjunto vazio) → ok trivial',
    julgar({ modulosImpactados: new Set(), grafo: new Map(), mudancas: [], cfg: CFG_MODULOS }).ok === true,
  );
  check(
    'F2 (BYPASS, pura): teste do dependente com existe:false (deletado no diff) NÃO conta como prova',
    julgar({
      modulosImpactados: new Set(['venda']),
      grafo: grafoEV,
      mudancas: [
        { arquivo: 'src/modules/venda/index.mjs' },
        { arquivo: 'src/modules/estoque/estoque.test.mjs', existe: false },
      ],
      cfg: CFG_MODULOS,
    }).problemas.some((p) => p.moduloDependente === 'estoque'),
  );
  check(
    'unirGrafos: une os dois grafos (BANCA NULO: null não quebra)',
    unirGrafos(new Map([['estoque', new Set(['venda'])]]), null).get('estoque').has('venda'),
  );

  // ── repo git REAL + PORTA (venda/estoque/relatorio) ──
  comRepo(repoComModulos, (dir, t) => {
    const { g, vendaBarrel, vendaImpl, vendaInterno, estoqueTeste, relatorioBarrel } = t;

    g(['checkout', '-q', '-b', 's1']); // BYPASS: muda o barrel de venda, NÃO toca estoque → reprova
    writeFileSync(vendaBarrel, "export { venda } from './venda-impl.mjs';\nexport const outraCoisa = 1;\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda barrel de venda, sem tocar estoque']);
    check('REPO REAL BYPASS: barrel de venda mudou sem teste de estoque → dependente-nao-provado', reprovaEstoque(dir));
    check('PORTA: dependente sem teste no diff → exit 1', porta(dir, ['--base', 'base']) === 1);

    // NUNCA BLOQUEIA: barrel + teste do dependente no MESMO diff
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's2']);
    writeFileSync(vendaBarrel, "export { venda } from './venda-impl.mjs';\nexport const outraCoisa = 1;\n");
    writeFileSync(
      estoqueTeste,
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\n" +
      "test('estoque ok', () => { assert.ok(true); });\ntest('estoque ainda ok', () => { assert.ok(true); });\n",
    );
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda barrel de venda + teste de estoque']);
    check('REPO REAL: barrel mudou + teste do dependente no diff → ok', okDir(dir));
    check('PORTA: dependente PROVADO no diff → exit 0', porta(dir, ['--base', 'base']) === 0);

    // F5 (BYPASS): venda-impl.mjs é RE-EXPORTADO ("export {venda} from") — muda SÓ ele, barrel intocado
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's3']);
    writeFileSync(vendaImpl, "import { formatarPreco } from './venda-interno.mjs';\nexport const venda = () => formatarPreco(2);\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'F5: muda venda-impl.mjs (reexportado pelo barrel), barrel intocado']);
    check('F5 (BYPASS): venda-impl.mjs (re-exportado pelo barrel) muda, barrel intocado → módulo impactado mesmo assim', reprovaEstoque(dir));
    check('PORTA F5: superfície via reexport mudou sem teste do dependente → exit 1', porta(dir, ['--base', 'base']) === 1);

    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's3b']); // NUNCA BLOQUEIA: arquivo interno só por IMPORT comum (NÃO reexportado)
    writeFileSync(vendaInterno, 'export const formatarPreco = (v) => `R$ ${v},00`;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda arquivo interno NAO reexportado (só usado via import comum)']);
    check('NUNCA BLOQUEIA: arquivo interno usado só via IMPORT comum (não reexportado pelo barrel) → nenhum módulo impactado', okDir(dir));
    check('PORTA: arquivo interno não reexportado → exit 0', porta(dir, ['--base', 'base']) === 0);

    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's4']); // NUNCA BLOQUEIA: módulo sem dependentes (relatorio)
    writeFileSync(relatorioBarrel, "export const relatorio = () => 'r2';\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda barrel de relatorio (sem dependentes)']);
    check('REPO REAL: módulo impactado sem dependentes → ok', okDir(dir));
    check('PORTA: módulo sem dependentes → exit 0', porta(dir, ['--base', 'base']) === 0);

    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's5']); // NUNCA BLOQUEIA (F3): opt-out ACRESCENTADO agora, sem teste do dependente
    writeFileSync(vendaBarrel, `// ${MARCADOR_OPTOUT}: só ajustei o tipo do retorno, sem efeito em runtime\nexport { venda } from './venda-impl.mjs';\n`);
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda barrel de venda com opt-out ACRESCENTADO agora']);
    check('NUNCA BLOQUEIA (F3): opt-out ACRESCENTADO neste diff → isenta o módulo mesmo sem teste do dependente', okDir(dir));
    check('PORTA: opt-out acrescentado agora → exit 0', porta(dir, ['--base', 'base']) === 0);

    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's6']); // BANCA INVISÍVEL: marcador quebrado por U+200B → NÃO isenta
    writeFileSync(vendaBarrel, `// impacto-de-\u200bproposito: quebrado por zero-width space\nexport const outra = 1;\n`);
    g(['add', '-A']); g(['commit', '-q', '-m', 'opt-out quebrado por invisivel']);
    check('BANCA INVISÍVEL: marcador quebrado por U+200B → NÃO isenta, ainda reprova', reprovaEstoque(dir));

    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's-f7']); // F7 (BYPASS): rename só de CAIXA do barrel + remove o export usado
    g(['mv', 'src/modules/venda/index.mjs', 'src/modules/venda/Index.mjs']);
    writeFileSync(join(dir, 'src/modules/venda/Index.mjs'), 'export const outraCoisa = 1;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'F7: rename so de CAIXA do barrel + remove export venda']);
    check('F7 (BYPASS): rename index.mjs→Index.mjs (só caixa) + conteúdo mudou → módulo impactado, reprova sem teste', reprovaEstoque(dir));
    check('PORTA F7: rename de caixa do barrel sem teste do dependente → exit 1', porta(dir, ['--base', 'base']) === 1);

    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's-f1a']); // F1 (BYPASS): barrel DELETADO — estoque continua importando
    rmSync(join(dir, 'src/modules/venda/index.mjs'));
    g(['add', '-A']); g(['commit', '-q', '-m', 'F1: deleta o barrel de venda (estoque continua importando)']);
    check('F1 (BYPASS): barrel de venda DELETADO, estoque ainda importa (grafo vem da BASE) → dependente-nao-provado', reprovaEstoque(dir));
    check('PORTA F1: barrel deletado sem teste do dependente → exit 1', porta(dir, ['--base', 'base']) === 1);

    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's-f1b']); // F1 (BYPASS): barrel RENOMEADO .mjs → .ts (extensão que o import antigo não resolve)
    g(['mv', 'src/modules/venda/index.mjs', 'src/modules/venda/index.ts']);
    writeFileSync(join(dir, 'src/modules/venda/index.ts'), "export { venda } from './venda-impl.mjs';\nexport const novaCoisa = 2;\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'F1: renomeia barrel index.mjs -> index.ts, muda conteudo']);
    check('F1 (BYPASS): barrel renomeado .mjs→.ts (import do dependente continua na extensão antiga) → dependente-nao-provado', reprovaEstoque(dir));
    check('PORTA F1: rename de extensão do barrel sem teste do dependente → exit 1', porta(dir, ['--base', 'base']) === 1);

    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 's-f9']); // F9: opt-out só no DISCO (não staged) não isenta — julga o ÍNDICE
    writeFileSync(vendaBarrel, "export { venda } from './venda-impl.mjs';\nexport const outraCoisa = 1;\n");
    g(['add', '-A']); // STAGED, não commitado (simula pre-commit)
    writeFileSync(
      vendaBarrel,
      `// ${MARCADOR_OPTOUT}: mentira só no disco, não staged\n` +
      `export { venda } from './venda-impl.mjs';\nexport const outraCoisa = 1;\n`,
    );
    check('F9: opt-out só no DISCO (não staged) NÃO isenta — julga o ÍNDICE (o que vai ser commitado)', reprovaEstoque(dir));

    check('PORTA: fora de repositório git → exit 2', porta(tmpdir(), ['--base', 'base']) === 2);
    check('PORTA: base inexistente → exit 2', porta(dir, ['--base', 'nao-existe-de-verdade']) === 2);
    check('PORTA: sem --base → exit 2', porta(dir, []) === 2);
  });

  // ── F3: opt-out HERDADO da base (não acrescentado neste diff) NÃO isenta ──
  comRepo(repoComOptOutHerdado, (dir) => {
    check('F3 (BYPASS): opt-out HERDADO da base (não acrescentado neste diff) NÃO isenta — export removido do barrel ainda reprova', reprovaEstoque(dir));
    check('PORTA F3: opt-out herdado não isenta mudança real → exit 1', porta(dir, ['--base', 'base']) === 1);
  });

  // ── F4: modulos.raiz normalizado funciona; digitado errado → NÃO MEDIU ──
  comRepo(() => repoComModulosRaiz('./src/modules'), (dir) => {
    const r = medir({ repo: dir, base: 'base' });
    check('F4: modulos.raiz="./src/modules" é normalizado e MEDE de verdade — reprova, não fica mudo em exit 0',
      r.julgamento.problemas.some((p) => p.moduloDependente === 'estoque'));
    check('raiz com 1 módulo real → NÃO é NAO_APLICAVEL nem NÃO MEDIU (mede de verdade, comportamento de hoje)',
      r.naoAplicavel !== true && r.naoMediu !== true);
    check('PORTA F4: raiz com "./" na frente ainda mede (exit 1, não exit 0 mudo)', porta(dir, ['--base', 'base']) === 1);
  });
  comRepo(() => repoComModulosRaiz('src/modulos'), (dir) => { // erro de digitação: código real está em src/modules
    check('F4 (BYPASS): modulos.raiz="src/modulos" (erro de digitação, não casa com nada) → NÃO MEDIU', medir({ repo: dir, base: 'base' }).naoMediu === true);
    check('PORTA F4: raiz sem pasta correspondente → exit 2 (NÃO MEDIU, nunca 0 mudo)', porta(dir, ['--base', 'base']) === 2);
  });

  // ── F12 (issue #21, 2ª rodada): raiz EXISTE mas ainda sem módulo → NAO_APLICAVEL, não NÃO MEDIU ──
  comRepo(repoComRaizVazia, (dir) => {
    const r = medir({ repo: dir, base: 'base' });
    check('F12: modulos.raiz existe e está 100% vazia → NAO_APLICAVEL (nunca NÃO MEDIU)', r.naoAplicavel === true && r.naoMediu !== true);
    check('F12: motivo cita "ainda sem módulos" e a raiz', /ainda sem módulos em "src\/modules"/.test(r.motivo || ''));
    check('PORTA F12: raiz vazia → exit 0 (NAO_APLICAVEL), nunca exit 2', porta(dir, ['--base', 'base']) === 0);
  });
  comRepo(repoComRaizSoArquivos, (dir) => {
    const r = medir({ repo: dir, base: 'base' });
    check('F12: modulos.raiz existe só com ARQUIVO solto (.gitkeep, sem subpasta) → NAO_APLICAVEL', r.naoAplicavel === true && r.naoMediu !== true);
    check('PORTA F12: raiz só com .gitkeep → exit 0 (NAO_APLICAVEL), nunca exit 2', porta(dir, ['--base', 'base']) === 0);
  });

  // ── NAO_APLICAVEL: sem cfg / sem modulos.raiz ──
  comRepo(repoSemModulosRaiz, (dir) => {
    check('REPO REAL: .arch-layers.json sem modulos.raiz → NAO_APLICAVEL', medir({ repo: dir, base: 'base' }).naoAplicavel === true);
    check('PORTA: sem modulos.raiz → NAO_APLICAVEL, exit 0', porta(dir, ['--base', 'base']) === 0);
  });

  // ── config JSON inválida → NÃO MEDIU (2), nunca 0 ──
  comRepo(repoComArchInvalido, (dir) => {
    check('PORTA: .arch-layers.json com JSON inválido → exit 2 (NÃO MEDIU, nunca 0/1)', porta(dir, ['--base', 'base']) === 2);
  });

  // ── F10: a certidão tem a linha exigida pela Parte 0/1 do COMO-CRIAR-GUARD ──
  check('F10: certidão contém a linha "INCIDENTE DE ORIGEM"', readFileSync(CAMINHO_GUARD, 'utf8').includes('INCIDENTE DE ORIGEM'));

  // ── STACK (R6, 2026-09-11): "stack":"python" em esteira.json isenta este guard (só lê JS/TS) ──
  comRepo(() => repoComModulosRaiz('src/modules'), (dir) => {
    // violação de verdade (barrel de venda mudou sem teste de estoque) — mas o projeto é python; nem
    // precisa de --base, porque o stack-check acontece ANTES da resolução de base/HEAD.
    writeFileSync(join(dir, 'esteira.json'), JSON.stringify({ stack: 'python' }));
    check('STACK: projeto python (esteira.json) → NAO_APLICAVEL exit 0, mesmo com violação real no diff', porta(dir, []) === 0);
  });
  comRepo(() => repoComModulosRaiz('src/modules'), (dir) => {
    writeFileSync(join(dir, 'esteira.json'), JSON.stringify({ stack: 'node' }));
    check('STACK: projeto node (explícito) → regra normal (reprova a violação)', porta(dir, ['--base', 'base']) === 1);
  });
  comRepo(() => {
    const { dir, g } = repoGitVazio('cmi-stack-ruim-');
    writeFileSync(join(dir, 'esteira.json'), '{ nao é json');
    writeFileSync(join(dir, 'a.mjs'), 'export const x = 1;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
    return dir;
  }, (dir) => {
    check('STACK: esteira.json com JSON inválido → NÃO MEDIU exit 2 (nunca "node" silencioso)', porta(dir, []) === 2);
  });

  process.exitCode = relatarSelfTest(NOME, casos);
}
