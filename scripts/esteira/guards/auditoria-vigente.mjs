#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: o veredito de auditoria (passo 4) existia só como comentário em prosa, e NADA
 *   no servidor sabia qual valia. Na esteira de origem um PR recebeu 4 vereditos no mesmo dia e
 *   outro tinha 2 aprovações mais VELHAS que o HEAD — aprovadas contra código que já não estava
 *   lá. A regra "o auditor viu ESTE código" não tinha dono no servidor.
 *
 * O QUE FAZ: lê os comentários do PR, acha o ÚLTIMO cuja primeira linha começa com
 *   `## Auditoria para merge`, e só considera VIGENTE se essa linha (a) decidir APROVADO /
 *   APROVADO COM RESSALVAS, (b) não for DRAFT nem REPROVADO, e (c) CITAR o sha do HEAD (7+ hex).
 *   Publica como commit status `auditoria-vigente` no head.sha — único jeito de o gatilho
 *   `issue_comment` pintar o commit certo.
 *
 * POR QUE SHA E NÃO DATA: `committedDate` é a data do commit, não do push. Commit datado de
 *   ontem e empurrado depois da auditoria passaria num teste de data sem ninguém ter auditado.
 *   O sha citado prova que o auditor tinha aquele código à frente.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. `DRAFT: APROVADO COM RESSALVAS` contar como aprovação;
 *   2. aprovação que não cita o HEAD deixar o PR verde;
 *   3. um veredito VELHO vencer o mais novo (só o último conta);
 *   4. comentário que apenas MENCIONA a expressão no meio do corpo virar veredito;
 *   5. `NÃO APROVADO` passar por conter a palavra APROVADO.
 *
 * LIMITE CONHECIDO: (a) não verifica QUEM comentou; (b) o gatilho `issue_comment` só roda a partir
 *   da branch default — antes da promoção, `gh run rerun` do último run de pull_request recalcula
 *   com o mesmo HEAD; (c) não julga o CONTEÚDO do veredito, só forma e vigência.
 *
 * CONTRA-PROVA: `node guards/auditoria-vigente.mjs --self-test`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';

const NOME = 'auditoria-vigente';
const PREFIXO = /^##\s*auditoria\s+para\s+merge\b/i;
const CONTEXTO = 'auditoria-vigente';

export function primeiraLinha(corpo) {
  for (const linha of String(corpo ?? '').split('\n')) { const l = linha.replace(/\r$/, '').trim(); if (l) return l; }
  return '';
}
export function ehVeredito(corpo) { return PREFIXO.test(primeiraLinha(corpo)); }

export function decisaoDaLinha(linha) {
  const l = String(linha ?? '');
  if (/\bDRAFT\b/i.test(l)) return 'DRAFT';
  if (/\bN[ÃA]O\s+APROVAD[OA]\b/i.test(l)) return 'REPROVADO';
  if (/\bREPROVAD[OA]\b/i.test(l)) return 'REPROVADO';
  if (/\bAPROVAD[OA]\b/i.test(l)) return 'APROVADO';
  return null;
}
export function shasCitados(linha) {
  const achados = String(linha ?? '').match(/\b[0-9a-f]{7,40}\b/gi);
  return achados ? achados.map((s) => s.toLowerCase()) : [];
}
export function cobreHead(linha, headSha) {
  const head = String(headSha ?? '').toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(head)) return false;
  return shasCitados(linha).some((s) => head.startsWith(s));
}

