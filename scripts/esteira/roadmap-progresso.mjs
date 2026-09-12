#!/usr/bin/env node
/**
 * Instrumento de MEDIÇÃO do roadmap de guards (a skill /roadmap-base chama isto).
 *
 * POR QUE MEDE em vez de confiar no JSON: `status: "oficial"` é INTENÇÃO. A verdade é o guard
 * existir, estar cabeado, o self-test passar e (opcional) a prova-de-vida morder. Este script
 * reconcilia intenção × realidade e ACUSA divergência — um guard marcado "oficial" que não passa
 * na medição é uma mentira no roadmap, e o script sai != 0 por causa dela. "Feito" sem prova não
 * conta (LEI 7).
 *
 * USO:
 *   node scripts/roadmap-progresso.mjs           # mede existência + cabeamento + self-test
 *   node scripts/roadmap-progresso.mjs --full     # + prova-de-vida --only de cada guard (lento)
 *   node scripts/roadmap-progresso.mjs --rapido    # só existência + cabeamento (sem rodar self-test)
 *
 * SAÍDA: exit 0 normal; exit 1 se algum guard `oficial` falha a medição (divergência intenção×real).
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Layout-agnóstico (kit: scripts/guards; projeto do bootstrap: scripts/esteira/guards).
// RAIZ = primeiro ancestral com esteira.json OU package.json, subindo do próprio arquivo.
function acharRaiz(inicio) {
  let dir = inicio;
  const topo = parse(dir).root;
  while (true) {
    if (existsSync(join(dir, 'esteira.json')) || existsSync(join(dir, 'package.json'))) return dir;
    if (dir === topo) return inicio;
    dir = dirname(dir);
  }
}
const RAIZ = acharRaiz(dirname(fileURLToPath(import.meta.url)));
const GUARDS_DIR = [join(RAIZ, 'scripts', 'esteira', 'guards'), join(RAIZ, 'scripts', 'guards')].find(existsSync) || join(RAIZ, 'scripts', 'guards');
const ROADMAP = join(RAIZ, 'governance', 'GUARDS_ROADMAP.json');
const PKG = join(RAIZ, 'package.json');

const argv = process.argv.slice(2);
const MODO = argv.includes('--full') ? 'full' : argv.includes('--rapido') ? 'rapido' : 'normal';

/** GUARDS_ESPERADOS importado do dono único (guards-esperados.mjs, sem efeito colateral). Fallback []
 *  se o arquivo não existe (projeto sem a lista copiada) — degrada mostrando cabeamento✗, não quebra. */
async function guardsEsperados() {
  const alvo = join(GUARDS_DIR, 'guards-esperados.mjs');
  if (!existsSync(alvo)) return [];
  try { return (await import(pathToFileURL(alvo).href)).GUARDS_ESPERADOS || []; } catch { return []; }
}

function scriptsDoPackage() {
  try { return JSON.parse(readFileSync(PKG, 'utf8')).scripts || {}; } catch { return {}; }
}

function rodarSelfTest(arquivo) {
  const limpo = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  const r = spawnSync(process.execPath, [join(GUARDS_DIR, arquivo), '--self-test'], { encoding: 'utf8', timeout: 600_000, env: { ...limpo, npm_lifecycle_event: '' }, windowsHide: true });
  const texto = `${r.stdout || ''}\n${r.stderr || ''}`;
  const okLinha = /SELF-TEST OK — (\d+)\/(\d+) casos/.exec(texto);
  return { verde: r.status === 0 && !!okLinha, casos: okLinha ? Number(okLinha[2]) : 0 };
}

function rodarProvaDeVida(arquivo) {
  const limpo = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  const r = spawnSync(process.execPath, [join(GUARDS_DIR, 'prova-de-vida.mjs'), '--only', arquivo], { encoding: 'utf8', timeout: 600_000, env: { ...limpo, npm_lifecycle_event: '' }, windowsHide: true });
  return r.status === 0;
}

