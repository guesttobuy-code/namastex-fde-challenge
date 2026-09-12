#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: LEI 73 — 1 chat = 1 branch = 1 worktree = 1 PR = 1 frente rastreável. O quinto
 *   termo só existe se o registro `_frentes/<slug>.md` estiver no PR com dono (`chat_id`), endereço
 *   de retorno (`app_session_id`) e vínculo (`github_frente`). Na esteira de origem, 225 de 231
 *   registros históricos tinham `chat_id` vazio: o mecanismo estava "tecnicamente correto e
 *   praticamente morto". O auditor não consegue entregar veredito a um dono que não existe.
 *
 * O QUE FAZ: dado o slug (`--slug`, ou `claude/<slug>` da branch atual), lê
 *   `<codigo>/governance/active-work/_frentes/<slug>.md` e exige os três campos preenchidos e
 *   `status: aberta`. Cita `arquivo:linha` do campo vazio.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. PR de branch `claude/<slug>` sem registro — SEM_REGISTRO;
 *   2. registro com `chat_id`, `app_session_id` ou `github_frente` vazio — CAMPO_VAZIO;
 *   3. branch que não é `claude/*` sendo julgada como frente — NAO_APLICAVEL (0), nunca falso vermelho.
 *
 * LIMITE CONHECIDO: julga presença e formato, não se o id aponta para uma sessão viva. Frente
 *   aberta por chat coordenador nasce com `chat_id` do lançador — é o dono até o chat novo assumir.
 *
 * CONTRA-PROVA: `node guards/frente-registro.mjs --self-test`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { lerCampoDeTexto, linhaDoCampo } from '../lib/frente-registro.mjs';

const NOME = 'frente-registro';
export const R = Object.freeze({ OK: 'OK', SEM_REGISTRO: 'SEM_REGISTRO', CAMPO_VAZIO: 'CAMPO_VAZIO', STATUS_ERRADO: 'STATUS_ERRADO', NAO_APLICAVEL: 'NAO_APLICAVEL' });
const OBRIGATORIOS = ['chat_id', 'app_session_id', 'github_frente'];

/** FUNÇÃO PURA: julga o texto do registro (ou null = arquivo ausente). */
export function julgar(texto, { slug = '?', arquivo = '' } = {}) {
  if (texto == null) return { estado: R.SEM_REGISTRO, motivo: `a frente "${slug}" não tem registro em ${arquivo || '_frentes/<slug>.md'} — a worktree foi aberta fora do frente:abrir?` };
  const vazios = OBRIGATORIOS.filter((c) => !lerCampoDeTexto(texto, c));
  if (vazios.length) {
    const onde = vazios.map((c) => `${c} (${arquivo}:${linhaDoCampo(texto, c) ?? '?'})`).join(', ');
    return { estado: R.CAMPO_VAZIO, motivo: `campo(s) vazio(s) no registro: ${onde}`, vazios };
  }
  const status = lerCampoDeTexto(texto, 'status');
  if (status !== 'aberta') return { estado: R.STATUS_ERRADO, motivo: `status "${status}" — PR de frente que já pousou (${arquivo}:${linhaDoCampo(texto, 'status') ?? '?'})` };
  return { estado: R.OK, motivo: 'registro com dono, endereço de retorno e vínculo' };
}

