#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: o passo 3 da esteira exige um `## PLANO` publicado na issue ANTES da primeira
 *   linha de código (arquivos · chamadores colados · a regressão · quem pega · fora · rollback), e
 *   o item 4 — o teste que pegaria a regressão — escrito ANTES do conserto. Na esteira de origem
 *   isso era "disciplina, dívida declarada": ninguém cobrava por máquina, e o auditor só recusava
 *   PR sem plano quando lembrava. Aqui a cobrança nasce mecânica desde o primeiro PR.
 *
 * O QUE FAZ: lê o PR (corpo → issue do `Closes #N`, e a issue-mãe citada como
 *   `Análise de impacto: #M`), os comentários dessas issues e os commits do PR; acha o PRIMEIRO
 *   comentário que abre uma linha com `## PLANO`; exige os 6 itens com conteúdo; e exige que o
 *   plano tenha sido publicado ANTES do primeiro commit do PR.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. PR sem `Closes #N` (não há onde o plano morar) — SEM_ISSUE;
 *   2. issue sem `## PLANO` — SEM_PLANO;
 *   3. plano com item 3 ou 4 vazio/genérico ("pode quebrar algo") — PLANO_INCOMPLETO;
 *   4. plano publicado DEPOIS do primeiro commit — PLANO_DEPOIS_DO_CODIGO;
 *   5. "não consegui ler" saindo como exit 0 — sem dados é exit 2 (NÃO MEDIU).
 *
 * LIMITE CONHECIDO: (a) compara com a data de COMMIT do primeiro commit, que o autor controla
 *   (`--date`, amend) — é aproximação; o auditor do passo 4 confere `git log` do teste do item 4
 *   contra o commit do conserto; (b) julga FORMATO do plano, não se o item 3 é a regressão certa;
 *   (c) plano atualizado depois (item 1 crescendo) é legítimo — só o PRIMEIRO precisa anteceder o
 *   código.
 *
 * CONTRA-PROVA: `node guards/plano-na-issue.mjs --self-test`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';

const NOME = 'plano-na-issue';
export const R = Object.freeze({ OK: 'OK', SEM_ISSUE: 'SEM_ISSUE', SEM_PLANO: 'SEM_PLANO', PLANO_INCOMPLETO: 'PLANO_INCOMPLETO', PLANO_DEPOIS_DO_CODIGO: 'PLANO_DEPOIS_DO_CODIGO' });

const ITENS = [
  { n: 1, re: /\b(arquivos?|files?)\b/i },
  { n: 2, re: /\b(chamador|chamadores|callers?)\b/i },
  { n: 3, re: /\b(regress[aã]o|regression)\b/i },
  { n: 4, re: /\b(quem\s+pega|pega|catches?|who\s+catches)\b/i },
  { n: 5, re: /\b(fora|out\s+of\s+scope|fora\s+do\s+escopo)\b/i },
  { n: 6, re: /\b(rollback|desfaz)\b/i },
];
// "o que pode regredir" não aceita categoria — só um comportamento que funciona hoje + o teste que ficaria vermelho.
const GENERICO = /^(algo|nenhum|nada|n\/a|tbd|todo|-|\?)\.?$|\b(pode quebrar algo|risco baixo|mudan[cç]a pequena|os testes cobrem)\b/i;