export function avaliar({ comentarios = [], headSha = '' } = {}) {
  const vereditos = comentarios.filter((c) => ehVeredito(c && c.body));
  const curto = String(headSha).slice(0, 7);
  if (vereditos.length === 0) return { ok: false, estado: 'sem_veredito', descricao: `sem veredito: nenhum comentário abre com "## Auditoria para merge" (HEAD ${curto})` };
  const ultimo = vereditos[vereditos.length - 1];
  const linha = primeiraLinha(ultimo.body);
  const decisao = decisaoDaLinha(linha);
  const autor = ultimo?.user?.login ? ` (@${ultimo.user.login})` : '';
  if (decisao === 'DRAFT') return { ok: false, estado: 'draft', descricao: `veredito${autor} é DRAFT — o próprio auditor não o declarou mergeável`, veredito: ultimo };
  if (decisao === 'REPROVADO') return { ok: false, estado: 'reprovado', descricao: `veredito vigente${autor} = REPROVADO`, veredito: ultimo };
  if (decisao !== 'APROVADO') return { ok: false, estado: 'sem_decisao', descricao: `veredito${autor} sem palavra de decisão na 1ª linha (APROVADO / REPROVADO)`, veredito: ultimo };
  if (!cobreHead(linha, headSha)) {
    const citados = shasCitados(linha);
    return { ok: false, estado: 'nao_cobre_head', descricao: `aprovação não cobre o HEAD ${curto}: ${citados.length ? `cita ${citados[0].slice(0, 7)}` : 'não cita sha nenhum'}. Re-audite citando o sha`, veredito: ultimo };
  }
  return { ok: true, estado: 'vigente', descricao: `APROVADO${autor} para o HEAD ${curto}`, veredito: ultimo };
}

export function comoPassar(headSha) {
  const curto = String(headSha).slice(0, 7);
  return ['Como este check fica verde (o caminho, não só a reprovação):',
    '  1. Peça a re-auditoria ao chat auditor (passo 4: /4-auditar-pr-base <PR>).',
    '  2. O auditor comenta no PR abrindo com esta linha, CITANDO o sha do HEAD:', '',
    `     ## Auditoria para merge — APROVADO COM RESSALVAS (HEAD \`${curto}\`)`, '',
    '  3. Empurrar commit novo derruba o check de propósito: o veredito deixa de cobrir o HEAD.',
    '  Contrato do formato: governance/VEREDITO_AUDITORIA_CONTRACT.md'].join('\n');
}

