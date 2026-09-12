#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE (LEI 10; incidente kit #11): guard sem chamador não existe. Um `.mjs` pode nascer
 *   em scripts/guards/ e nunca rodar — fora de GUARDS_ESPERADOS (o runner não o descobre como
 *   esperado) ou sem `npm run <x>`/`<x>:selftest` (ninguém o roda isolado). No #11 uma linha na
 *   doutrina silenciou 5 guards e tudo ficou verde: "roda" sem "é cobrado que rode" é confiança falsa.
 *
 * O QUE FAZ: cruza três fontes — os arquivos em scripts/guards/, a lista GUARDS_ESPERADOS e os
 *   VALORES dos scripts do package.json (o comando `node <rel>/<arquivo>`, não a CHAVE — as chaves
 *   não batem com o nome do arquivo: `companion:red-green` → `companion-red-green.mjs`). Para cada
 *   guard REAL exige: (a) estar em GUARDS_ESPERADOS; (b) ter um script cujo valor é `node <rel>/<f>`;
 *   (c) ter um script cujo valor é `node <rel>/<f> --self-test`. E acusa: entrada MORTA na lista
 *   (arquivo citado que não existe), infraestrutura indevida na lista, e NAO_SAO_GUARDS adulterada.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. guard `.mjs` fora de GUARDS_ESPERADOS (nasce e nunca roda no runner);
 *   2. guard sem `npm run <x>` E `<x>:selftest` (não dá pra rodar/contra-provar isolado);
 *   3. GUARDS_ESPERADOS citando arquivo inexistente (entrada morta — "roda N guards" mente);
 *   4. esconder um guard metendo o nome dele em NAO_SAO_GUARDS (exceção disfarçada de deleção);
 *   5. guard com nome NÃO-kebab (maiúscula, `_`, `.`, ext `.MJS`) — o runner o ignora (mesma regex), some da rede.
 *
 * MODO DE FALHA JÁ ESCAPADO: a 1ª auditoria adversarial (subagente) achou DOIS buracos, corrigidos:
 *   (a) coletava por /\.mjs$/i mas classificava guard por /^[a-z0-9-]+.mjs$/ — um `Malicioso.mjs` não-kebab
 *   passava batido (guard invisível, o próprio incidente #11); agora `nome-nao-canonico` reprova alto.
 *   (b) casava o script por igualdade EXATA — `node ./scripts/guards/x.mjs` (válido) era falso-positivo;
 *   agora `analisaValor` aceita `node <alvo>` e `node ./<alvo>`.
 *   (c) 2ª auditoria: o tokenizer permissivo do conserto (b) aceitava FLAG — `node --check <alvo>` (que
 *   só faz syntax-check, NÃO roda) passava como runner (falso-negativo, o pior tipo aqui). Corrigido:
 *   `analisaValor` casa estrito (`node <alvo>`/`node ./<alvo>`), sem flag/wrapper (limite documentado).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: se o guard MORDE algo (isso é prova-de-vida + o campo minado); só se
 *   está CABEADO. Não lê o YAML do CI: no kit não há CI próprio, e todo guard esperado roda pelo
 *   `run-selftests` (que É um job do CI do template) — o elo de CI é coberto TRANSITIVAMENTE por
 *   estar em GUARDS_ESPERADOS. A independência do auditor: uso uma lista de infraestrutura PRÓPRIA
 *   (INFRAESTRUTURA, hardcoded), não confio no NAO_SAO_GUARDS que estou justamente auditando.
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — NÃO SE APLICA: não lê padrão em código; lê lista e valores de script
 *     estruturados (array e package.json), não texto de fonte onde aspas/comentário enganariam.
 *   BANCA: IMPORT — NÃO SE APLICA: o cabeamento é por comando `node <arquivo>` EXPLÍCITO no
 *     package.json; não há alias/re-export/import dinâmico no mecanismo de casamento.
 *   BANCA: PATH — NÃO SE APLICA: lê a pasta por readdirSync e o package.json por caminho fixo
 *     derivado da própria localização; nenhum caminho vem de entrada externa (sem link a resolver).
 *   As classes VAZIO, BASELINE, NULO, RENOMEAR, INVISÍVEL e SUBSTITUIR viram casos `BYPASS:` no self-test.
 *
 * CONTRA-PROVA: node scripts/guards/guard-wiring.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { GUARDS_ESPERADOS, NAO_SAO_GUARDS } from './guards-esperados.mjs';

const NOME = 'guard-wiring';
const GUARDS_DIR = dirname(fileURLToPath(import.meta.url));
// Lista PRÓPRIA do que NÃO é guard (independência do auditor: não confio no NAO_SAO_GUARDS que audito).
const INFRAESTRUTURA = Object.freeze(['run-selftests.mjs', 'guards-esperados.mjs']);

function acharRaiz(inicio) {
  let dir = inicio; const topo = dir.split(sep)[0] + sep;
  while (true) {
    try { readFileSync(join(dir, 'package.json')); return dir; } catch { /* ignora-de-proposito: package.json não está neste nível, sobe pro pai */ }
    if (dir === topo || dirname(dir) === dir) return inicio;
    dir = dirname(dir);
  }
}

const CANONICO = /^[a-z0-9-]+\.mjs$/; // MESMA regra do runner (run-selftests.guardsDaPasta): nome não-kebab = guard invisível.

/**
 * FUNÇÃO PURA: um valor de script npm "roda" o alvo? Aceita SÓ `node <alvo>` e `node ./<alvo>`
 * (+ ` --self-test`). Deliberadamente NÃO aceita flags nem wrappers: um flag pode SUPRIMIR a execução
 * (`node --check`/`-c`/`--version <alvo>` não rodam o guard — HOLE 1 da 2ª auditoria, aberto pelo
 * tokenizer permissivo do conserto da 1ª), e nenhum runner de guard usa flag. Falso-negativo (guard
 * que não roda mas "passa") é pior que falso-positivo aqui. Env-prefix/wrapper (`cross-env X=1 node …`)
 * também não é reconhecido — se um projeto precisar, é decisão explícita, não silêncio.
 */
export function analisaValor(valor, alvo) {
  const v = String(valor ?? '').trim().replace(/\s+/g, ' ').replace(`node ./${alvo}`, `node ${alvo}`);
  return { runner: v === `node ${alvo}`, selftest: v === `node ${alvo} --self-test` };
}

/**
 * FUNÇÃO PURA: dado o estado do cabeamento, lista os problemas. Sem fs, sem git, sem exit.
 * @returns {{ok:boolean, problemas:{tipo:string,arquivo:string,detalhe:string}[]}}
 */
export function avaliarCabeamento({ arquivos = [], esperados = [], naoSaoGuards = [], scriptsValores = [], guardsRel = 'scripts/guards' } = {}) {
  const problemas = [];
  const infra = INFRAESTRUTURA;
  // NAO_SAO_GUARDS tem que ser EXATAMENTE a infraestrutura conhecida (tamper-evidence, os dois sentidos).
  for (const f of naoSaoGuards) if (!infra.includes(f)) problemas.push({ tipo: 'nao-guard-suspeito', arquivo: f, detalhe: `'${f}' está em NAO_SAO_GUARDS mas não é infraestrutura reconhecida (${infra.join(', ')}) — guard escondido?` });
  for (const f of infra) if (!naoSaoGuards.includes(f)) problemas.push({ tipo: 'infra-fora-de-nao-guards', arquivo: f, detalhe: `infraestrutura '${f}' precisa estar em NAO_SAO_GUARDS, senão o runner tenta rodá-la como guard` });
  // Entrada MORTA e infraestrutura indevida na lista de esperados.
  for (const e of esperados) {
    if (!arquivos.includes(e)) problemas.push({ tipo: 'lista-morta', arquivo: e, detalhe: `GUARDS_ESPERADOS cita '${e}', que não existe em ${guardsRel}/` });
    if (infra.includes(e)) problemas.push({ tipo: 'infra-na-lista', arquivo: e, detalhe: `'${e}' é infraestrutura, não pode estar em GUARDS_ESPERADOS` });
  }
  // .mjs que NÃO é kebab-case escapa do runner E da classificação abaixo — guard INVISÍVEL (incidente #11).
  // Tem que reprovar ALTO, não sumir em silêncio (era o buraco: coletar via /\.mjs$/i, classificar via CANONICO).
  for (const f of arquivos) if (/\.mjs$/i.test(f) && !CANONICO.test(f) && !infra.includes(f)) problemas.push({ tipo: 'nome-nao-canonico', arquivo: f, detalhe: `'${f}' não é kebab-case ([a-z0-9-].mjs) — o runner e este guard o IGNORAM (guard invisível). Renomeie para minúsculas com hífen.` });
  // Cada guard REAL: na lista + runner + selftest. Uso INFRAESTRUTURA (própria), não naoSaoGuards.
  const guardsReais = arquivos.filter((f) => CANONICO.test(f) && !infra.includes(f));
  for (const g of guardsReais) {
    if (!esperados.includes(g)) problemas.push({ tipo: 'fora-da-lista', arquivo: g, detalhe: `'${g}' não está em GUARDS_ESPERADOS — o runner não o roda (nasce morto)` });
    const alvo = `${guardsRel}/${g}`;
    const casa = scriptsValores.map((v) => analisaValor(v, alvo));
    if (!casa.some((c) => c.runner)) problemas.push({ tipo: 'sem-npm-runner', arquivo: g, detalhe: `falta um script "node ${alvo}" (aceita ./ e flags de node)` });
    if (!casa.some((c) => c.selftest)) problemas.push({ tipo: 'sem-npm-selftest', arquivo: g, detalhe: `falta um script "node ${alvo} --self-test"` });
  }
  return { ok: problemas.length === 0, problemas };
}

export function comoPassar(guardsRel) {
  return ['Como este check fica verde (o caminho, não só a reprovação):',
    `  - guard novo: adicione o arquivo a scripts/guards/guards-esperados.mjs (GUARDS_ESPERADOS);`,
    `  - e dois scripts no package.json: "<nome>": "node ${guardsRel}/<arquivo>" e "<nome>:selftest": "node ${guardsRel}/<arquivo> --self-test";`,
    '  - entrada morta: remova de GUARDS_ESPERADOS o arquivo que não existe mais (ou traga o arquivo de volta);',
    '  - NAO_SAO_GUARDS só pode conter a infraestrutura (run-selftests.mjs, guards-esperados.mjs).',
    '  POR QUE EXISTE: guard sem chamador não roda — nasce morto (LEI 10, incidente kit #11).'].join('\n');
}

/** Coleta o estado REAL (live). Lança se package.json não é legível → o rodapé cai em exit 2 (NÃO MEDIU). */
function coletarReal(env = process.env) {
  const raiz = acharRaiz(GUARDS_DIR);
  const pkgPath = env.GUARD_WIRING_PKG || join(raiz, 'package.json'); // seam de teste (como RUN_SELFTESTS_DIR)
  const guardsRel = relative(raiz, GUARDS_DIR).split(sep).join('/') || 'scripts/guards';
  const arquivos = readdirSync(GUARDS_DIR).filter((f) => /\.mjs$/i.test(f));
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const scriptsValores = Object.values(pkg.scripts || {});
  return { arquivos, esperados: GUARDS_ESPERADOS, naoSaoGuards: NAO_SAO_GUARDS, scriptsValores, guardsRel };
}

/** `coletar` injetável (issue #17): o self-test roda a PORTA offline via --fixture, sem tocar o disco real. */
export async function principal({ argv = process.argv.slice(2), coletar = coletarReal, env = process.env } = {}) {
  const valor = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const fixture = valor('--fixture');
  let dados;
  if (fixture) {
    try { dados = JSON.parse(readFileSync(fixture, 'utf8')); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: fixture ilegível: ${e.message}`); return 2; }
  } else {
    dados = coletar(env); // se lançar, principal rejeita → rodapé → exit 2
  }
  const r = avaliarCabeamento(dados);
  const rel = dados.guardsRel || 'scripts/guards';
  if (r.ok) {
    console.log(`[${NOME}] ✅ cabeamento íntegro: todo guard em ${rel}/ está em GUARDS_ESPERADOS e tem npm run <x>/<x>:selftest.`);
  } else {
    for (const p of r.problemas) console.error(`[${NOME}] FALHA (${p.tipo}): ${p.detalhe}`);
    console.error(`\n${comoPassar(rel)}`);
  }
  return r.ok ? 0 : 1;
}

async function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const REL = 'scripts/guards';
  // um estado-base cabeado corretamente (o "o que nunca pode bloquear")
  const base = () => ({
    arquivos: ['a-guard.mjs', 'run-selftests.mjs', 'guards-esperados.mjs'],
    esperados: ['a-guard.mjs'],
    naoSaoGuards: ['run-selftests.mjs', 'guards-esperados.mjs'],
    scriptsValores: [`node ${REL}/a-guard.mjs`, `node ${REL}/a-guard.mjs --self-test`],
    guardsRel: REL,
  });

  // ── o que NUNCA pode bloquear (falso-positivo) ──
  check('CONTROLE: guard cabeado corretamente → ok', avaliarCabeamento(base()).ok === true);
  check('CONTROLE: infraestrutura (run-selftests/guards-esperados) não precisa estar cabeada', (() => {
    const d = base(); // infra presente nos arquivos mas fora de esperados/scripts — não pode ser exigida
    return avaliarCabeamento(d).ok === true;
  })());

  // ── o que NUNCA pode passar (bypasses) ──
  check('BYPASS: guard fora de GUARDS_ESPERADOS → reprova', (() => { const d = base(); d.esperados = []; const r = avaliarCabeamento(d); return !r.ok && r.problemas.some((p) => p.tipo === 'fora-da-lista'); })());
  check('BYPASS: guard sem npm runner → reprova', (() => { const d = base(); d.scriptsValores = [`node ${REL}/a-guard.mjs --self-test`]; const r = avaliarCabeamento(d); return !r.ok && r.problemas.some((p) => p.tipo === 'sem-npm-runner'); })());
  check('BYPASS: guard sem npm :selftest → reprova', (() => { const d = base(); d.scriptsValores = [`node ${REL}/a-guard.mjs`]; const r = avaliarCabeamento(d); return !r.ok && r.problemas.some((p) => p.tipo === 'sem-npm-selftest'); })());
  check('BYPASS (RENOMEAR/deleção): entrada morta em GUARDS_ESPERADOS → reprova', (() => { const d = base(); d.esperados = ['a-guard.mjs', 'sumiu.mjs']; const r = avaliarCabeamento(d); return !r.ok && r.problemas.some((p) => p.tipo === 'lista-morta'); })());
  check('BYPASS (esconder guard): meter o nome dele em NAO_SAO_GUARDS → reprova como suspeito', (() => { const d = base(); d.naoSaoGuards = ['run-selftests.mjs', 'guards-esperados.mjs', 'a-guard.mjs']; const r = avaliarCabeamento(d); return !r.ok && r.problemas.some((p) => p.tipo === 'nao-guard-suspeito'); })());
  check('BYPASS: infraestrutura fora de NAO_SAO_GUARDS → reprova (o runner a rodaria como guard)', (() => { const d = base(); d.naoSaoGuards = ['run-selftests.mjs']; const r = avaliarCabeamento(d); return !r.ok && r.problemas.some((p) => p.tipo === 'infra-fora-de-nao-guards'); })());
  check('BYPASS: infraestrutura indevida em GUARDS_ESPERADOS → reprova', (() => { const d = base(); d.esperados = ['a-guard.mjs', 'guards-esperados.mjs']; const r = avaliarCabeamento(d); return !r.ok && r.problemas.some((p) => p.tipo === 'infra-na-lista'); })());
  check('BYPASS (VAZIO): nenhum guard esperado mas há guard real → reprova, não aprova por lista vazia', (() => { const d = base(); d.esperados = []; return avaliarCabeamento(d).ok === false; })());
  check('BYPASS (INVISÍVEL): runner com U+200B no valor não casa → conta como sem-npm-runner', (() => { const d = base(); d.scriptsValores = [`node ${REL}/a-guard.mjs​`, `node ${REL}/a-guard.mjs --self-test`]; const r = avaliarCabeamento(d); return r.problemas.some((p) => p.tipo === 'sem-npm-runner'); })());
  check('BYPASS (NULO): entradas ausentes/undefined → não estoura e reprova (guard real sem nada cabeado)', (() => { const r = avaliarCabeamento({ arquivos: ['x.mjs'] }); return r.ok === false && r.problemas.length > 0; })());
  check('BYPASS (BASELINE): inflar GUARDS_ESPERADOS com fantasma não "cobre" — vira lista-morta', (() => { const d = base(); d.esperados = ['a-guard.mjs', 'fantasma.mjs']; const r = avaliarCabeamento(d); return r.problemas.some((p) => p.tipo === 'lista-morta'); })());
  // HOLE 1 da 1ª auditoria adversarial: guard com nome não-kebab escapava do runner E deste guard (invisível).
  const naoKebab = (arq) => { const d = base(); d.arquivos = ['a-guard.mjs', arq, 'run-selftests.mjs', 'guards-esperados.mjs']; return avaliarCabeamento(d); };
  check('BYPASS (RENOMEAR/INVISÍVEL): maiúscula "Malicioso.mjs" não-cabeado → nome-nao-canonico (não passa mudo)', (() => { const r = naoKebab('Malicioso.mjs'); return !r.ok && r.problemas.some((p) => p.tipo === 'nome-nao-canonico'); })());
  check('BYPASS: underscore "mal_guard.mjs" → nome-nao-canonico', (() => { const r = naoKebab('mal_guard.mjs'); return !r.ok && r.problemas.some((p) => p.tipo === 'nome-nao-canonico'); })());
  check('BYPASS: ponto extra "mal.guard.mjs" → nome-nao-canonico', (() => { const r = naoKebab('mal.guard.mjs'); return !r.ok && r.problemas.some((p) => p.tipo === 'nome-nao-canonico'); })());
  check('BYPASS: extensão .MJS "evil.MJS" → nome-nao-canonico', (() => { const r = naoKebab('evil.MJS'); return !r.ok && r.problemas.some((p) => p.tipo === 'nome-nao-canonico'); })());
  // HOLE 2 da 1ª auditoria: `./` legítimo NÃO pode ser falso-positivo.
  check('NUNCA BLOQUEIA: runner/selftest com prefixo ./ → ok', (() => { const d = base(); d.scriptsValores = [`node ./${REL}/a-guard.mjs`, `node ./${REL}/a-guard.mjs --self-test`]; return avaliarCabeamento(d).ok === true; })());
  // HOLE 1 da 2ª auditoria: flag que SUPRIME a execução (`--check`/`-c`/`--version`) não roda o guard → NÃO é runner.
  check('BYPASS (HOLE 1 r2): "node --check <alvo>" não roda o guard → não é runner nem selftest', (() => { const a = analisaValor(`node --check ${REL}/x.mjs`, `${REL}/x.mjs`); const s = analisaValor(`node --check ${REL}/x.mjs --self-test`, `${REL}/x.mjs`); return a.runner === false && s.selftest === false; })());
  check('BYPASS (HOLE 1 r2): "-c" e "--version" idem → não é runner', analisaValor(`node -c ${REL}/x.mjs`, `${REL}/x.mjs`).runner === false && analisaValor(`node --version ${REL}/x.mjs`, `${REL}/x.mjs`).runner === false);
  check('analisaValor: "echo node <alvo>" NÃO conta como runner (tem que começar com node)', analisaValor(`echo node ${REL}/a-guard.mjs`, `${REL}/a-guard.mjs`).runner === false);
  check('analisaValor: runner puro não é selftest e vice-versa', (() => { const a = analisaValor(`node ${REL}/x.mjs`, `${REL}/x.mjs`); const b = analisaValor(`node ${REL}/x.mjs --self-test`, `${REL}/x.mjs`); return a.runner && !a.selftest && b.selftest && !b.runner; })());

  // ── PORTA (issue #17): guard como processo, via --fixture e via rejeição real ──
  const dir = mkdtempSync(join(tmpdir(), 'gw-'));
  try {
    const meu = fileURLToPath(import.meta.url);
    const porta = (args, extraEnv = {}) => spawnSync(process.execPath, [meu, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', ...extraEnv } }).status;
    const fx = (nome, obj) => { const p = join(dir, nome); writeFileSync(p, JSON.stringify(obj)); return p; };
    check('PORTA: fixture cabeado → exit 0', porta(['--fixture', fx('ok.json', base())]) === 0);
    check('PORTA: fixture com guard fora da lista → exit 1', porta(['--fixture', fx('bad.json', { ...base(), esperados: [] })]) === 1);
    check('PORTA (HOLE 1 r2): fixture com runner "node --check <alvo>" → exit 1 (não roda o guard)', porta(['--fixture', fx('check.json', { ...base(), scriptsValores: [`node --check ${REL}/a-guard.mjs`, `node --check ${REL}/a-guard.mjs --self-test`] })]) === 1);
    check('PORTA: fixture ilegível → exit 2', porta(['--fixture', join(dir, 'nao-existe.json')]) === 2);
    // SUBSTITUIR/rodapé: uma REJEIÇÃO real de principal() (package.json ilegível via seam) cai no .catch → exit 2.
    // (A lição do auditoria-vigente: sem este caso, o mutante `process.exitCode = 2 → 0` do rodapé sobrevive.)
    check('PORTA: coletarReal rejeita (package.json inexistente) → catch do rodapé → exit 2', porta([], { GUARD_WIRING_PKG: join(dir, 'nao-ha-pkg.json') }) === 2);
    // (SEM caso "run real na árvore do kit": HOLE 3 da 1ª auditoria — dependia do estado do working-tree e,
    //  dentro do sandbox scripts-only da prova-de-vida (sem package.json acima), ficava vermelho SEMPRE,
    //  tornando a prova-de-vida VACUAMENTE verde. O run real é o LIVE check no full-check/CI, não um caso.)
  } finally { rmSync(dir, { recursive: true, force: true }); }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) selfTest();
  else principal().then((code) => { process.exitCode = code; }).catch((e) => { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; });
}
