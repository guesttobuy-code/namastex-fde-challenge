/**
 * scripts/guards/selftest/cochange-companion.mjs — SUÍTE do self-test do guard cochange-companion.
 *
 * POR QUE ESTÁ AQUI (não dentro do guard): o guard + suíte embutida passou de 600 linhas VISUAIS depois
 *   do R6 (perfil de stack Python, 2026-09-11: check + 3 casos STACK novos). O guard continua sendo a
 *   PORTA (`node scripts/guards/cochange-companion.mjs --self-test` dá a MESMA saída e o MESMO exit de
 *   antes — só importa esta suíte por caminho relativo). Este arquivo importa as FUNÇÕES PURAS do guard
 *   por caminho relativo (`../cochange-companion.mjs`) — nunca reimplementa (LEI 11) — e calcula o
 *   caminho do PRÓPRIO guard a partir do seu import.meta.url (não do argv/import.meta.url deste arquivo):
 *   a prova-de-vida copia a árvore scripts/ inteira pra um tmp e muta só o arquivo do guard nessa cópia —
 *   os casos de PORTA-como-processo precisam mirar o guard MUTADO da cópia, não o original.
 *
 * CONTRA-PROVA: node scripts/guards/cochange-companion.mjs --self-test (não rode este arquivo direto).
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../../lib/guard-doctrine.mjs';
import { envSemGit } from '../../lib/git-base.mjs';
import { NOME, MARCADOR_OPTOUT, ehArquivoDeTeste, acharCandidatosCompanheiro, acharCompanheiro, julgar, medir } from '../cochange-companion.mjs';

// caminho do GUARD (não deste arquivo) — resolvido a partir da PRÓPRIA localização, pra funcionar igual
// na árvore real e numa cópia tmp da prova-de-vida (que muta só o cochange-companion.mjs copiado).
const GUARD = fileURLToPath(new URL('../cochange-companion.mjs', import.meta.url));

// ─── contra-prova com repo git REAL ──────────────────────────────────────────
function repoComFonteETeste() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-self-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'src', 'soma.mjs'), 'export const soma = (a, b) => a + b;\n');
  writeFileSync(join(dir, 'tests', 'soma.test.mjs'), "import test from 'node:test';\ntest('soma', () => {});\n");
  writeFileSync(join(dir, 'src', 'util.mjs'), 'export const identidade = (x) => x;\n'); // fonte sem companheiro
  // CC-01: colisão global — src/index.mjs TEM companheiro por convenção; scripts/index.mjs é OUTRO
  // módulo, mesmo basename, diretório diferente — não pode exigir o teste alheio.
  writeFileSync(join(dir, 'src', 'index.mjs'), 'export const raiz = 1;\n');
  writeFileSync(join(dir, 'tests', 'index.test.mjs'), "import test from 'node:test';\ntest('index', () => {});\n");
  writeFileSync(join(dir, 'scripts', 'index.mjs'), 'export const scriptRaiz = 1;\n');
  // CC-09: companheiro pré-existente na base pra uma fonte que ainda NÃO existe.
  writeFileSync(join(dir, 'tests', 'novo.test.mjs'), "import test from 'node:test';\ntest('novo', () => {});\n");
  // CC-07: arquivo sob tests/ que NÃO tem sufixo .test./.spec. — ainda assim não é "fonte" (RE_DIR_TESTE).
  writeFileSync(join(dir, 'tests', 'helpers.mjs'), 'export const ajuda = () => 1;\n');
  // CC-07 (R3): companheiro que EXISTIRIA por convenção pra esse helper (tests/helpers.test.mjs) —
  // prova que o filtro de medir() exclui helpers.mjs ANTES de resolver companheiro (não é decorativo:
  // sem ele, o helper passaria a exigir este arquivo como companheiro e reprovaria).
  writeFileSync(join(dir, 'tests', 'helpers.test.mjs'), "import test from 'node:test';\ntest('ajuda', () => {});\n");
  // CC-02: fonte com o marcador de opt-out JÁ NA BASE (herdado) — prova que herdado não isenta.
  writeFileSync(join(dir, 'src', 'marcado.mjs'), `// ${MARCADOR_OPTOUT}: refactor de 2025, renomeei variaveis\nexport const marcado = (x) => x;\n`);
  writeFileSync(join(dir, 'tests', 'marcado.test.mjs'), "import test from 'node:test';\ntest('marcado', () => {});\n");
  // CC-03: par acentuado — prova que caminho com acento não some mais do diff.
  writeFileSync(join(dir, 'src', 'conexão.mjs'), 'export const conectar = () => 1;\n');
  writeFileSync(join(dir, 'tests', 'conexão.test.mjs'), "import test from 'node:test';\ntest('conexao', () => {});\n");
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']); g(['branch', 'base']);
  return {
    dir, g,
    fonte: join(dir, 'src', 'soma.mjs'),
    teste: join(dir, 'tests', 'soma.test.mjs'),
    semCompanheiro: join(dir, 'src', 'util.mjs'),
  };
}

function repoOrfaoSemMergeBase() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-orfa-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  writeFileSync(join(dir, 'a.txt'), 'a\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'main']);
  g(['checkout', '-q', '--orphan', 'orfa']); g(['rm', '-rf', '-q', '.']);
  writeFileSync(join(dir, 'b.txt'), 'b\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'orfa']);
  g(['checkout', '-q', 'main']);
  return dir;
}

function repoSemCommit() {
  const dir = mkdtempSync(join(tmpdir(), 'cc-vazio-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore', env: envSemGit() });
  return dir;
}

export function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── funções puras ──
  check(
    'ehArquivoDeTeste: casa *.test.mjs/*.spec.ts, caminho sob tests/ e __tests__/',
    ehArquivoDeTeste('a/b.test.mjs') && ehArquivoDeTeste('a/b.spec.ts') &&
      ehArquivoDeTeste('tests/helpers.mjs') && ehArquivoDeTeste('pkg/__tests__/foo.mjs'),
  );
  check('ehArquivoDeTeste: NÃO casa fonte comum', ehArquivoDeTeste('src/soma.mjs') === false);
  check(
    'CC-01: candidatos = mesmo dir, tests/<rel>, __tests__/ — SEM tests/<base> na raiz (colisão removida)',
    (() => {
      const c = acharCandidatosCompanheiro('src/foo/bar.mjs');
      return c.includes('src/foo/bar.test.mjs') && c.includes('tests/foo/bar.test.mjs') &&
        c.includes('src/foo/__tests__/bar.test.mjs') && !c.includes('tests/bar.test.mjs');
    })(),
  );
  check(
    'acharCandidatosCompanheiro: fonte na raiz de src/ → tests/<base>.test.<ext> (sem sub-dir)',
    acharCandidatosCompanheiro('src/soma.mjs').includes('tests/soma.test.mjs'),
  );
  check(
    'acharCompanheiro: acha o candidato que existe no índice (pula os que não existem)',
    acharCompanheiro('src/foo/bar.mjs', (c) => c === 'tests/foo/bar.test.mjs') === 'tests/foo/bar.test.mjs',
  );
  check(
    'acharCompanheiro: NULO — nenhum candidato existe (índice nem base) → null',
    acharCompanheiro('src/foo/bar.mjs', () => false, () => false) === null,
  );
  check(
    'CC-05: candidato com CAIXA diferente do índice não casa (comparação exata, não case-insensitive)',
    acharCompanheiro('src/button.mjs', (c) => c === 'tests/Button.test.mjs') === null,
  );
  check(
    'acharCompanheiro: cai pra BASE só quando nenhum candidato existe no índice',
    acharCompanheiro('src/foo/bar.mjs', () => false, (c) => c === 'tests/foo/bar.test.mjs') === 'tests/foo/bar.test.mjs',
  );
  check(
    'CC-07: ORDEM — dois candidatos existem ao mesmo tempo (mesmo dir E tests/<rel>) → resolve sempre o primeiro (mesmo dir)',
    acharCompanheiro('src/soma.mjs', (c) => c === 'src/soma.test.mjs' || c === 'tests/soma.test.mjs') === 'src/soma.test.mjs',
  );
  check(
    'julgar: NUNCA BLOQUEIA — companheiro null (sem candidato) → ok',
    julgar([{ arquivo: 'f', companheiro: null, companheiroMudou: false, optOutAdicionado: false }]).ok === true,
  );
  check(
    'julgar: BYPASS lógico — companheiro existe e NÃO mudou, sem opt-out → companheiro-nao-mudou',
    julgar([{ arquivo: 'f', companheiro: 'f.test.mjs', companheiroMudou: false, optOutAdicionado: false }])
      .problemas.some((p) => p.tipo === 'companheiro-nao-mudou'),
  );
  check(
    'julgar: NUNCA BLOQUEIA — companheiro existe e mudou → ok',
    julgar([{ arquivo: 'f', companheiro: 'f.test.mjs', companheiroMudou: true, optOutAdicionado: false }]).ok === true,
  );
  check(
    'julgar: NUNCA BLOQUEIA — opt-out ACRESCENTADO neste diff isenta mesmo com companheiro parado',
    julgar([{ arquivo: 'f', companheiro: 'f.test.mjs', companheiroMudou: false, optOutAdicionado: true }]).ok === true,
  );
  check(
    'CC-07: ehArquivoDeTeste("tests/helpers.mjs") === true — sob tests/ não é fonte mesmo sem sufixo .test.',
    ehArquivoDeTeste('tests/helpers.mjs') === true,
  );

  // ── repo git REAL ──
  const portaComSaida = (cwd, args) => {
    const r = spawnSync(process.execPath, [GUARD, ...args], { cwd, encoding: 'utf8', timeout: 120_000, env: { ...envSemGit(), npm_lifecycle_event: '' } });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
  let t;
  try {
    t = repoComFonteETeste();
    const { dir, g, fonte, teste, semCompanheiro } = t;

    // BYPASS: muda só a fonte — companheiro existe no índice e NÃO mudou
    writeFileSync(fonte, 'export const soma = (a, b) => a + b + 0;\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'muda so a fonte']);
    check(
      'BYPASS: fonte mudou, companheiro existe e NÃO mudou → companheiro-nao-mudou',
      medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'companheiro-nao-mudou'),
    );
    check('PORTA: companheiro não mudou → exit 1', portaComSaida(dir, ['--base', 'base']).status === 1);

    // CC-06: opt-out escrito só no WORKING TREE (não staged) não isenta — o guard lê o ÍNDICE, não o disco
    writeFileSync(fonte, `// ${MARCADOR_OPTOUT}: escrito so no disco, nao staged\nexport const soma = (a, b) => a + b + 0;\n`);
    check(
      'CC-06: opt-out só no working tree (não staged) NÃO isenta → ainda reprova',
      medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'companheiro-nao-mudou'),
    );
    check('CC-06 PORTA: opt-out não staged → exit 1', portaComSaida(dir, ['--base', 'base']).status === 1);
    g(['checkout', '--', 'src/soma.mjs']); // descarta a edição não staged

    // CC-06: companheiro apagado só no WORKING TREE (não staged) não isenta — índice continua com ele
    rmSync(teste);
    check(
      'CC-06: companheiro apagado só no working tree (não staged) → ainda reprova (índice intacto)',
      medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'companheiro-nao-mudou'),
    );
    check('CC-06 PORTA: companheiro deletado não staged → exit 1', portaComSaida(dir, ['--base', 'base']).status === 1);
    g(['checkout', '--', 'tests/soma.test.mjs']); // restaura pro checkout de branch seguinte

    // NUNCA BLOQUEIA: fonte e companheiro mudam juntos
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'os-dois']);
    writeFileSync(fonte, 'export const soma = (a, b) => a + b + 1;\n');
    writeFileSync(teste, "import test from 'node:test';\ntest('soma', () => {});\ntest('soma2', () => {});\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda os dois']);
    check('NUNCA BLOQUEIA: fonte e companheiro mudam juntos → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: fonte+companheiro mudam → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);

    // NUNCA BLOQUEIA: fonte sem companheiro
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'sem-companheiro']);
    writeFileSync(semCompanheiro, 'export const identidade = (x) => x + 0;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda fonte sem companheiro']);
    check('NUNCA BLOQUEIA: fonte sem companheiro (nenhum candidato existe) → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: fonte sem companheiro → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);

    // NUNCA BLOQUEIA: só o teste muda (nenhuma fonte no diff)
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'so-teste']);
    writeFileSync(teste, "import test from 'node:test';\ntest('soma', () => {});\ntest('extra', () => {});\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'so teste']);
    check('NUNCA BLOQUEIA: só o companheiro muda (nenhuma fonte no diff) → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: só teste muda → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);

    // NUNCA BLOQUEIA: rename da fonte com companheiro renomeado+tocado junto
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'rename']);
    g(['mv', 'src/soma.mjs', 'src/soma2.mjs']);
    g(['mv', 'tests/soma.test.mjs', 'tests/soma2.test.mjs']);
    writeFileSync(join(dir, 'tests', 'soma2.test.mjs'), "import test from 'node:test';\ntest('soma2', () => {});\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'rename fonte e companheiro juntos']);
    check('NUNCA BLOQUEIA: rename da fonte com companheiro renomeado+tocado junto → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: rename com companheiro junto → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);

    // NUNCA BLOQUEIA: opt-out ACRESCENTADO neste diff (fonte na base NÃO tinha o marcador)
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'optout']);
    writeFileSync(fonte, `// ${MARCADOR_OPTOUT}: refactor puro, comportamento igual\nexport const soma = (a, b) => (a + b);\n`);
    g(['add', '-A']); g(['commit', '-q', '-m', 'fonte com opt-out acrescentado']);
    check('NUNCA BLOQUEIA: opt-out ACRESCENTADO neste diff isenta mesmo sem companheiro mudar → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: opt-out acrescentado → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);

    // NUNCA BLOQUEIA: fonte deletada (com companheiro existente e parado) não exige companheiro
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'deleta-fonte']);
    rmSync(fonte); g(['add', '-A']); g(['commit', '-q', '-m', 'deleta a fonte']);
    check('NUNCA BLOQUEIA: fonte deletada não exige companheiro → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: fonte deletada → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);

    // CC-01: scripts/index.mjs muda sozinho — tests/index.test.mjs é de OUTRO módulo (src/index.mjs), não exigido
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'cc01-colisao']);
    writeFileSync(join(dir, 'scripts', 'index.mjs'), 'export const scriptRaiz = 2;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda so scripts/index.mjs']);
    check('CC-01: colisão de basename em outro diretório não exige o teste alheio → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('CC-01 PORTA: colisão de basename em outro diretório → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);

    // CC-09: fonte NOVA (não existia na base) — companheiro pré-existente por convenção não é exigido
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'cc09-fonte-nova']);
    writeFileSync(join(dir, 'src', 'novo.mjs'), 'export const novo = () => 1;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'adiciona fonte nova']);
    check(
      'CC-09: fonte NOVA (não existia na base) não é julgada, mesmo com companheiro pronto → ok',
      medir({ repo: dir, base: 'base' }).julgamento.ok === true,
    );
    check('CC-09 PORTA: fonte nova não exige companheiro → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);

    // CC-02 BYPASS: opt-out HERDADO da base (já estava lá, não tocado neste diff) NÃO isenta
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'cc02-heranca']);
    writeFileSync(join(dir, 'src', 'marcado.mjs'), `// ${MARCADOR_OPTOUT}: refactor de 2025, renomeei variaveis\nexport const marcado = (x) => x - 1;\n`);
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda comportamento, marcador herdado intacto']);
    check(
      'CC-02: opt-out HERDADO da base (não acrescentado neste diff) NÃO isenta → reprova',
      medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'companheiro-nao-mudou'),
    );
    check('CC-02 PORTA: opt-out herdado → exit 1', portaComSaida(dir, ['--base', 'base']).status === 1);

    // CC-07: mudar só tests/helpers.mjs (sob tests/, sem sufixo .test.) não conta como fonte
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'cc07-helper']);
    writeFileSync(join(dir, 'tests', 'helpers.mjs'), 'export const ajuda = () => 2;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda so o helper sob tests/']);
    check('CC-07: helper sob tests/ (sem sufixo .test.) não é fonte → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('CC-07 PORTA: helper sob tests/ não é fonte → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);
    // CC-07 (R3): a base agora TEM tests/helpers.test.mjs (companheiro por convenção do helper) —
    // se o filtro `!ehArquivoDeTeste` de medir() fosse decorativo, tests/helpers.mjs entraria em
    // `mudancas` com esse companheiro parado e reprovaria; a asserção confere a EXCLUSÃO, não só o ok.
    check(
      'CC-07 (R3): helper sob tests/ com companheiro existente não entra em mudancas (filtro não é decorativo)',
      !medir({ repo: dir, base: 'base' }).mudancas.some((m) => m.arquivo === 'tests/helpers.mjs'),
    );
    check('CC-07 (R3) PORTA: idem via processo → exit 0', portaComSaida(dir, ['--base', 'base']).status === 0);

    // CC-08: companheiro RENOMEADO pra fora da convenção (rename puro, sem tocar conteúdo) junto com
    // mudança de comportamento na fonte — a fonte mantém o MESMO nome, só o teste se move.
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'cc08-rename-companheiro']);
    writeFileSync(fonte, 'export const soma = (a, b) => a - b;\n'); // muda comportamento de verdade
    mkdirSync(join(dir, 'tests', 'legado'), { recursive: true });
    g(['mv', 'tests/soma.test.mjs', 'tests/legado/soma-antigo.test.mjs']);
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda fonte e move o companheiro pra fora da convencao']);
    check(
      'CC-08: companheiro renomeado pra fora da convenção (rename puro) → reprova',
      medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'companheiro-nao-mudou'),
    );
    check('CC-08 PORTA: companheiro renomeado pra fora → exit 1', portaComSaida(dir, ['--base', 'base']).status === 1);

    // CC-03: caminho acentuado — fonte muda sozinha, companheiro acentuado existente não muda → reprova
    // (antes do conserto na lib, o caminho acentuado sumia do diff e isto dava falso "ok").
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'cc03-acento']);
    writeFileSync(join(dir, 'src', 'conexão.mjs'), 'export const conectar = () => 2;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda so a fonte acentuada']);
    check(
      'CC-03: caminho acentuado não fica mais invisível → reprova',
      medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'companheiro-nao-mudou'),
    );
    check('CC-03 PORTA: acento não esconde mais a fonte → exit 1', portaComSaida(dir, ['--base', 'base']).status === 1);

    check('PORTA: fora de repositório git → exit 2', portaComSaida(tmpdir(), ['--base', 'base']).status === 2);
    check('PORTA: base inexistente → exit 2', portaComSaida(dir, ['--base', 'nao-existe-de-verdade']).status === 2);
    check('PORTA: sem --base → exit 2', portaComSaida(dir, []).status === 2);
  } catch (e) {
    check(`REPO REAL: montagem falhou (${e?.message || e})`, false);
  } finally {
    if (t) { try { rmSync(t.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }

  // CC-04: PORTA da branch órfã (sem merge-base) e do repo sem commit — repos isolados, contra-prova dedicada.
  let dirOrfao;
  try {
    dirOrfao = repoOrfaoSemMergeBase();
    const r = portaComSaida(dirOrfao, ['--base', 'orfa']);
    check('CC-04: base em branch órfã (sem merge-base) → exit 2 NÃO MEDIU', r.status === 2 && /NÃO MEDIU/.test(r.stderr));
  } catch (e) {
    check(`CC-04: montagem do repo órfão falhou (${e?.message || e})`, false);
  } finally {
    if (dirOrfao) { try { rmSync(dirOrfao, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }
  let dirVazio;
  try {
    dirVazio = repoSemCommit();
    const r = portaComSaida(dirVazio, ['--base', 'main']);
    check('CC-04: repositório sem NENHUM commit → exit 0 NAO_APLICAVEL', r.status === 0 && /NAO_APLICAVEL/.test(r.stdout));
  } catch (e) {
    check(`CC-04: montagem do repo sem commit falhou (${e?.message || e})`, false);
  } finally {
    if (dirVazio) { try { rmSync(dirVazio, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }

  // ── STACK (R6, 2026-09-11): "stack":"python" em esteira.json isenta este guard ──
  let tStack;
  try {
    tStack = repoComFonteETeste();
    const { dir, g, fonte } = tStack;
    // muda a fonte sozinha (companheiro existe e não muda) — violação de verdade — mas o projeto é python
    writeFileSync(fonte, 'export const soma = (a, b) => a + b + 0;\n');
    writeFileSync(join(dir, 'esteira.json'), JSON.stringify({ stack: 'python' }));
    g(['add', '-A']); g(['commit', '-q', '-m', 'muda a fonte + declara stack python']);
    check('STACK: projeto python (esteira.json) → NAO_APLICAVEL exit 0, mesmo com companheiro parado', portaComSaida(dir, []).status === 0);
    writeFileSync(join(dir, 'esteira.json'), JSON.stringify({ stack: 'node' }));
    g(['add', '-A']); g(['commit', '-q', '-m', 'declara stack node explícito']);
    check('STACK: projeto node (explícito) → regra normal (reprova o companheiro parado)', portaComSaida(dir, ['--base', 'base']).status === 1);
  } catch (e) {
    check(`STACK: montagem falhou (${e?.message || e})`, false);
  } finally {
    if (tStack) { try { rmSync(tStack.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }
  let dirStackRuim;
  try {
    dirStackRuim = mkdtempSync(join(tmpdir(), 'cc-stack-ruim-'));
    const g = (args) => execFileSync('git', args, { cwd: dirStackRuim, stdio: 'ignore', env: envSemGit() });
    g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
    writeFileSync(join(dirStackRuim, 'esteira.json'), '{ nao é json');
    writeFileSync(join(dirStackRuim, 'a.mjs'), 'export const x = 1;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
    check('STACK: esteira.json com JSON inválido → NÃO MEDIU exit 2 (nunca "node" silencioso)', portaComSaida(dirStackRuim, []).status === 2);
  } catch (e) {
    check(`STACK: montagem do repo com esteira.json ruim falhou (${e?.message || e})`, false);
  } finally {
    if (dirStackRuim) { try { rmSync(dirStackRuim, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }

  process.exitCode = relatarSelfTest(NOME, casos);
}