async function api(caminho, opcoes) {
  const { metodo = 'GET', corpo } = opcoes || {};
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN/GH_TOKEN ausente — sem token não há como ler os comentários do PR.');
  const r = await fetch(`https://api.github.com${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': NOME, ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${metodo} ${caminho} → HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
async function todosOsComentarios(apiImpl, repo, pr) {
  const tudo = [];
  for (let p = 1; p <= 10; p++) { const lote = await apiImpl(`/repos/${repo}/issues/${pr}/comments?per_page=100&page=${p}`); tudo.push(...lote); if (lote.length < 100) break; }
  return tudo;
}

/** `api` e `env` injetáveis (issue #17): o wrapper --write-status é testado OFFLINE com api mockada. */
export async function principal({ argv = process.argv.slice(2), api: apiImpl = api, env = process.env } = {}) {
  const valor = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  // --fixture <json>: {headSha, comentarios:[{body,user:{login}}]} — porta OFFLINE: mesma decisão, sem API
  const fixture = valor('--fixture');
  if (fixture) {
    let f; try { f = JSON.parse(readFileSync(fixture, 'utf8')); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: fixture ilegível: ${e.message}`); return 2; }
    const r = avaliar({ comentarios: f.comentarios || [], headSha: f.headSha || '' });
    console.log(`[${NOME}] fixture · HEAD ${String(f.headSha || '').slice(0, 7)} · ${r.ok ? 'OK' : 'REPROVA'} ${r.estado}: ${r.descricao}`);
    if (!r.ok) console.log(`\n${comoPassar(f.headSha || '')}`);
    return r.ok ? 0 : 1;
  }
  const repo = valor('--repo') || env.GITHUB_REPOSITORY;
  const pr = valor('--pr');
  const escrever = argv.includes('--write-status');
  if (!repo || !pr) { console.error(`[${NOME}] uso: node guards/auditoria-vigente.mjs --pr <N> [--repo owner/name] [--write-status]`); return 2; }
  const dadosPr = await apiImpl(`/repos/${repo}/pulls/${pr}`);
  const headSha = dadosPr?.head?.sha;
  const comentarios = await todosOsComentarios(apiImpl, repo, pr);
  const r = avaliar({ comentarios, headSha });
  console.log(`[${NOME}] PR #${pr} · HEAD ${String(headSha).slice(0, 7)} · ${comentarios.filter((c) => ehVeredito(c.body)).length} veredito(s)`);
  console.log(`[${NOME}] ${r.ok ? 'OK' : 'REPROVA'} ${r.estado}: ${r.descricao}`);
  if (!r.ok) console.log(`\n${comoPassar(headSha)}`);
  if (escrever) {
    const run = env.GITHUB_RUN_ID ? `https://github.com/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
    await apiImpl(`/repos/${repo}/statuses/${headSha}`, { metodo: 'POST', corpo: { state: r.ok ? 'success' : 'failure', context: CONTEXTO, description: r.descricao.slice(0, 140), ...(run ? { target_url: run } : {}) } });
    console.log(`[${NOME}] commit status "${CONTEXTO}" = ${r.ok ? 'success' : 'failure'} em ${String(headSha).slice(0, 7)}`);
  }
  return r.ok ? 0 : 1;
}

async function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const HEAD = 'cd9b39c5e1a2b3c4d5e6f708192a3b4c5d6e7f80';
  const c = (body, user = 'dono') => ({ body, user: { login: user } });
  const est = (bodies) => avaliar({ comentarios: bodies.map((b) => c(b)), headSha: HEAD }).estado;

  check('sem comentário → sem_veredito', est([]) === 'sem_veredito');
  check('comentário sem prefixo → sem_veredito', est(['Rodei o full-check e passou, pode mergear']) === 'sem_veredito');
  check('REPROVADO → reprovado', est(['## Auditoria para merge — REPROVADO']) === 'reprovado');
  check('APROVADO sem sha → nao_cobre_head', est(['## Auditoria para merge — APROVADO COM RESSALVAS']) === 'nao_cobre_head');
  check('APROVADO citando o HEAD → vigente', avaliar({ comentarios: [c('## Auditoria para merge — APROVADO (HEAD `cd9b39c5e`)')], headSha: HEAD }).ok === true);
  check('BYPASS: DRAFT: APROVADO citando o HEAD → draft', est(['## Auditoria para merge — DRAFT: APROVADO COM RESSALVAS (HEAD `cd9b39c5e`)']) === 'draft');
  check('BYPASS: APROVADO citando OUTRO sha → nao_cobre_head', est(['## Auditoria para merge — APROVADO (HEAD `9b6a731d1`)']) === 'nao_cobre_head');
  check('BYPASS: NÃO APROVADO com o HEAD → reprovado', est(['## Auditoria para merge — NÃO APROVADO (HEAD `cd9b39c5e`)']) === 'reprovado');
  check('BYPASS: prefixo fora da 1ª linha não é veredito', est(['vale lembrar que\n## Auditoria para merge — APROVADO (HEAD `cd9b39c5e`)']) === 'sem_veredito');
  check('BYPASS: veredito VELHO aprovado + novo reprovado → reprovado (só o último conta)', est(['## Auditoria para merge — APROVADO (HEAD `cd9b39c5e`)', '## Auditoria para merge — REPROVADO']) === 'reprovado');
  check('reprovado antigo + aprovado novo com HEAD → vigente', est(['## Auditoria para merge — REPROVADO', '## Auditoria para merge (2ª rodada) — APROVADO COM RESSALVAS (HEAD cd9b39c5e1a2b3c4d5e6f708192a3b4c5d6e7f80)']) === 'vigente');
  check('BYPASS: último veredito sem decisão derruba o verde → sem_decisao', est(['## Auditoria para merge — APROVADO (HEAD `cd9b39c5e`)', '## Auditoria para merge — vou revisar amanhã']) === 'sem_decisao');
  check('qualificador entre parênteses e observação depois do sha são aceitos', est(['## Auditoria para merge (auditor EXTERNO, viés declarado) — APROVADO COM RESSALVAS (HEAD `cd9b39c5e`); as 2 ressalvas são de higiene']) === 'vigente');
  check('sha de 40 sem crase é aceito', cobreHead('APROVADO (HEAD cd9b39c5e1a2b3c4d5e6f708192a3b4c5d6e7f80)', HEAD) === true);
  check('BYPASS: HEAD inválido (não é sha de 40) nunca é coberto', cobreHead('APROVADO (HEAD `abc1234`)', 'abc1234') === false);
  check('CRLF na 1ª linha não quebra o prefixo', ehVeredito('## Auditoria para merge — APROVADO\r\ncorpo') === true);
  check('comoPassar cita o sha curto e a skill -base', /cd9b39c/.test(comoPassar(HEAD)) && /4-auditar-pr-base/.test(comoPassar(HEAD)));

  // ── PORTA (issue #17): o guard como processo, via --fixture (offline) ──
  const dir = mkdtempSync(join(tmpdir(), 'av-'));
  try {
    const porta = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', GITHUB_REPOSITORY: '' } }).status;
    const fx = (nome, obj) => { const p = join(dir, nome); writeFileSync(p, JSON.stringify(obj)); return p; };
    check('PORTA: sem argumentos → exit 2', porta([]) === 2);
    check('PORTA: fixture REPROVADO → exit 1', porta(['--fixture', fx('r.json', { headSha: HEAD, comentarios: [c('## Auditoria para merge — REPROVADO')] })]) === 1);
    check('PORTA: fixture aprovado sem sha → exit 1', porta(['--fixture', fx('s.json', { headSha: HEAD, comentarios: [c('## Auditoria para merge — APROVADO')] })]) === 1);
    check('PORTA: fixture vigente → exit 0', porta(['--fixture', fx('v.json', { headSha: HEAD, comentarios: [c('## Auditoria para merge — APROVADO (HEAD `cd9b39c5e`)')] })]) === 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // ── PORTA do wrapper --write-status (issue #17): api mockada, captura o commit status POSTado ──
  // Mata os mutantes do caminho de CI que nenhum teste rodava: "sempre posta success", "sempre exit 0",
  // "não posta". O status vigente/reprovado que o servidor lê tem que casar com a decisão de avaliar().
  const provaWrite = async (veredito) => {
    const posts = [];
    const fakeApi = async (caminho, opcoes) => {
      if (opcoes?.metodo === 'POST') { posts.push({ caminho, corpo: opcoes.corpo }); return {}; }
      if (/\/pulls\//.test(caminho)) return { head: { sha: HEAD } };
      if (/\/comments/.test(caminho)) return [c(veredito)];
      return [];
    };
    const exit = await principal({ argv: ['--pr', '7', '--repo', 'o/r', '--write-status'], api: fakeApi, env: {} });
    return { exit, status: posts.find((p) => /\/statuses\//.test(p.caminho))?.corpo?.state };
  };
  const wv = await provaWrite('## Auditoria para merge — APROVADO (HEAD `cd9b39c5e`)');
  check('PORTA --write-status: vigente → posta success e exit 0', wv.status === 'success' && wv.exit === 0);
  const wr = await provaWrite('## Auditoria para merge — REPROVADO');
  check('PORTA --write-status: reprovado → posta failure e exit 1', wr.status === 'failure' && wr.exit === 1);

  // ── PORTA (issue #17): uma REJEIÇÃO real de principal() cai no .catch do rodapé → exit 2 ──
  // A prova-de-vida pegou que o mutante `process.exitCode = 2 → 0` DO RODAPÉ sobrevivia: nenhum caso
  // forçava principal() a REJEITAR rodando como processo (o `porta([]) === 2` acima passa pelo `return 2`
  // do "sem argumentos", que flui pelo .then, não pelo .catch). Rodamos com --pr/--repo mas SEM token:
  // api() lança "token ausente" ANTES de qualquer rede (offline, determinístico), principal() rejeita, e o
  // rodapé precisa sair 2. "Quebrou ao rodar" nunca pode virar exit 0.
  const envSemToken = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GITHUB_TOKEN|GH_TOKEN|GITHUB_REPOSITORY)$/i.test(k)));
  envSemToken.npm_lifecycle_event = '';
  const portaCrua = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', timeout: 60_000, env: envSemToken }).status;
  check('PORTA: principal() rejeita rodando (sem token, --pr/--repo) → catch do rodapé → exit 2', portaCrua(['--pr', '7', '--repo', 'o/r']) === 2);

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) selfTest();
  else principal().then((code) => { process.exitCode = code; }).catch((e) => { console.error(`[${NOME}] ERRO: ${e?.message || e}`); process.exitCode = 2; });
}
