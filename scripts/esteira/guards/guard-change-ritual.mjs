#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: "consertar" um guard pode ENFRAQUECÊ-LO sem ninguém ver — apagar casos do self-test
 *   pra ele parar de reprovar (LEI 74: o número de casos só cresce), ou gutar a certidão de INTENÇÃO.
 *   Um guard enfraquecido é PIOR que ausente: dá confiança falsa. Este meta-guard é a catraca — ao
 *   MEXER num guard, o nº de casos não pode cair e a certidão não pode sumir, comparado com a BASE.
 *
 * O QUE FAZ: pega os guards (scripts/guards/*.mjs) MUDADOS vs a base (git) e, pra cada um que na base
 *   TINHA casos/certidão, exige que o HEAD não regrida: nº de `check(` do self-test >= o da base, e a
 *   certidão (POR QUE EXISTE + CONTRA-PROVA) ainda presente. Guard NOVO (não existia na base) não tem
 *   o que catracar. Conta `check(` sobre o código DESPIDO (comentário/string não contam).
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. guard editado com MENOS casos de self-test que na base (catraca furada);
 *   2. guard editado com a certidão de INTENÇÃO gutada (perdeu POR QUE EXISTE e/ou CONTRA-PROVA).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) se os casos NOVOS são BONS (mordem de verdade) — isso é a
 *   prova-de-vida e o auditor; (b) guard novo (sem base) — só cobra a partir de quando ele existe; (c)
 *   enfraquecer a LÓGICA mantendo o nº de casos (trocar uma asserção por `true`) — o `true` literal é
 *   pego por leitura/auditoria, não por contagem; (d) libs fora de scripts/guards/ (guard-doctrine,
 *   despir) — escopo é a pasta de guards.
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial: (HOLE 1, alta) `temCertidao` testava as frases no
 *   fonte CRU — gutar o cabeçalho e manter "POR QUE EXISTE"/"CONTRA-PROVA" num comentário de linha (ou no
 *   fix-hint obrigatório da Parte 6) passava; agora só vale o bloco JSDoc que as contém. (HOLE 2) o runner
 *   (run-selftests, NAO_SAO_GUARDS) era catracado como guard → refactor legítimo dele reprovava; excluído.
 *   (git-base) `conteudoNaBase` fingia "arquivo novo" em QUALQUER erro do git — agora distingue ausente ×
 *   erro transitório (existeNaBase), pra um erro não virar "verde com ferramenta morta".
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — TRATADA: `check(` é contado sobre o código DESPIDO, e a certidão é lida do
 *     bloco JSDoc (não do fonte cru) — frase em comentário/string/fix-hint não infla nem falsifica.
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: opera sobre o diff do git (git-base), não segue import/link.
 *   BANCA: BASELINE — NÃO SE APLICA: não há allowlist; a "base" é o commit-base do git, não um arquivo editável.
 *   VAZIO/NULO/RENOMEAR/SUBSTITUIR(git mockável)/INVISÍVEL viram casos ou são cobertos pelo repo real do self-test.
 *
 * CONTRA-PROVA: node scripts/guards/guard-change-ritual.mjs --self-test — monta repo git real com um
 *   guard na base e prova: casos caíram → reprova; certidão gutada → reprova; mais casos → ok; guard novo → ok.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { despirCodigo } from '../lib/despir-codigo.mjs';
import { paresBaseHead, baseDaEsteira, temHead, refExiste, repoRaiz, envSemGit } from '../lib/git-base.mjs';
import { NAO_SAO_GUARDS } from './guards-esperados.mjs';

const NOME = 'guard-change-ritual';
const GUARDS_DIR = dirname(fileURLToPath(import.meta.url));

/** FUNÇÃO PURA: nº de chamadas check() do self-test (sobre o código DESPIDO — comentário/string não contam). */
export function contarCasos(fonte) {
  return (despirCodigo(String(fonte ?? '')).match(/\bcheck\s*\(/g) || []).length;
}
/** FUNÇÃO PURA: a certidão de INTENÇÃO (o bloco JSDoc de cabeçalho) está presente e íntegra?
 *  HOLE 1 da auditoria: testar as frases no fonte CRU deixava gutar o cabeçalho e manter as frases num
 *  comentário de linha ou no fix-hint (`console.error('[x] POR QUE EXISTE: ...')` — que a Parte 6 EXIGE).
 *  Só vale o bloco `/** ... *​/` que CONTÉM "POR QUE EXISTE" (o mesmo critério do guards-catalog). */
export function temCertidao(fonte) {
  const blocos = String(fonte ?? '').match(/\/\*\*[\s\S]*?\*\//g) || [];
  const cert = blocos.find((b) => /POR QUE EXISTE/.test(b));
  return !!cert && /CONTRA-PROVA/.test(cert);
}

/** FUNÇÃO PURA: julga cada mudança {arquivo, fonteBase, fonteHead}. Só cobra o que a BASE já tinha. */
export function julgar(mudancas) {
  const problemas = [];
  for (const m of mudancas) {
    if (!m.fonteBase) continue; // guard novo — nada a catracar
    const cb = contarCasos(m.fonteBase), ch = contarCasos(m.fonteHead);
    if (cb > 0 && ch < cb) problemas.push({ tipo: 'casos-diminuiram', arquivo: m.arquivo, detalhe: `self-test caiu de ${cb} pra ${ch} caso(s) (catraca: só cresce)` });
    if (temCertidao(m.fonteBase) && !temCertidao(m.fonteHead)) problemas.push({ tipo: 'certidao-gutada', arquivo: m.arquivo, detalhe: 'a certidão de INTENÇÃO sumiu (falta POR QUE EXISTE e/ou CONTRA-PROVA)' });
  }
  return { ok: problemas.length === 0, problemas };
}

// A pasta de guards é por CONVENÇÃO (kit: scripts/guards; projeto do bootstrap: scripts/esteira/guards),
// não pelo caminho DESTE arquivo — senão, rodando num repo qualquer (ex.: o repo temporário do self-test),
// o escopo apontaria pra fora. git dá caminhos com "/".
const RE_GUARD_PATH = /^scripts\/(?:esteira\/)?guards\/[a-z0-9-]+\.mjs$/;

/** Coleta as mudanças de guards vs a base (git). paresBaseHead: DONO ÚNICO em lib/git-base.mjs (LEI 11)
 *  — guard deletado: fonteHead '' (deleção é do guards-catalog/guard-wiring); rename-aware (HOLE 1). */
export function medir({ repo, base }) {
  // NAO_SAO_GUARDS (run-selftests, guards-esperados) NÃO são guards — o runner tem self-test próprio e não
  // deve ser catracado aqui (HOLE 2 da auditoria: refactor legítimo do runner era falso-positivo).
  const mudancas = paresBaseHead(base, repo, (e) => RE_GUARD_PATH.test(e.path) && !NAO_SAO_GUARDS.includes(basename(e.path)));
  return { mudancas, julgamento: julgar(mudancas) };
}

// Seta process.exitCode DIRETO (estilo companion-red-green): assim cada `process.exitCode = 2/1` é
// exercitado pelos casos PORTA e a prova-de-vida morde as mutações da porta (a lição do auditoria-vigente).
/** Base do esteira.json (remote/branch_base), pra rodar sem --base no pre-commit (como o companion). */
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
  console.log(`[${NOME}] base ${base} · ${mudancas.length} guard(s) mudado(s) no diff`);
  if (julgamento.ok) { console.log(`[${NOME}] ✅ nenhum guard regrediu (casos só cresceram, certidão intacta).`); process.exitCode = 0; return; }
  for (const p of julgamento.problemas) console.error(`[${NOME}] FALHA (${p.tipo}): ${p.arquivo} — ${p.detalhe}`);
  console.error(`[${NOME}] COMO PASSAR: um guard não perde casos de self-test nem a certidão. Se um caso ficou obsoleto, RENOMEIE/substitua (o total não cai); nunca apague pra o guard parar de reprovar.`);
  console.error(`[${NOME}] POR QUE EXISTE: guard enfraquecido dá confiança falsa — pior que ausente.`);
  process.exitCode = 1;
}

// ─── contra-prova com repo git REAL ──────────────────────────────────────────
const CERT = '/**\n * POR QUE EXISTE: x. CONTRA-PROVA: node g --self-test\n */';
const guardFonte = (nCasos, comCert = true) => `#!/usr/bin/env node\n${comCert ? CERT : '// sem certidao'}\nfunction selfTest(){ const casos=[]; const check=(n,c)=>casos.push({n,c});\n${Array.from({ length: nCasos }, (_, k) => `  check('c${k}', true);`).join('\n')}\n}\n`;
// HOLE 1: cabeçalho gutado, mas as frases sobrevivem num comentário de LINHA (sem o bloco /** */).
const guardFraseSolta = (nCasos) => `#!/usr/bin/env node\n// gutou o cabecalho, deixou as frases: POR QUE EXISTE / CONTRA-PROVA\nfunction selfTest(){ const casos=[]; const check=(n,c)=>casos.push({n,c});\n${Array.from({ length: nCasos }, (_, k) => `  check('c${k}', true);`).join('\n')}\n}\n`;

function repoComGuard(nCasosBase, nome = 'alvo.mjs') {
  const dir = mkdtempSync(join(tmpdir(), 'gcr-self-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  mkdirSync(join(dir, 'scripts', 'guards'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'guards', nome), guardFonte(nCasosBase));
  writeFileSync(join(dir, 'README.md'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']); g(['branch', 'base']);
  return { dir, g, alvo: join(dir, 'scripts', 'guards', nome) };
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── funções puras ──
  check('contarCasos: conta as chamadas check() do fonte', contarCasos(guardFonte(3)) === 3);
  check('BYPASS (COMENTÁRIO/STRING): check( em comentário/string NÃO conta (despido)', contarCasos('// check(x)\nconst s = "check(y)"; ' + guardFonte(2)) === 2);
  check('temCertidao: com POR QUE EXISTE + CONTRA-PROVA no bloco → true; sem → false', temCertidao(guardFonte(1, true)) === true && temCertidao(guardFonte(1, false)) === false);
  check('BYPASS (HOLE 1): frases só num COMENTÁRIO de linha (sem bloco /** */) → false', temCertidao(guardFraseSolta(1)) === false);
  check('BYPASS (HOLE 1): frases só no fix-hint do CÓDIGO (console.error) → false', temCertidao('const x=1;\nconsole.error("[g] POR QUE EXISTE: y");\nconsole.error("CONTRA-PROVA: z");') === false);
  check('BYPASS (HOLE 1): gutar o cabeçalho mantendo as frases num comentário → certidao-gutada', julgar([{ arquivo: 'g', fonteBase: guardFonte(3), fonteHead: guardFraseSolta(3) }]).problemas.some((p) => p.tipo === 'certidao-gutada'));
  check('julgar: casos caíram → casos-diminuiram', julgar([{ arquivo: 'g', fonteBase: guardFonte(3), fonteHead: guardFonte(2) }]).problemas.some((p) => p.tipo === 'casos-diminuiram'));
  check('julgar: certidão gutada → certidao-gutada', julgar([{ arquivo: 'g', fonteBase: guardFonte(3), fonteHead: guardFonte(3, false) }]).problemas.some((p) => p.tipo === 'certidao-gutada'));
  check('julgar: mais casos + certidão intacta → ok', julgar([{ arquivo: 'g', fonteBase: guardFonte(3), fonteHead: guardFonte(4) }]).ok === true);
  check('julgar: guard NOVO (sem base) → ok (nada a catracar)', julgar([{ arquivo: 'g', fonteBase: '', fonteHead: guardFonte(1) }]).ok === true);
  check('julgar: mesmo nº de casos → ok', julgar([{ arquivo: 'g', fonteBase: guardFonte(3), fonteHead: guardFonte(3) }]).ok === true);

  // ── repo git REAL ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (cwd, args) => spawnSync(process.execPath, [meu, ...args], { cwd, encoding: 'utf8', timeout: 120_000, env: { ...envSemGit(), npm_lifecycle_event: '' } }).status;
  let t;
  try {
    t = repoComGuard(3);
    const { dir, g, alvo } = t;
    // HEAD: apaga 1 caso → catraca furada
    writeFileSync(alvo, guardFonte(2)); g(['add', '-A']); g(['commit', '-q', '-m', 'tirou caso']);
    check('REPO REAL: guard perdeu 1 caso vs base → casos-diminuiram', medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'casos-diminuiram'));
    check('PORTA: casos caíram → exit 1', porta(dir, ['--base', 'base']) === 1);
    // volta pra 4 casos → ok
    writeFileSync(alvo, guardFonte(4)); g(['add', '-A']); g(['commit', '-q', '-m', 'mais casos']);
    check('REPO REAL: guard ganhou casos → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    check('PORTA: sem regressão → exit 0', porta(dir, ['--base', 'base']) === 0);
    // certidão gutada
    writeFileSync(alvo, guardFonte(4, false)); g(['add', '-A']); g(['commit', '-q', '-m', 'gutou certidao']);
    check('REPO REAL: certidão gutada → certidao-gutada', medir({ repo: dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'certidao-gutada'));
    // diff só de doc → nenhum guard → ok
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'doc']); writeFileSync(join(dir, 'README.md'), 'y\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'doc']);
    check('REPO REAL: diff só de doc → nenhum guard mudado → ok', medir({ repo: dir, base: 'base' }).julgamento.ok === true);
    // HOLE 2: NAO_SAO_GUARDS (run-selftests) NÃO é catracado — refactor legítimo do runner não é falso-positivo
    const t2 = repoComGuard(3, 'run-selftests.mjs');
    try {
      writeFileSync(t2.alvo, guardFonte(1)); t2.g(['add', '-A']); t2.g(['commit', '-q', '-m', 'consolida casos do runner']);
      check('HOLE 2: run-selftests.mjs reduzido (3→1) NÃO é flagrado (fora da catraca)', medir({ repo: t2.dir, base: 'base' }).julgamento.ok === true);
    } finally { try { rmSync(t2.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
    // HOLE 1: rename-awareness (arquivosMudados -M). Renomear o guard no mesmo commit não pode
    // (a) ESCONDER a perda de casos nem (b) FALSAR um rename legítimo como se fosse deleção.
    const t3 = repoComGuard(6);
    try {
      t3.g(['mv', 'scripts/guards/alvo.mjs', 'scripts/guards/renomeado.mjs']);
      writeFileSync(join(t3.dir, 'scripts', 'guards', 'renomeado.mjs'), guardFonte(2));
      t3.g(['add', '-A']); t3.g(['commit', '-q', '-m', 'rename + tirou casos']);
      check('HOLE 1a: renomear escondendo perda de casos (6→2) → casos-diminuiram', medir({ repo: t3.dir, base: 'base' }).julgamento.problemas.some((p) => p.tipo === 'casos-diminuiram'));
    } finally { try { rmSync(t3.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
    // HOLE 1b: rename LEGÍTIMO (mesmos casos, certidão intacta) → ok. SEM o pareamento -M, o par
    // (deleta alvo=6, cria renomeado=novo) leria como "alvo perdeu 6→0" = falso-positivo. Este caso
    // trava a rename-awareness: se alguém tirar o -M do git-base, ele fica VERMELHO.
    const t4 = repoComGuard(6);
    try {
      t4.g(['mv', 'scripts/guards/alvo.mjs', 'scripts/guards/renomeado.mjs']);
      t4.g(['add', '-A']); t4.g(['commit', '-q', '-m', 'rename puro (mesmos casos)']);
      check('HOLE 1b: rename legítimo (6→6, mesma certidão) → ok (sem falso-positivo de deleção)', medir({ repo: t4.dir, base: 'base' }).julgamento.ok === true);
    } finally { try { rmSync(t4.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
    // PORTA: fora de repo / base inexistente
    check('PORTA: fora de repositório git → exit 2', porta(tmpdir(), ['--base', 'base']) === 2);
    check('PORTA: base inexistente → exit 2', porta(dir, ['--base', 'nao-existe-de-verdade']) === 2);
    check('PORTA: sem --base → exit 2', porta(dir, []) === 2);
  } catch (e) {
    check(`REPO REAL: montagem falhou (${e?.message || e})`, false);
  } finally {
    if (t) { try { rmSync(t.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
  }
  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