function medirGuard(g, esperados, scripts) {
  const existe = existsSync(join(GUARDS_DIR, g.arquivo));
  const cabeadoLista = esperados.includes(g.arquivo);
  const temNpm = Boolean(scripts[g.nome]) && Boolean(scripts[`${g.nome}:selftest`]);
  const cabeado = cabeadoLista && temNpm;
  let selfTest = null, casos = 0, provaVida = null;
  if (existe && MODO !== 'rapido') { const r = rodarSelfTest(g.arquivo); selfTest = r.verde; casos = r.casos; }
  if (existe && MODO === 'full') provaVida = rodarProvaDeVida(g.arquivo);
  // "verde" = tudo que ESTE modo conseguiu medir. rapido: só existe+cabeado (não rodou self-test, não
  // afirma a porta). normal: + self-test. full: + prova-de-vida. Assim rapido nunca acusa falsa
  // divergência por não ter medido o self-test.
  const verde = existe && cabeado && (MODO === 'rapido' ? true : selfTest === true && (MODO === 'full' ? provaVida === true : true));
  return { ...g, existe, cabeado, cabeadoLista, temNpm, selfTest, casos, provaVida, verde };
}

function icone(m) {
  if (!m.existe) return m.status === 'adiado' ? '⏸️ ' : '⬜';
  if (m.verde) return '✅';
  return '🟨'; // existe mas incompleto (falta cabeamento / self-test vermelho / prova-de-vida vermelha)
}

function detalhe(m) {
  if (!m.existe) return m.status === 'adiado' ? 'adiado (decisão do dono)' : 'planejado';
  const p = [];
  p.push(m.cabeadoLista ? 'GUARDS_ESPERADOS✓' : 'GUARDS_ESPERADOS✗');
  p.push(m.temNpm ? 'npm✓' : 'npm✗');
  if (m.selfTest !== null) p.push(m.selfTest ? `self-test ${m.casos}/${m.casos}` : 'self-test✗');
  if (m.provaVida !== null) p.push(m.provaVida ? 'prova-de-vida✓' : 'prova-de-vida✗');
  return p.join(' · ');
}

async function main() {
  if (!existsSync(ROADMAP)) { console.error(`[roadmap] não achei ${ROADMAP}`); process.exitCode = 2; return; }
  const roadmap = JSON.parse(readFileSync(ROADMAP, 'utf8'));
  const esperados = await guardsEsperados();
  const scripts = scriptsDoPackage();

  let totalPlan = 0, totalVerde = 0, divergencias = [];
  console.log(`\n📋 ROADMAP DE GUARDS — medição (${MODO})  ·  ${new Date().toISOString().slice(0, 16).replace('T', ' ')}\n`);

  for (const onda of roadmap.ondas) {
    const medidos = onda.guards.map((g) => medirGuard(g, esperados, scripts));
    const verdes = medidos.filter((m) => m.verde).length;
    const naoAdiados = medidos.filter((m) => m.status !== 'adiado').length;
    totalPlan += naoAdiados; totalVerde += verdes;
    const barra = '█'.repeat(verdes) + '░'.repeat(Math.max(0, naoAdiados - verdes));
    console.log(`ONDA ${onda.id} — ${onda.nome}   [${barra}] ${verdes}/${naoAdiados}`);
    for (const m of medidos) {
      console.log(`   ${icone(m)} ${m.nome.padEnd(22)} ${detalhe(m)}`);
      // divergência: declarado oficial mas não está verde de verdade
      if (m.status === 'oficial' && !m.verde) divergencias.push(`${m.nome}: declarado "oficial" mas ${detalhe(m)}`);
      // divergência ao contrário: verde de verdade mas ainda marcado planejado (roadmap desatualizado)
      if (m.verde && m.status === 'planejado') divergencias.push(`${m.nome}: já está VERDE mas o JSON diz "planejado" — atualize o status`);
    }
    console.log('');
  }

  const pct = totalPlan ? Math.round((totalVerde / totalPlan) * 100) : 0;
  console.log(`─────────────────────────────────────────────`);
  console.log(`TOTAL (ondas, sem adiados): ${totalVerde}/${totalPlan} guards oficiais medidos verdes — ${pct}%`);
  if (MODO === 'rapido') console.log(`(modo --rapido: não rodei self-tests; rode sem flag para medir de verdade)`);
  if (MODO === 'normal') console.log(`(rode --full para incluir a prova-de-vida de cada guard)`);

  if (divergencias.length) {
    console.error(`\n❌ ${divergencias.length} DIVERGÊNCIA(S) intenção×realidade:`);
    for (const d of divergencias) console.error(`   - ${d}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n✅ sem divergência: todo guard "oficial" passa a medição, nenhum verde está sub-declarado.`);
  process.exitCode = 0;
}

await main();
