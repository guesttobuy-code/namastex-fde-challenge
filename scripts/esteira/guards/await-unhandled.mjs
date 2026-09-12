#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: a dor do dono ("diz que funciona e não funciona") na forma async — uma Promise cuja
 *   REJEIÇÃO não é tratada. O erro acontece, ninguém o pega, e o programa segue (ou morre longe da causa,
 *   como unhandledRejection). Este guard pega os DOIS footguns sintáticos, text-detectáveis e quase-sempre-
 *   bug: (1) callback `async` passado pro `Array.forEach` — o forEach IGNORA o valor de retorno, então a
 *   Promise (e o erro dela) some no ar e o loop nem espera; (2) executor `async` em `new Promise(async …)`
 *   — se o corpo async lança antes de chamar reject, a rejeição é engolida e o Promise pendura pra sempre.
 *
 * O QUE FAZ: escaneia arquivos de código (.mjs/.cjs/.js/.jsx/.ts/.tsx/.mts/.cts) sob --dir (ou cwd),
 *   sobre o código DESPIDO (comentário/string/regex viram espaço), procurando `.forEach(async` e
 *   `new Promise(async`. Pula node_modules/.git/referencia. Opt-out POR-LINHA com `async-de-proposito`
 *   (comentário NA MESMA linha do footgun) pro caso raro em que o autor garante o tratamento por dentro.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. `.forEach(async …)` — a Promise do callback é descartada (rejeição vira unhandledRejection);
 *   2. `new Promise(async …)` — executor async engole a rejeição do próprio corpo.
 *
 * O QUE NUNCA PODE BLOQUEAR (família de falsos-positivos):
 *   - `.map(async …)` / `.filter(async …)` — legítimos quando o array de Promises é aguardado (Promise.all);
 *   - `.forEach` com callback SÍNCRONO; `for (const x of xs) { await … }` (a forma correta de await em loop);
 *   - `await`/`return`/`void` na frente de uma chamada async; opt-out `async-de-proposito` na linha;
 *   - um `.forEach` CUSTOM (não-Array) que espera por dentro (fila própria) — se algum existir, use o opt-out.
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) FLOATING PROMISE geral — uma chamada `foo()` que devolve Promise e é
 *   descartada (sem forEach): exige TIPO (saber que `foo` é async) — é o `@typescript-eslint/no-floating-
 *   promises` num projeto TS; aqui só os dois padrões sintáticos de ZERO falso-positivo; (b) `.map/.filter
 *   (async)` sem `await`/`Promise.all` — pode ser bug, mas a forma legítima é idêntica sintaticamente (só o
 *   fluxo distingue); (c) `setTimeout/setInterval(async …)` — fire-and-forget às vezes é intencional; (d)
 *   `.then()` sem `.catch()` — rejeição solta, mas `.then` tem formas demais (2-arg, cadeia) pra um regex —
 *   fica pro TS/eslint; (e) rejeição tratada por handler global `process.on('unhandledRejection')`; (f)
 *   acesso computado `arr["forEach"](async …)` — a string da chave é despida, some do texto casável (raro;
 *   escreva `.forEach`); (g) o footgun DENTRO de `${…}` de template literal — o despir trata template como
 *   opaco (herdado do LIMITE do despir); (h) construtor Promise APELIDADO (`const P = Promise; new P(async …)`)
 *   — exige análise de alias; (i) um literal regex logo após `)` na MESMA linha (`if (x) /…forEach(async…/`)
 *   pode vazar como código e gerar um falso-positivo RARO (é o LIMITE declarado do despir) — use o opt-out;
 *   (j) subpasta que é outro checkout git DE VERDADE (`.git` com `HEAD`, ou `gitdir:` apontando para um
 *   diretório com `HEAD` — worktree, submódulo) não é varrida: é outra árvore; um `.git` FALSO não esconde nada;
 *   (k) CÓDIGO PYTHON — este guard só lê JS/TS; num projeto com "stack": "python" em esteira.json ele sai
 *   NAO_APLICAVEL (exit 0) sem olhar um .py sequer (R6, 2026-09-11).
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial (onda 3): (AU-1, alta) o despir lia `/` depois de
 *   `.in`/`.of`/`.delete` (PROPRIEDADE, não keyword) como início de regex e apagava o `.forEach(async)` a
 *   jusante (falso-negativo MUDO — a classe do HOLE-1 do empty-catch, reaberta por outra porta) → corrigido
 *   na LIB compartilhada: keyword precedida de `.` é propriedade, e regex aborta na quebra de linha. (AU-2,
 *   alta) o opt-out pegava a linha DE CIMA → um marcador legítimo isentava a violação NÃO-marcada de baixo;
 *   agora é POR-LINHA (só a mesma linha). (AU-3/f-i) falsos-negativos/positivos de ESCOPO declarados acima.
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — TRATADA (com ressalva): casa sobre o código DESPIDO (string/comentário/regex
 *     viram espaço), então `.forEach(async` citado em doc/string não conta — e esta fonte não se auto-acusa.
 *     RESSALVA declarada (O QUE NÃO VÊ (i)): o despir é heurística, não parser — uma regex logo após `)` pode
 *     vazar; não confio nele como se fosse sólido, por isso o limite está escrito e coberto por opt-out.
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: varre conteúdo de arquivo (readdir a partir de --dir/cwd), não segue import.
 *   BANCA: BASELINE — NÃO SE APLICA: sem allowlist/baseline; todo código no escopo é varrido; opt-out é POR-LINHA e explícito.
 *   BANCA: INVISÍVEL/RENOMEAR — o alvo é um PADRÃO de código, não um nome — renomear/mover não cria nem esconde o padrão.
 *   VAZIO/NULO (fonte vazia → 0) e SUBSTITUIR (o padrão é sintático, não um símbolo mockável) viram casos/N/A.
 *
 * CONTRA-PROVA: node scripts/guards/await-unhandled.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { despirCodigo } from '../lib/despir-codigo.mjs';