/** Números das issues que o PR fecha (Closes/Fixes/Resolves #N) e a mãe citada como "Análise de impacto: #M". */
export function issuesDoCorpo(body) {
  const t = String(body ?? '');
  const closes = [...t.matchAll(/\b(closes?|fix(es|ed)?|resolves?)\s*:?\s*#(\d+)/gi)].map((m) => Number(m[3]));
  const mae = [...t.matchAll(/an[aá]lise\s+de\s+impacto\s*:\s*#(\d+)/gi)].map((m) => Number(m[1]));
  return { closes: [...new Set(closes)], mae: [...new Set(mae)] };
}

/** O comentário abre um `## PLANO` em alguma linha? Devolve o texto do plano (da linha até o fim) ou null. */
export function extrairPlano(body) {
  const linhas = String(body ?? '').split(/\r?\n/);
  const i = linhas.findIndex((l) => /^\s*##\s*PLANO\b/i.test(l));
  return i < 0 ? null : linhas.slice(i).join('\n');
}

/**
 * Itens do plano: cada linha que começa com número 1-6 (com ou sem ponto/parêntese) ou com o rótulo.
 * Devolve { presentes: [n...], vazios: [n...] } — vazio = sem texto além do rótulo, ou genérico.
 */
export function itensDoPlano(plano) {
  const linhas = String(plano ?? '').split(/\r?\n/);
  const presentes = new Set(); const vazios = new Set();
  for (const item of ITENS) {
    const idx = linhas.findIndex((l) => {
      const num = l.match(/^\s*(\d)[.)]?\s+(.*)$/);
      return (num && Number(num[1]) === item.n) || item.re.test(l.replace(/^\s*[-*]\s*/, '').slice(0, 40));
    });
    if (idx < 0) continue;
    presentes.add(item.n);
    // conteúdo = a própria linha sem número/rótulo + linhas seguintes até o próximo item/linha em branco
    // tira número, o RÓTULO em maiúsculas ("A REGRESSÃO", "QUEM PEGA", "FILES") e pontuação de abertura
    let texto = linhas[idx].replace(/^\s*(\d)[.)]?\s+/, '').replace(/^[A-ZÀ-Ü][A-ZÀ-Ü\s]*(?=\s|$)/, '').replace(item.re, '').replace(/^[\s:—–-]+/, '');
    for (let j = idx + 1; j < linhas.length; j++) {
      const l = linhas[j];
      if (!l.trim() || /^\s*(\d)[.)]?\s+/.test(l) || /^\s*#/.test(l)) break;
      texto += ' ' + l.trim();
    }
    texto = texto.trim();
    if (texto.length < 8 || GENERICO.test(texto)) vazios.add(item.n);
  }
  return { presentes: [...presentes].sort(), vazios: [...vazios].sort() };
}

/**
 * FUNÇÃO PURA. `comentarios`: [{ body, created_at }] das issues candidatas (Closes + mãe), em ordem
 * cronológica. `commits`: [{ sha, date }] do PR. `temIssue`: o corpo cita alguma issue?
 */
export function avaliar({ temIssue = true, comentarios = [], commits = [] } = {}) {
  if (!temIssue) return { estado: R.SEM_ISSUE, motivo: 'o corpo do PR não tem "Closes #N" — não há issue onde o PLANO possa morar' };
  const planos = comentarios.map((c) => ({ ...c, plano: extrairPlano(c.body) })).filter((c) => c.plano);
  if (planos.length === 0) return { estado: R.SEM_PLANO, motivo: 'nenhum comentário da issue abre uma linha com "## PLANO"' };
  const primeiro = planos.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
  const { presentes, vazios } = itensDoPlano(primeiro.plano);
  const faltando = [1, 2, 3, 4, 5, 6].filter((n) => !presentes.includes(n));
  if (faltando.length || vazios.length) {
    const partes = [];
    if (faltando.length) partes.push(`itens ausentes: ${faltando.join(', ')}`);
    if (vazios.length) partes.push(`itens vazios/genéricos: ${vazios.join(', ')}`);
    return { estado: R.PLANO_INCOMPLETO, motivo: `o PLANO de ${primeiro.created_at} tem ${partes.join('; ')} (os 6: arquivos · chamadores · regressão · quem pega · fora · rollback)`, plano: primeiro };
  }
  const datas = commits.map((c) => Date.parse(c.date)).filter((d) => !Number.isNaN(d));
  if (datas.length) {
    const primeiroCommit = Math.min(...datas);
    if (Date.parse(primeiro.created_at) > primeiroCommit) {
      const sha = commits.find((c) => Date.parse(c.date) === primeiroCommit)?.sha?.slice(0, 7) || '?';
      return { estado: R.PLANO_DEPOIS_DO_CODIGO, motivo: `o PLANO (${primeiro.created_at}) foi publicado DEPOIS do primeiro commit ${sha} (${new Date(primeiroCommit).toISOString()}) — plano depois do código não protege ninguém`, plano: primeiro };
    }
  }
  return { estado: R.OK, motivo: `PLANO publicado em ${primeiro.created_at}, 6 itens com conteúdo${datas.length ? ', antes do primeiro commit' : ' (PR sem commits ainda)'}`, plano: primeiro };
}

// ─── rede (só no CLI) ────────────────────────────────────────────────────────
function gh(args) { return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })); }

