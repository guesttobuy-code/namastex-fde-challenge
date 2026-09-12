#!/usr/bin/env node
/**
 * frentes-panorama.mjs — "quem mais está mexendo aqui agora?"
 *
 * Existe para impedir o erro de agir com um fato de ONTEM como se fosse de agora: na esteira
 * de origem uma sessão propôs cobrar migrations já commitadas 40 min antes e abrir frente para
 * um conserto que outro PR já tinha feito 2 h antes. Cada fato tinha sido medido — na véspera.
 * Instrução não adiciona capacidade: "confira antes" vira ferramenta ou não existe.
 *
 * RESPONDE: 1. quem está vivo (branches claude/* com commit em 48 h) · 2. o que acabou de
 * entrar (PRs mergeados em 24 h) · 3. o que está em voo (PRs abertos).
 * NÃO responde "isso conflita com o que eu quero?" — isso exige intenção; a leitura é de quem age.
 * Sem `gh` autenticado mostra a parte local e avisa o que ficou de fora. Nunca falha.
 *
 * Uso: npm run frentes:panorama [-- --curto]
 */
import { execFileSync } from 'node:child_process';
import { getEsteira } from './lib/esteira.mjs';

const CURTO = process.argv.includes('--curto');
const HORAS_VIVO = 48, HORAS_RECEM = 24;
const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m' };

let cfg;
try { cfg = getEsteira(process.cwd()); }
catch (e) { console.log(`${C.yellow}panorama indisponível: ${e.message}${C.reset}`); process.exit(0); }

function tentar(cmd, args, timeoutMs = 30_000) {
  try { return execFileSync(cmd, args, { cwd: cfg.repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }); }
  catch { return null; }
}
const horasDesde = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? Infinity : (Date.now() - t) / 36e5; };
const humano = (h) => h < 1 ? `${Math.round(h * 60)}min` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;

function branchesVivas() {
  tentar('git', ['fetch', cfg.remote, '--quiet'], 60_000);
  const out = tentar('git', ['for-each-ref', '--sort=-committerdate', '--format=%(committerdate:iso8601)\t%(refname:short)\t%(contents:subject)', `refs/remotes/${cfg.remote}/claude/`]);
  if (out === null) return null;
  return out.split('\n').filter(Boolean).map((l) => {
    const [data, ref, ...resto] = l.split('\t');
    return { horas: horasDesde(data), nome: (ref || '').replace(new RegExp(`^${cfg.remote}/claude/`), ''), assunto: (resto.join('\t') || '').slice(0, 58) };
  }).filter((b) => b.horas <= HORAS_VIVO);
}
function prs(estado, limite) {
  const out = tentar('gh', ['pr', 'list', '--repo', cfg.repo, '--state', estado, '--limit', String(limite), '--json', 'number,title,headRefName,mergedAt,updatedAt'], 45_000);
  if (out === null) return null;
  try { return JSON.parse(out); } catch { return null; }
}
const linha = (t = '') => console.log(t);
const secao = (t) => { linha(); linha(`${C.bold}${C.cyan}${t}${C.reset}`); };

linha(`${C.bold}PANORAMA DAS FRENTES${C.reset} ${C.dim}— ${cfg.projeto} · ${cfg.repo} · quem mais está mexendo aqui agora${C.reset}`);
const semRede = [];

const vivas = branchesVivas();
secao(`1. Frentes vivas ${C.dim}(commit nas últimas ${HORAS_VIVO}h)${C.reset}`);
if (vivas === null) { linha(`   ${C.yellow}git indisponível${C.reset}`); semRede.push('branches'); }
else if (vivas.length === 0) linha(`   ${C.dim}nenhuma. Você provavelmente está sozinho agora.${C.reset}`);
else {
  for (const b of vivas.slice(0, CURTO ? 6 : 20)) linha(`   ${b.horas <= 2 ? C.green : ''}${humano(b.horas).padStart(5)}${C.reset}  ${b.nome.padEnd(34)} ${C.dim}${b.assunto}${C.reset}`);
  if (!CURTO && vivas.length > 20) linha(`   ${C.dim}… e mais ${vivas.length - 20}${C.reset}`);
}

const mergeados = prs('merged', 25);
secao(`2. Entrou em ${cfg.branchBase} ${C.dim}(últimas ${HORAS_RECEM}h)${C.reset}`);
if (mergeados === null) { linha(`   ${C.yellow}gh indisponível${C.reset}`); semRede.push('PRs mergeados'); }
else {
  const recentes = mergeados.filter((p) => p.mergedAt && horasDesde(p.mergedAt) <= HORAS_RECEM);
  if (recentes.length === 0) linha(`   ${C.dim}nada nas últimas ${HORAS_RECEM}h.${C.reset}`);
  else {
    for (const p of recentes.slice(0, CURTO ? 6 : 25)) linha(`   ${humano(horasDesde(p.mergedAt)).padStart(5)}  ${C.bold}#${p.number}${C.reset} ${p.headRefName.padEnd(30)} ${C.dim}${(p.title || '').slice(0, 44)}${C.reset}`);
    if (recentes.length > 6 && CURTO) linha(`   ${C.dim}… e mais ${recentes.length - 6}${C.reset}`);
  }
}

const abertos = prs('open', 25);
secao('3. Em voo (PRs abertos)');
if (abertos === null) { linha(`   ${C.yellow}gh indisponível${C.reset}`); semRede.push('PRs abertos'); }
else if (abertos.length === 0) linha(`   ${C.dim}nenhum.${C.reset}`);
else for (const p of abertos) linha(`   ${C.bold}#${p.number}${C.reset} ${p.headRefName.padEnd(34)} ${C.dim}${(p.title || '').slice(0, 44)}${C.reset}`);

linha();
linha(`${C.bold}Antes de prometer conserto, cobrar alguém ou abrir frente:${C.reset}`);
linha(`   ${C.dim}1.${C.reset} Alguém acima já está nisso? ${C.dim}(duplicar = dois donos para a mesma regra)${C.reset}`);
linha(`   ${C.dim}2.${C.reset} O fato que te trouxe aqui ainda é verdade? ${C.dim}re-meça AGORA${C.reset}`);
linha(`   ${C.dim}3.${C.reset} O que você vai cobrar já foi entregue? ${C.dim}confira antes de mandar${C.reset}`);
if (semRede.length) { linha(); linha(`${C.yellow}Panorama PARCIAL — ficou de fora: ${semRede.join(', ')}.${C.reset} ${C.dim}Provavelmente gh sem auth. O resto continua válido.${C.reset}`); }
linha();