import { escanearCodigoPadrao } from '../lib/varredura.mjs';
import { stackDoProjeto } from '../lib/stack.mjs';

const NOME = 'await-unhandled';
const MARCADOR_OPTOUT = 'async-de-proposito';
// Os dois padrões (casados no código DESPIDO). `\basync\b` garante que não casa `asyncFoo`.
const PADROES = [
  { tipo: 'foreach-async', re: /\.\s*forEach\s*\(\s*async\b/g, explica: '.forEach com callback async — a Promise é descartada (rejeição vira unhandledRejection); use for...of com await' },
  { tipo: 'promise-async-executor', re: /new\s+Promise\s*\(\s*async\b/g, explica: 'new Promise(async …) — o executor async engole a própria rejeição; não faça o executor async' },
];

/** FUNÇÃO PURA: ocorrências dos padrões async-solto (sem o opt-out). Sem fs, sem exit. */
export function achaAsyncSolto(fonte) {
  const texto = String(fonte ?? '');
  const despido = despirCodigo(texto); // comprimento preservado → índice mapeia de volta ao original
  const linhasOrig = texto.split(/\r?\n/);
  const achados = [];
  for (const { tipo, re, explica } of PADROES) {
    re.lastIndex = 0; // matchAll clona a regex (lastIndex não vaza), mas resetar é barato e defensivo
    for (const m of despido.matchAll(re)) {
      const linha = despido.slice(0, m.index).split('\n').length; // 1-based
      // opt-out por-LINHA: o marcador tem que estar na MESMA linha do footgun (não na de cima — senão um
      // marcador legítimo numa linha isentaria uma violação NÃO-marcada na linha de baixo — AU-2 da auditoria).
      // Lido do ORIGINAL (é comentário); vale pra qualquer footgun DAQUELA linha (granularidade por-linha).
      if ((linhasOrig[linha - 1] || '').includes(MARCADOR_OPTOUT)) continue;
      achados.push({ tipo, linha, explica });
    }
  }
  return achados.sort((a, b) => a.linha - b.linha);
}

// walker + config de código: DONO ÚNICO em lib/varredura.mjs (mesma semântica de sempre; arquivo acima
// do teto é pulado calado — ignoramos `naoMedidos`, como este guard sempre fez).
function escanear(dir) {
  return escanearCodigoPadrao(dir, achaAsyncSolto);
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  if (i >= 0 && !argv[i + 1]) { console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`); return 2; }
  const dir = i >= 0 ? argv[i + 1] : cwd;
  // R6 (2026-09-11): projeto declarado "stack":"python" não tem JS/TS pra este guard medir — NAO_APLICAVEL
  // exit 0, ANTES de qualquer varredura (esteira.json inválido → NÃO MEDIU exit 2).
  const stack = stackDoProjeto(dir); // esteira.json sintaticamente inválido LANÇA → rodapé pega → exit 2
  if (stack === 'python') { console.log(`[${NOME}] NAO_APLICAVEL: projeto declarado python no esteira.json — este guard só mede JS/TS.`); return 0; }
  const achados = escanear(dir); // dir raiz ilegível → lança → rodapé → exit 2
  if (achados.length === 0) { console.log(`[${NOME}] ✅ nenhuma Promise async solta em ${dir}.`); return 0; }
  for (const a of achados) console.error(`[${NOME}] FALHA (${a.tipo}): ${a.arquivo}:${a.linha} — ${a.explica}`);
  console.error(`[${NOME}] COMO PASSAR: troque \`.forEach(async …)\` por \`for (const x of xs) { await … }\` (ou \`await Promise.all(xs.map(async …))\` se puder paralelizar); não faça o executor do \`new Promise\` async. Se o tratamento é MESMO por dentro, comente com "${MARCADOR_OPTOUT}: <motivo>" na linha.`);
  console.error(`[${NOME}] POR QUE EXISTE: rejeição de Promise não tratada é bug invisível — some no ar e explode longe da causa.`);
  return 1;
}

// ── fixtures: os padrões são MONTADOS (fEA/nP) pra não existir `.forEach(async`/`new Promise(async` literal nesta fonte ──
const FE = 'for' + 'Each';
const foreachAsync = (corpo = 'v => { await f(v); }', recv = 'itens') => `${recv}.${FE}(async ${corpo});`;
const promiseAsync = (corpo = '(resolve) => { await g(); resolve(); }') => `const p = new Promise(async ${corpo});`;

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── o que NUNCA pode passar ──
  check('BYPASS: .forEach(async arrow) → foreach-async', achaAsyncSolto(foreachAsync()).some((a) => a.tipo === 'foreach-async'));
  check('BYPASS: .forEach(async function) → foreach-async', achaAsyncSolto('xs.' + FE + '(async function (v) { await f(v); });').some((a) => a.tipo === 'foreach-async'));
  check('BYPASS: quebra de linha entre ( e async → foreach-async', achaAsyncSolto('xs.' + FE + '(\n  async (v) => { await f(v); }\n);').some((a) => a.tipo === 'foreach-async'));
  check('BYPASS: new Promise(async executor) → promise-async-executor', achaAsyncSolto(promiseAsync()).some((a) => a.tipo === 'promise-async-executor'));
  check('reporta a linha certa', achaAsyncSolto(`const a = 1;\nconst b = 2;\n${foreachAsync()}`)[0]?.linha === 3);

  // ── o que NUNCA pode bloquear ──
  check('NUNCA BLOQUEIA: .map(async) (legítimo com Promise.all) → 0', achaAsyncSolto('const r = await Promise.all(xs.map(async (v) => f(v)));').length === 0);
  check('NUNCA BLOQUEIA: .forEach SÍNCRONO → 0', achaAsyncSolto('xs.' + FE + '((v) => f(v));').length === 0);
  check('NUNCA BLOQUEIA: for...of com await → 0', achaAsyncSolto('for (const v of xs) { await f(v); }').length === 0);
  check('NUNCA BLOQUEIA: new Promise com executor SÍNCRONO → 0', achaAsyncSolto('const p = new Promise((resolve) => resolve(1));').length === 0);
  check('NUNCA BLOQUEIA: asyncFoo (palavra maior) não casa `async\\b`', achaAsyncSolto('xs.' + FE + '(asyncFoo);').length === 0);
  check('NUNCA BLOQUEIA (COMENTÁRIO): padrão dentro de // não conta (despido)', achaAsyncSolto('// ' + foreachAsync()).length === 0);
  check('NUNCA BLOQUEIA (STRING): padrão dentro de string não conta (despido)', achaAsyncSolto('const doc = ' + JSON.stringify(foreachAsync()) + ';').length === 0);
  check('NUNCA BLOQUEIA (opt-out mesma linha): async-de-proposito → 0', achaAsyncSolto(foreachAsync() + ` // ${MARCADOR_OPTOUT}: trato o erro dentro do callback`).length === 0);
  check('NUNCA BLOQUEIA (VAZIO): fonte vazia/undefined → 0', achaAsyncSolto('').length === 0 && achaAsyncSolto(undefined).length === 0);
  check('NUNCA BLOQUEIA: código sem os padrões → 0', achaAsyncSolto('export const x = 1;\nfunction f(){ return 2; }').length === 0);

  // ── AU-2 (auditoria): opt-out é POR-LINHA — o marcador NÃO vaza pra linha de baixo ──
  check('BYPASS (AU-2): marcador na linha DE CIMA NÃO isenta a violação de baixo → 1', achaAsyncSolto(`// ${MARCADOR_OPTOUT}: era pra outra coisa\n${foreachAsync()}`).length === 1);
  check('BYPASS (AU-2): marcador legítimo na linha 1 não isenta violação NÃO-marcada na linha 2', (() => { const r = achaAsyncSolto(`${foreachAsync('a => {}', 'aa')} // ${MARCADOR_OPTOUT}\n${foreachAsync('b => {}', 'bb')}`); return r.length === 1 && r[0].linha === 2; })());

  // ── AU-1 (auditoria): despir não pode apagar o footgun por causa de `/` após PROPRIEDADE .in/.of/.delete ──
  check('BYPASS (AU-1): `.in / .out` (divisão) acima NÃO apaga o forEach(async) de baixo', achaAsyncSolto(`const ratio = stats.in / stats.out;\n${foreachAsync()}`).some((a) => a.tipo === 'foreach-async'));
  check('BYPASS (AU-1): `.of / n` acima NÃO apaga o new Promise(async) de baixo', achaAsyncSolto(`const q = range.of / count;\n${promiseAsync()}`).some((a) => a.tipo === 'promise-async-executor'));
  check('BYPASS (AU-1): `.delete / n` acima NÃO apaga o forEach(async) de baixo', achaAsyncSolto(`const n = cache.delete / total;\n${foreachAsync()}`).some((a) => a.tipo === 'foreach-async'));
  check('NUNCA BLOQUEIA: divisão real `a / b` não vira regex nem apaga o resto', achaAsyncSolto(`const x = a / b;\nconst y = 1;`).length === 0);

  // ── PORTA (issue #17): processo real, via --dir em árvores tmp ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (dir) => spawnSync(process.execPath, [meu, '--dir', dir], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '' } }).status;
  const limpo = mkdtempSync(join(tmpdir(), 'au-limpo-'));
  const sujo = mkdtempSync(join(tmpdir(), 'au-sujo-'));
  try {
    writeFileSync(join(limpo, 'ok.mjs'), 'for (const v of itens) { await f(v); }\nawait Promise.all(itens.map(async (v) => f(v)));\n');
    writeFileSync(join(limpo, 'nota.md'), 'um ' + foreachAsync() + ' num .md não é código, não conta\n'); // extensão não-código: ignorada
    check('PORTA: --dir de árvore limpa (for-await, .md ignorado) → exit 0', porta(limpo) === 0);
    writeFileSync(join(sujo, 'vaza.mjs'), foreachAsync() + '\n');
    check('PORTA: --dir com .forEach(async) → exit 1', porta(sujo) === 1);
    check('PORTA: --dir sem caminho → exit 2', spawnSync(process.execPath, [meu, '--dir'], { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } }).status === 2);
    check('PORTA: --dir inexistente → escanear rejeita → rodapé → exit 2', porta(join(sujo, 'nao-existe')) === 2);
  } finally { rmSync(limpo, { recursive: true, force: true }); rmSync(sujo, { recursive: true, force: true }); }

  // ── PORTA: subpasta que é outro checkout git DE VERDADE (.git/ com HEAD) não é varrida ──
  const aninha = mkdtempSync(join(tmpdir(), 'au-aninha-'));
  try {
    mkdirSync(join(aninha, 'sub', '.git'), { recursive: true });
    writeFileSync(join(aninha, 'sub', '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(aninha, 'sub', 'viola.mjs'), foreachAsync() + '\n'); // .forEach(async) DENTRO de outro checkout REAL
    check('NUNCA BLOQUEIA (checkout real): subpasta com .git/HEAD não é varrida → exit 0', porta(aninha) === 0);
    writeFileSync(join(aninha, 'viola.mjs'), foreachAsync() + '\n'); // o MESMO arquivo fora de sub/ (sem .git próprio) é varrido normalmente
    check('PORTA: o mesmo arquivo fora de sub/ (sem .git) é varrido normalmente → exit 1', porta(aninha) === 1);
    // BYPASS (.git falso): troca o checkout REAL por um `.git` arquivo com gitdir pro nada — não esconde nada.
    rmSync(join(aninha, 'viola.mjs'), { force: true }); // tira a violação da raiz: o exit 1 abaixo só pode vir de dentro de sub/
    rmSync(join(aninha, 'sub', '.git'), { recursive: true, force: true });
    writeFileSync(join(aninha, 'sub', '.git'), 'gitdir: nao-existe\n');
    check('BYPASS (.git falso): sub/.git com "gitdir: nao-existe" NÃO esconde a violação → exit 1', porta(aninha) === 1);
  } finally { rmSync(aninha, { recursive: true, force: true }); }

  // ── STACK (R6, 2026-09-11): "stack":"python" em esteira.json isenta este guard (só lê JS/TS) ──
  const stackPy = mkdtempSync(join(tmpdir(), 'au-stack-py-'));
  const stackNode = mkdtempSync(join(tmpdir(), 'au-stack-node-'));
  const stackRuim = mkdtempSync(join(tmpdir(), 'au-stack-ruim-'));
  try {
    writeFileSync(join(stackPy, 'esteira.json'), JSON.stringify({ stack: 'python' }));
    writeFileSync(join(stackPy, 'vaza.mjs'), foreachAsync() + '\n'); // footgun de verdade — mas o projeto é python
    check('STACK: projeto python (esteira.json) → NAO_APLICAVEL exit 0, mesmo com .forEach(async) no disco', porta(stackPy) === 0);
    writeFileSync(join(stackNode, 'esteira.json'), JSON.stringify({ stack: 'node' }));
    writeFileSync(join(stackNode, 'vaza.mjs'), foreachAsync() + '\n');
    check('STACK: projeto node (explícito) → regra normal (reprova o footgun)', porta(stackNode) === 1);
    writeFileSync(join(stackRuim, 'esteira.json'), '{ nao é json');
    writeFileSync(join(stackRuim, 'ok.mjs'), 'export const x = 1;\n');
    check('STACK: esteira.json com JSON inválido → NÃO MEDIU exit 2 (nunca "node" silencioso)', porta(stackRuim) === 2);
  } finally {
    rmSync(stackPy, { recursive: true, force: true });
    rmSync(stackNode, { recursive: true, force: true });
    rmSync(stackRuim, { recursive: true, force: true });
  }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) selfTest();
  else { try { process.exitCode = principal(); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; } }
}