/** Decide o exit code a partir do resultado de avaliar() — um dono só para a porta. */
function concluir(pr, issues, commits, r) {
  console.log(`[${NOME}] PR #${pr} · issues ${issues.map((n) => `#${n}`).join(', ') || '(nenhuma)'} · ${commits.length} commit(s)`);
  console.log(`[${NOME}] ${r.estado === R.OK ? '✅' : '❌'} ${r.estado}: ${r.motivo}`);
  if (r.estado !== R.OK) {
    console.error('   FIX-HINT: publique como comentário na issue do Closes, ANTES de codar:');
    console.error('   ## PLANO — #N\n   1. ARQUIVOS … 2. CHAMADORES (grep colado) … 3. A REGRESSÃO … 4. QUEM PEGA … 5. FORA … 6. ROLLBACK');
    console.error('   Já codou? O plano ainda vale para o auditor, mas este check fica vermelho — é a regra, não um defeito.');
    process.exitCode = 1; return;
  }
  process.exitCode = 0;
}

/** `gh` e `env` injetáveis (issue #17): a agregação do caminho --pr é testada OFFLINE com gh mockado. */
export function main({ argv = process.argv.slice(2), gh: ghImpl = gh, env = process.env } = {}) {
  const valor = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  // --fixture <json>: {temIssue, comentarios:[{body,created_at}], commits:[{sha,date}]} — caminho OFFLINE da porta.
  const fixture = valor('--fixture');
  if (fixture) {
    let f; try { f = JSON.parse(readFileSync(fixture, 'utf8')); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: fixture ilegível: ${e.message}`); process.exitCode = 2; return; }
    return concluir('fixture', f.temIssue === false ? [] : [0], f.commits || [], avaliar({ temIssue: f.temIssue !== false, comentarios: f.comentarios || [], commits: f.commits || [] }));
  }
  const pr = valor('--pr');
  const repo = valor('--repo') || env.GITHUB_REPOSITORY;
  if (!pr || !repo) { console.error(`[${NOME}] NÃO MEDIU: use --pr <N> --repo owner/repo (ou GITHUB_REPOSITORY no ambiente).`); process.exitCode = 2; return; }
  try {
    const dados = ghImpl(['api', `repos/${repo}/pulls/${pr}`]);
    const { closes, mae } = issuesDoCorpo(dados.body);
    const issues = [...new Set([...closes, ...mae])];
    const comentarios = [];
    for (const n of issues) {
      const corpoIssue = ghImpl(['api', `repos/${repo}/issues/${n}`]);
      comentarios.push({ body: corpoIssue.body, created_at: corpoIssue.created_at });
      comentarios.push(...ghImpl(['api', `repos/${repo}/issues/${n}/comments?per_page=100`]).map((c) => ({ body: c.body, created_at: c.created_at })));
      // mãe citada no corpo da issue filha
      const { mae: maeDaFilha } = issuesDoCorpo(corpoIssue.body);
      for (const m of maeDaFilha) if (!issues.includes(m)) { issues.push(m); }
    }
    const commits = ghImpl(['api', `repos/${repo}/pulls/${pr}/commits?per_page=250`]).map((c) => ({ sha: c.sha, date: c.commit?.committer?.date }));
    concluir(pr, issues, commits, avaliar({ temIssue: issues.length > 0, comentarios, commits }));
  } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; }
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const PLANO = `## PLANO — #12\n\n1. ARQUIVOS   src/taxa.ts — dono da regra\n2. CHAMADORES  grep colado: src/a.ts:10, src/b.ts:22\n3. A REGRESSÃO  o card do financeiro deixa de somar taxa de limpeza\n4. QUEM PEGA   tests/financeiro.test.mjs (caso novo, escrito antes)\n5. FORA        o bug do wizard vira achado\n6. ROLLBACK    git revert <sha>`;
  const c = (body, at) => ({ body, created_at: at });
  const T0 = '2026-09-10T10:00:00Z', T1 = '2026-09-10T11:00:00Z', T2 = '2026-09-10T12:00:00Z';

  check('issuesDoCorpo: Closes #N e Fixes #M', JSON.stringify(issuesDoCorpo('Closes #12\nFixes: #13').closes) === '[12,13]');
  check('issuesDoCorpo: mãe citada', issuesDoCorpo('Análise de impacto: #9').mae[0] === 9);
  check('SEM_ISSUE quando o corpo não fecha issue', avaliar({ temIssue: false }).estado === R.SEM_ISSUE);
  check('SEM_PLANO quando nenhum comentário abre ## PLANO', avaliar({ comentarios: [c('vou fazer o plano depois', T0)], commits: [] }).estado === R.SEM_PLANO);
  check('OK: plano completo antes do primeiro commit', avaliar({ comentarios: [c(PLANO, T0)], commits: [{ sha: 'a'.repeat(40), date: T1 }] }).estado === R.OK);
  check('OK: PR sem commits ainda', avaliar({ comentarios: [c(PLANO, T0)], commits: [] }).estado === R.OK);
  check('BYPASS: plano publicado DEPOIS do primeiro commit → PLANO_DEPOIS_DO_CODIGO', avaliar({ comentarios: [c(PLANO, T2)], commits: [{ sha: 'b'.repeat(40), date: T1 }] }).estado === R.PLANO_DEPOIS_DO_CODIGO);
  check('BYPASS: plano tardio + plano antigo → o PRIMEIRO manda (vale se antecede o código)', avaliar({ comentarios: [c(PLANO, T2), c(PLANO, T0)], commits: [{ sha: 'b'.repeat(40), date: T1 }] }).estado === R.OK);
  check('BYPASS: item 3 vazio → PLANO_INCOMPLETO', avaliar({ comentarios: [c(PLANO.replace(/3\. A REGRESSÃO.*$/m, '3. A REGRESSÃO'), T0)] }).estado === R.PLANO_INCOMPLETO);
  check('BYPASS: item 3 genérico ("pode quebrar algo") → PLANO_INCOMPLETO', avaliar({ comentarios: [c(PLANO.replace(/3\. A REGRESSÃO.*$/m, '3. A REGRESSÃO pode quebrar algo'), T0)] }).estado === R.PLANO_INCOMPLETO);
  check('BYPASS: item 4 ausente → PLANO_INCOMPLETO citando o 4', (() => { const r = avaliar({ comentarios: [c(PLANO.replace(/4\. QUEM PEGA.*\n/, ''), T0)] }); return r.estado === R.PLANO_INCOMPLETO && /ausentes: 4/.test(r.motivo); })());
  check('BYPASS: "## PLANO" só mencionado no meio de uma linha não é plano', extrairPlano('vou escrever o ## PLANO amanhã') === null);
  check('BYPASS: "### PLANO" (nível 3) não abre plano', extrairPlano('### PLANO\n1. x') === null);
  check('plano em inglês (FILES/CALLERS/REGRESSION/CATCHES/OUT/ROLLBACK) é aceito', avaliar({ comentarios: [c('## PLANO\n1. FILES src/x.ts why\n2. CALLERS grep: a.ts:1\n3. REGRESSION the total stops adding fees\n4. WHO CATCHES tests/x.test.mjs new case\n5. OUT OF SCOPE wizard bug\n6. ROLLBACK git revert', T0)] }).estado === R.OK);
  check('itens com marcador "-" e numeração "1)" são aceitos', avaliar({ comentarios: [c(PLANO.replace(/^(\d)\. /gm, '$1) '), T0)] }).estado === R.OK);
  check('data de commit inválida não derruba (conta como sem commits)', avaliar({ comentarios: [c(PLANO, T0)], commits: [{ sha: 'x', date: 'não-é-data' }] }).estado === R.OK);

  // ── PORTA (issue #17): o guard como processo, exit code cobrado, via --fixture (offline) ──
  const dir = mkdtempSync(join(tmpdir(), 'pni-'));
  try {
    const porta = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '' } }).status;
    const fx = (nome, obj) => { const p = join(dir, nome); writeFileSync(p, JSON.stringify(obj)); return p; };
    check('PORTA: sem argumentos → exit 2', porta([]) === 2);
    check('PORTA: fixture SEM_PLANO → exit 1', porta(['--fixture', fx('a.json', { comentarios: [c('sem plano', T0)] })]) === 1);
    check('PORTA: fixture SEM_ISSUE → exit 1', porta(['--fixture', fx('b.json', { temIssue: false })]) === 1);
    check('PORTA: fixture OK → exit 0', porta(['--fixture', fx('c.json', { comentarios: [c(PLANO, T0)], commits: [{ sha: 'a'.repeat(40), date: T1 }] })]) === 0);
    check('PORTA: fixture ilegível → exit 2', porta(['--fixture', join(dir, 'nao-existe.json')]) === 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // ── PORTA do caminho --pr (issue #17): agregação `gh` mockada, sem rede ──
  // O caminho que o CI roda montava issues/comentários/commits a partir do gh e nenhum teste o
  // exercitava. gh mockado por rota; main() rodado em processo com console silenciado; exit conferido.
  const ghFake = (respostas) => (args) => { const caminho = args[1] || ''; for (const [re, val] of respostas) if (re.test(caminho)) return val; return []; };
  const rodarPr = (respostas) => {
    const log = console.log, err = console.error; console.log = () => {}; console.error = () => {};
    const antes = process.exitCode;
    try { process.exitCode = undefined; main({ argv: ['--pr', '7', '--repo', 'o/r'], gh: ghFake(respostas), env: {} }); return process.exitCode; }
    finally { console.log = log; console.error = err; process.exitCode = antes; }
  };
  const commit = (date) => [{ sha: 'a'.repeat(40), commit: { committer: { date } } }];
  check('PORTA --pr: PLANO antes do 1º commit → exit 0', rodarPr([[/pulls\/7$/, { body: 'Closes #12' }], [/issues\/12$/, { body: 'mãe', created_at: T0 }], [/issues\/12\/comments/, [{ body: PLANO, created_at: T0 }]], [/pulls\/7\/commits/, commit(T1)]]) === 0);
  check('PORTA --pr: PLANO depois do 1º commit → exit 1', rodarPr([[/pulls\/7$/, { body: 'Closes #12' }], [/issues\/12$/, { body: 'mãe', created_at: T0 }], [/issues\/12\/comments/, [{ body: PLANO, created_at: T2 }]], [/pulls\/7\/commits/, commit(T1)]]) === 1);
  check('PORTA --pr: sem Closes no corpo → SEM_ISSUE → exit 1', rodarPr([[/pulls\/7$/, { body: 'PR sem closes' }]]) === 1);

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
