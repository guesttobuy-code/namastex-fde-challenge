#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: dívida técnica marcada e não-rastreada (o "depois eu arrumo" que nunca vem) se acumula
 *   em silêncio. Um TODO/FIXME solto no código não é dívida rastreada — é dívida ESQUECIDA: não está numa
 *   issue, ninguém mede, e vira sedimento. A catraca (anti-regressão, dor do dono): o nº de marcadores de
 *   dívida NÃO-RASTREADA num arquivo não pode CRESCER vs a base. Dívida linkada a uma issue (`#123`) é
 *   rastreada → livre; dívida sem issue é o que a catraca segura (linke ou remova, não deixe crescer).
 *
 * O QUE FAZ: pega os arquivos de código (.mjs/.cjs/.js/.jsx/.ts/.tsx/.mts/.cts) MUDADOS vs a base (git,
 *   rename-aware) e, POR ARQUIVO, exige nº de marcadores NÃO-RASTREADOS no HEAD <= o da base. Marcador =
 *   `TODO`/`FIXME`/`XXX`/`HACK` em CONTEXTO DE COMENTÁRIO (após `//`, `/*` ou `*` de linha jsdoc) —
 *   identificador solto `const TODO` ou multiplicação `a * TODO` NÃO contam. RASTREADO (isento) = a linha
 *   tem uma issue `#\d+` OU o marcador `divida-de-proposito`. Arquivo NOVO conta a partir de zero (dívida
 *   nova não-rastreada é dívida que nasce solta).
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. um arquivo ganhar marcador(es) de dívida NÃO-rastreada vs a base (TODO/FIXME/XXX/HACK sem issue #).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) a QUALIDADE/urgência da dívida — só conta marcadores, não lê o texto;
 *   (b) dívida SEM marcador (código ruim que ninguém marcou) — é da revisão/auditor; (c) dívida em arquivo
 *   NÃO-tocado (a catraca é sobre o diff — não varre a árvore inteira; o que já existia e não mudou fica);
 *   (d) marcador dentro de STRING conta como se fosse comentário — a contagem é textual por-linha (não despe
 *   strings), então uma string que contenha um marcador em posição de comentário infla o número (raro; some
 *   se você rotular/linkar); (e) issue linkada por URL sem `#` (ex.: `.../issues/123` sem `#`) não é vista
 *   como rastreada — use `#123`; (f) CÓDIGO PYTHON (R6, 2026-09-11) — este guard só olha extensão JS/TS;
 *   num projeto com "stack": "python" em esteira.json ele sai NAO_APLICAVEL (exit 0), ANTES de qualquer diff.
 *
 * MODO DE FALHA JÁ ESCAPADO: guard novo (onda 3) — ainda sem auditoria adversarial.
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — PARCIAL (declarada): o marcador vive em COMENTÁRIO (o despir apagaria o
 *     comentário e zeraria a contagem), então conto no texto CRU, ancorado a `//`/`/*`/`*`-de-linha; a
 *     ressalva é (d) — um marcador dentro de uma string conta. Esta fonte não se auto-acusa: os marcadores
 *     das fixtures são MONTADOS por variável (M_TODO = 'TO'+'DO'), então nenhuma LINHA desta fonte tem um
 *     marcador logo após `//`/`/*`/`*`-de-linha (o próprio RE_DIVIDA usa a forma escapada, não a literal).
 *   BANCA: RENOMEAR — TRATADA: git-base `-M` pareia o rename; a base vem do caminho antigo.
 *   BANCA: BASELINE — NÃO SE APLICA: a "base" é o commit-base do git, não um arquivo/allowlist editável.
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: opera sobre o diff do git, não segue import/link.
 *   VAZIO/NULO (arquivo novo/deletado) e SUBSTITUIR viram casos no repo git real do self-test.
 *
 * CONTRA-PROVA: node scripts/guards/todo-debt-ratchet.mjs --self-test — repo git real: arquivo ganha um
 *   marcador sem issue → reprova; linka a issue → ok; remove → ok; arquivo novo com marcador solto → reprova.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { paresBaseHead, baseDaEsteira, temHead, refExiste, repoRaiz, envSemGit } from '../lib/git-base.mjs';
import { stackDoProjeto } from '../lib/stack.mjs';

const NOME = 'todo-debt-ratchet';
const RE_CODIGO = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i;
const MARCADOR_OPTOUT = 'divida-de-proposito';
// Marcador de dívida em CONTEXTO DE COMENTÁRIO: após `//`, `/*`, ou `*` no começo de uma linha jsdoc.
// Não-global (testado por-linha). `\b` evita casar TODOList/HACKney etc.
const RE_DIVIDA = /(?:\/\/|\/\*|^[ \t]*\*)[ \t]*(?:TODO|FIXME|XXX|HACK)\b/;

/** FUNÇÃO PURA: nº de marcadores de dívida NÃO-RASTREADA (sem issue `#\d` nem opt-out) no fonte. Por-linha. */
export function contarDividaNaoRastreada(fonte) {
  let n = 0;
  for (const linha of String(fonte ?? '').split(/\r?\n/)) {
    if (!RE_DIVIDA.test(linha)) continue;
    if (/#\d+/.test(linha) || linha.includes(MARCADOR_OPTOUT)) continue; // rastreada (issue) ou opt-out explícito
    n++;
  }
  return n;
}

/** FUNÇÃO PURA: julga cada mudança {arquivo, fonteBase, fonteHead}. Reprova se a dívida CRESCEU vs a base. */
export function julgar(mudancas) {
  const problemas = [];
  for (const m of mudancas) {
    const cb = contarDividaNaoRastreada(m.fonteBase), ch = contarDividaNaoRastreada(m.fonteHead);
    if (ch > cb) problemas.push({ tipo: 'divida-cresceu', arquivo: m.arquivo, detalhe: `dívida não-rastreada subiu de ${cb} pra ${ch} marcador(es) (TODO/FIXME/XXX/HACK sem issue)` });
  }
  return { ok: problemas.length === 0, problemas };
}

/** Coleta as mudanças de arquivos de código vs a base (git). paresBaseHead: DONO ÚNICO em lib/git-base.mjs
 *  (LEI 11) — deletado: head '' → 0 (remover dívida é ok); rename-aware (via `old`). */
export function medir({ repo, base }) {
  const mudancas = paresBaseHead(base, repo, (e) => RE_CODIGO.test(e.path));
  return { mudancas, julgamento: julgar(mudancas) };
}

function main() {
  const argv = process.argv.slice(2);
  const flagBase = (() => { const i = argv.indexOf('--base'); return i >= 0 ? argv[i + 1] : undefined; })();
  const repo = repoRaiz(process.cwd());
  if (!repo) { console.error(`[${NOME}] NÃO MEDIU: não estou num repositório git.`); process.exitCode = 2; return; }
  // R6 (2026-09-11): projeto declarado "stack":"python" não tem JS/TS pra este guard medir — NAO_APLICAVEL
  // exit 0, ANTES de qualquer outra regra.
  let stack;
  try { stack = stackDoProjeto(repo); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; return; }
  if (stack === 'python') { console.log(`[${NOME}] NAO_APLICAVEL: projeto declarado python no esteira.json — este guard só mede JS/TS.`); process.exitCode = 0; return; }
  const base = flagBase || baseDaEsteira(repo);
  if (!base) { console.error(`[${NOME}] NÃO MEDIU: informe --base <ref> (ou rode num projeto com esteira.json).`); process.exitCode = 2; return; }
  if (!temHead(repo)) { console.log(`[${NOME}] NAO_APLICAVEL: repositório ainda sem commit (primeiro commit).`); process.exitCode = 0; return; }
  if (!refExiste(base, repo)) { console.error(`[${NOME}] NÃO MEDIU: a base "${base}" não existe — git fetch primeiro.`); process.exitCode = 2; return; }
  let resultado;
  try { resultado = medir({ repo, base }); }
  catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; return; }
  const { mudancas, julgamento } = resultado;
  console.log(`[${NOME}] base ${base} · ${mudancas.length} arquivo(s) de código mudado(s) no diff`);
  if (julgamento.ok) { console.log(`[${NOME}] ✅ nenhum arquivo ganhou dívida não-rastreada (catraca intacta).`); process.exitCode = 0; return; }
  for (const p of julgamento.problemas) console.error(`[${NOME}] FALHA (${p.tipo}): ${p.arquivo} — ${p.detalhe}`);
  console.error(`[${NOME}] COMO PASSAR: LINKE a dívida a uma issue (\`// TODO(#123): ...\` ou cite \`#123\` na linha) pra ela virar dívida RASTREADA, ou resolva/remova o marcador. Se for MESMO pra deixar solta, comente com "${MARCADOR_OPTOUT}: <motivo>" na linha.`);
  console.error(`[${NOME}] POR QUE EXISTE: dívida sem issue não é rastreada — some do radar e vira sedimento.`);
  process.exitCode = 1;
}

// ── contra-prova com repo git REAL ───────────────────────────────────────────
// Marcadores MONTADOS por variável: nenhuma LINHA desta fonte tem o literal `// <marcador>` (evita auto-acusação).
const M_TODO = 'TO' + 'DO', M_FIXME = 'FIX' + 'ME';
const linhaDivida = (marker = M_TODO, sufixo = ': arrumar') => `// ${marker}${sufixo}`;
const fonteComDivida = (n, sufixo = ': arrumar') => `export const x = 1;\n${Array.from({ length: n }, () => linhaDivida(M_TODO, sufixo)).join('\n')}\n`;

function repoComArquivo(conteudoBase) {
  const dir = mkdtempSync(join(tmpdir(), 'tdr-self-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'mod.mjs'), conteudoBase);
  writeFileSync(join(dir, 'README.md'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']); g(['branch', 'base']);
  return { dir, g, alvo: join(dir, 'src', 'mod.mjs') };
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── contarDividaNaoRastreada (pura) ──
  check('conta marcador de comentário de linha (dois numa fonte) → 2', contarDividaNaoRastreada(linhaDivida(M_TODO) + '\n' + linhaDivida(M_FIXME)) === 2);
  check('conta marcador em bloco e em linha jsdoc → 2', contarDividaNaoRastreada('/* ' + 'X' + 'XX aqui */\n * ' + 'HA' + 'CK depois') === 2);
  check('NÃO conta identificador solto nem multiplicação (sem contexto de comentário)', contarDividaNaoRastreada('const ' + M_TODO + ' = 1;\nconst y = a * ' + M_TODO + ';') === 0);
  check('RASTREADA: issue #123 na linha → não conta', contarDividaNaoRastreada(linhaDivida(M_TODO, ' (#123): arrumar')) === 0);
  check('RASTREADA: opt-out divida-de-proposito → não conta', contarDividaNaoRastreada(linhaDivida(M_TODO, ': best-effort ' + MARCADOR_OPTOUT)) === 0);
  check('NÃO-rastreada: TODO sem issue → conta', contarDividaNaoRastreada(linhaDivida(M_TODO, ': depois')) === 1);
  check('VAZIO: fonte vazia/undefined → 0', contarDividaNaoRastreada('') === 0 && contarDividaNaoRastreada(undefined) === 0);

  // ── julgar (pura) ──
  check('julgar: dívida cresceu (1→2) → divida-cresceu', julgar([{ arquivo: 'f', fonteBase: fonteComDivida(1), fonteHead: fonteComDivida(2) }]).problemas.some((p) => p.tipo === 'divida-cresceu'));
  check('julgar: dívida estável (2→2) → ok', julgar([{ arquivo: 'f', fonteBase: fonteComDivida(2), fonteHead: fonteComDivida(2) }]).ok === true);
  check('julgar: dívida caiu (2→1) → ok', julgar([{ arquivo: 'f', fonteBase: fonteComDivida(2), fonteHead: fonteComDivida(1) }]).ok === true);
  check('julgar: arquivo NOVO com dívida (0→1) → divida-cresceu (dívida nova solta)', julgar([{ arquivo: 'f', fonteBase: '', fonteHead: fonteComDivida(1) }]).problemas.some((p) => p.tipo === 'divida-cresceu'));
  check('julgar: arquivo deletado (1→0) → ok', julgar([{ arquivo: 'f', fonteBase: fonteComDivida(1), fonteHead: '' }]).ok === true);
  check('julgar: trocar TODO solto por TODO com issue (1→0) → ok', julgar([{ arquivo: 'f', fonteBase: fonteComDivida(1), fonteHead: fonteComDivida(1, ' (#7): arrumar') }]).ok === true);

  // ── repo git REAL ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (cwd, args) => spawnSync(process.execPath, [meu, ...args], { cwd, encoding: 'utf8', timeout: 120_000, env: { ...envSemGit(), npm_lifecycle_event: '' } }).status;
  let t;
  try {
    t = repoComArquivo(fonteComDivida(1));
    const { dir, g, alvo } = t;
    // HEAD: adiciona mais um TODO solto → cresceu
    writeFileSync(alvo, fonteComDivida(2)); g(['add', '-A']); g(['commit', '-q', '-m', 'mais um TODO']);
    check('REPO REAL: arquivo ganhou dívida solta (1→2) → divida-cresceu', medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'divida-cresceu'));
    check('PORTA: dívida cresceu → exit 1', porta(dir, ['--base', 'base']) === 1);
    // volta pra 1 (estável) → ok
    writeFileSync(alvo, fonteComDivida(1)); g(['add', '-A']); g(['commit', '-q', '-m', 'remove o extra']);
    check('REPO REAL: dívida voltou ao nível da base → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: sem regressão → exit 0', porta(dir, ['--base', 'base']) === 0);
    // linka a issue → rastreada → ok mesmo com 2 marcadores
    writeFileSync(alvo, fonteComDivida(2, ' (#42): arrumar')); g(['add', '-A']); g(['commit', '-q', '-m', 'linka issues']);
    check('REPO REAL: 2 marcadores mas AMBOS com issue (#42) → ok (rastreada)', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    // arquivo NOVO com dívida solta → reprova
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'novo']);
    writeFileSync(join(dir, 'src', 'novo.mjs'), fonteComDivida(1)); g(['add', '-A']); g(['commit', '-q', '-m', 'arquivo novo com TODO solto']);
    check('REPO REAL: arquivo NOVO com dívida solta → divida-cresceu', medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'divida-cresceu'));
    // diff só de doc/sem dívida → ok
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'doc']); writeFileSync(join(dir, 'README.md'), 'y\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'doc']);
    check('REPO REAL: diff sem código de dívida → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    // PORTA: fora de repo / base inexistente / sem --base
    check('PORTA: fora de repositório git → exit 2', porta(tmpdir(), ['--base', 'base']) === 2);
    check('PORTA: base inexistente → exit 2', porta(dir, ['--base', 'nao-existe-de-verdade']) === 2);
    check('PORTA: sem --base → exit 2', porta(dir, []) === 2);
  } catch (e) {
    check(`REPO REAL: montagem falhou (${e?.message || e})`, false);
  } finally {
    if (t) { try { rmSync(t.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }

  // ── STACK (R6, 2026-09-11): "stack":"python" em esteira.json isenta este guard (só olha JS/TS) ──
  let tStack;
  try {
    tStack = repoComArquivo(fonteComDivida(1));
    const { dir, g, alvo } = tStack;
    writeFileSync(alvo, fonteComDivida(2)); // dívida cresceu de verdade — mas o projeto é python
    writeFileSync(join(dir, 'esteira.json'), JSON.stringify({ stack: 'python' }));
    g(['add', '-A']); g(['commit', '-q', '-m', 'mais dívida + declara stack python']);
    check('STACK: projeto python (esteira.json) → NAO_APLICAVEL exit 0, mesmo com dívida crescida', porta(dir, []) === 0);
    writeFileSync(join(dir, 'esteira.json'), JSON.stringify({ stack: 'node' }));
    g(['add', '-A']); g(['commit', '-q', '-m', 'declara stack node explícito']);
    check('STACK: projeto node (explícito) → regra normal (reprova a dívida crescida)', porta(dir, ['--base', 'base']) === 1);
  } catch (e) {
    check(`STACK: montagem falhou (${e?.message || e})`, false);
  } finally {
    if (tStack) { try { rmSync(tStack.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }
  let dirStackRuim;
  try {
    dirStackRuim = mkdtempSync(join(tmpdir(), 'tdr-stack-ruim-'));
    const g = (args) => execFileSync('git', args, { cwd: dirStackRuim, stdio: 'ignore', env: envSemGit() });
    g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
    writeFileSync(join(dirStackRuim, 'esteira.json'), '{ nao é json');
    writeFileSync(join(dirStackRuim, 'a.mjs'), 'export const x = 1;\n');
    g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
    check('STACK: esteira.json com JSON inválido → NÃO MEDIU exit 2 (nunca "node" silencioso)', porta(dirStackRuim, []) === 2);
  } catch (e) {
    check(`STACK: montagem do repo com esteira.json ruim falhou (${e?.message || e})`, false);
  } finally {
    if (dirStackRuim) { try { rmSync(dirStackRuim, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