async function main() {
  const argv = process.argv.slice(2);
  const valor = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  let cfg = null;
  try { const { getEsteira } = await import('../lib/esteira.mjs'); cfg = getEsteira(process.cwd()); } catch { /* ignora-de-proposito: fora de projeto: usa cwd */ }
  const codigoRoot = cfg ? cfg.codigoRoot : process.cwd();
  let branch = valor('--slug') ? `claude/${valor('--slug').replace(/^claude\//, '')}` : '';
  if (!branch) { try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: codigoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* ignora-de-proposito: sem git */ } }
  if (!branch.startsWith('claude/')) { console.log(`[${NOME}] NAO_APLICAVEL: "${branch || '?'}" não é branch de frente (claude/<slug>).`); process.exitCode = 0; return; }
  const slug = branch.slice(7);
  const arquivo = `governance/active-work/_frentes/${slug}.md`;
  const caminho = join(codigoRoot, arquivo);
  const texto = existsSync(caminho) ? readFileSync(caminho, 'utf8') : null;
  const r = julgar(texto, { slug, arquivo });
  console.log(`[${NOME}] frente ${slug} · ${r.estado === R.OK ? '✅' : '❌'} ${r.estado}: ${r.motivo}`);
  if (r.estado !== R.OK) {
    console.error('   FIX-HINT: na worktree da frente, rode /ligar-frente-base (cria a label, grava github_frente e app_session_id).');
    console.error('   chat_id vazio → abra a sessão Claude DENTRO da worktree (o hook base-frente-check preenche). Commite o registro junto.');
    process.exitCode = 1; return;
  }
  process.exitCode = 0;
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const REG = (chat, app, gh, status = 'aberta') => `﻿---\r\nprojeto: p\r\nslug: x\r\nbranch: claude/x\r\nchat_id: "${chat}"\r\napp_session_id: "${app}"\r\nsession_title: ""\r\nstatus: ${status}\r\npr: ""\r\ngithub_frente: "${gh}"\r\nclosed_at: ""\r\n---\r\n`;
  check('registro completo e aberta → OK', julgar(REG('abc', 'local_1', 'frente:x')).estado === R.OK);
  check('arquivo ausente → SEM_REGISTRO', julgar(null, { slug: 'x' }).estado === R.SEM_REGISTRO);
  check('INCIDENTE: chat_id vazio → CAMPO_VAZIO citando o campo e a linha', (() => { const r = julgar(REG('', 'local_1', 'frente:x'), { arquivo: 'f.md' }); return r.estado === R.CAMPO_VAZIO && /chat_id \(f\.md:5\)/.test(r.motivo); })());
  check('app_session_id vazio → CAMPO_VAZIO', julgar(REG('abc', '', 'frente:x')).vazios?.includes('app_session_id'));
  check('github_frente vazio → CAMPO_VAZIO', julgar(REG('abc', 'local_1', '')).vazios?.includes('github_frente'));
  check('BYPASS: os três vazios listam os três', julgar(REG('', '', '')).vazios?.length === 3);
  check('BYPASS: frente já pousada (status mergeado) → STATUS_ERRADO', julgar(REG('abc', 'local_1', 'frente:x', 'mergeado')).estado === R.STATUS_ERRADO);
  check('BOM + CRLF não atrapalham a leitura', julgar(REG('abc', 'local_1', 'frente:x')).estado === R.OK);
  check('BYPASS: campo sem aspas mas vazio (`chat_id:`) continua vazio', julgar(REG('abc', 'local_1', 'frente:x').replace('chat_id: "abc"', 'chat_id:')).estado === R.CAMPO_VAZIO);

  // ── PORTA (issue #17): o guard como processo num projeto temporário (sem esteira.json → cwd é o código) ──
  const dir = mkdtempSync(join(tmpdir(), 'fr-'));
  try {
    mkdirSync(join(dir, 'governance', 'active-work', '_frentes'), { recursive: true });
    writeFileSync(join(dir, 'governance', 'active-work', '_frentes', 'ok.md'), REG('abc', 'local_1', 'frente:ok'));
    writeFileSync(join(dir, 'governance', 'active-work', '_frentes', 'vazia.md'), REG('', '', ''));
    const porta = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '' } }).status;
    check('PORTA: --slug com registro completo → exit 0', porta(['--slug', 'ok']) === 0);
    check('PORTA: --slug com campos vazios → exit 1', porta(['--slug', 'vazia']) === 1);
    check('PORTA: --slug sem registro → exit 1', porta(['--slug', 'nao-existe']) === 1);
    check('PORTA: branch que não é claude/* → NAO_APLICAVEL exit 0', porta([]) === 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
