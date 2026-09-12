#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: a dor do dono — "a IA diz que funciona e não funciona". O catch VAZIO é o vetor
 *   mais direto disso: um erro real acontece, o catch o engole, e o programa segue como se nada
 *   tivesse falhado. O bug fica invisível até explodir longe da causa. Erro se TRATA (loga, relança,
 *   recupera) ou se DEIXA subir — nunca se engole em silêncio.
 *
 * O QUE FAZ: escaneia arquivos de código (.mjs/.cjs/.js/.jsx/.ts/.tsx) de um diretório (--dir, ou o
 *   cwd) procurando blocos `catch (...) { }` cujo corpo é VAZIO ou SÓ comentário. Pula node_modules/
 *   .git e a área `referencia/` (as minas do campo minado são de propósito).
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. `catch {}` / `catch (e) {}` de corpo vazio;
 *   2. `catch { // só comentário }` — comentário não é tratamento; ainda engole o erro.
 *
 * O QUE NUNCA PODE BLOQUEAR (família de falsos-positivos):
 *   - catch com QUALQUER código real (throw/return/log/atribuição/chamada);
 *   - catch deliberadamente vazio COM o marcador `ignora-de-proposito` no comentário (opt-out explícito
 *     e greppável — o dev declarou que pensou; não é silêncio).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) engolir erro SEM catch (Promise sem `.catch`, `await` solto) — é do
 *   await-unhandled; (b) tratamento inadequado que EXISTE (loga e segue pode ainda esconder — mede forma);
 *   (c) corpo no-op mais elaborado que `;` (ex.: bloco aninhado vazio `{ {} }`) — raro; (d) `catch` cujo
 *   keyword tenha caractere invisível no meio (não casa o literal) — falso-negativo raro; (e) subpasta que é
 *   outro checkout git DE VERDADE (`.git` com `HEAD`, ou `gitdir:` apontando para um diretório com `HEAD` —
 *   worktree, submódulo) não é varrida: é outra árvore; um `.git` FALSO não esconde nada; (f) CÓDIGO PYTHON
 *   — este guard só lê JS/TS; num projeto com "stack": "python" em esteira.json ele sai NAO_APLICAVEL (exit
 *   0) sem olhar um .py sequer (R6, 2026-09-11).
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial achou: (HOLE 1, média-alta) um literal REGEX com
 *   aspa (`/'/`) fazia o `despir-codigo` entrar em estado de string e apagar o resto do arquivo, ESCONDENDO
 *   um catch vazio a jusante (falso-negativo mudo) — corrigido: o despir virou regex-aware. (HOLE 2) corpo
 *   só `;` não era pego — corrigido (o padrão aceita `[\s;]*`).
 *
 * BANCA — as 10 classes:
 *   BANCA: BASELINE — NÃO SE APLICA: sem allowlist/baseline; todo arquivo de código no escopo é varrido
 *     (a única exclusão é estrutural: node_modules/.git/referencia). O opt-out é POR-CATCH e explícito.
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: varre conteúdo de arquivo, não segue import/alias; caminho vem
 *     de --dir/cwd (readdir), não de link.
 *   BANCA: STRING/COMENTÁRIO — TRATADA: o `despir-codigo` troca string/comentário/regex por espaço antes
 *     de casar, então `catch {}` citado em doc/string não conta (casos no self-test).
 *   BANCA: RENOMEAR — NÃO SE APLICA: mover o arquivo o tira do escopo, mas o dead-code/guard-wiring pegam
 *     a órfã; aqui só se mede o que está no --dir. INVISÍVEL/SUBSTITUIR: ver O QUE NÃO VÊ (d).
 *   VAZIO/NULO viram casos `BYPASS:` no self-test.
 *
 * CONTRA-PROVA: node scripts/guards/empty-catch.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { despirCodigo } from '../lib/despir-codigo.mjs';
import { varrerEDetectar } from '../lib/varredura.mjs';
import { stackDoProjeto } from '../lib/stack.mjs';

const NOME = 'empty-catch';
const PULAR_DIR = new Set(['node_modules', '.git', 'referencia', '.venv', 'venv', '.uv', '__pycache__', 'site-packages']);
const EXT_CODIGO = /\.(mjs|cjs|js|jsx|ts|tsx)$/;
const MAX_BYTES = 1024 * 1024;
const MARCADOR_OPTOUT = 'ignora-de-proposito';
// Corpo VAZIO. Rodamos sobre o código DESPIDO (comentários/strings viram espaço), então "só comentário"
// também casa aqui (o comentário virou espaço). Casar no despido tira a auto-acusação (o padrão na
// própria certidão/fixtures) e o falso-positivo de `catch {}` dentro de string/comentário de outro arquivo.
const RE_CATCH_VAZIO = /catch\s*(?:\([^)]*\))?\s*\{[\s;]*\}/g;

/** FUNÇÃO PURA: linhas com catch de corpo vazio/só-comentário (sem o marcador de opt-out). Sem fs, sem exit. */
export function achaCatchVazio(fonte) {
  const texto = String(fonte ?? '');
  const despido = despirCodigo(texto); // comprimento preservado → o índice mapeia de volta ao original
  const achados = [];
  for (const m of despido.matchAll(RE_CATCH_VAZIO)) {
    const original = texto.slice(m.index, m.index + m[0].length); // o corpo real (com o comentário) pra ver o opt-out
    if (original.includes(MARCADOR_OPTOUT)) continue;
    achados.push({ linha: despido.slice(0, m.index).split('\n').length });
  }
  return achados;
}

// walker + ehBinario: DONO ÚNICO em lib/varredura.mjs (mesma semântica: raiz sempre varrida, subpasta
// pulada por PULAR_DIR/ehOutroCheckout, arquivo acima de MAX_BYTES pulado calado — ignoramos
// `naoMedidos` aqui de propósito, é o comportamento de sempre deste guard).
function escanear(dir) {
  return varrerEDetectar(dir, {
    aceitar: (nome) => EXT_CODIGO.test(nome), pular: PULAR_DIR, maxBytes: MAX_BYTES,
    comoBuffer: true, pularBinario: true,
    detector: (conteudo) => achaCatchVazio(conteudo.toString('utf8')),
  });
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  if (i >= 0 && !argv[i + 1]) { console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`); return 2; }
  const dir = i >= 0 ? argv[i + 1] : cwd;
  // R6 (2026-09-11): projeto declarado "stack":"python" em esteira.json não tem JS/TS pra este guard
  // medir — NAO_APLICAVEL exit 0, ANTES de qualquer varredura (esteira.json inválido → NÃO MEDIU exit 2).
  const stack = stackDoProjeto(dir); // esteira.json sintaticamente inválido LANÇA → rodapé pega → exit 2
  if (stack === 'python') { console.log(`[${NOME}] NAO_APLICAVEL: projeto declarado python no esteira.json — este guard só mede JS/TS.`); return 0; }
  const achados = escanear(dir); // dir raiz ilegível → lança → rodapé → exit 2
  if (achados.length === 0) { console.log(`[${NOME}] ✅ nenhum catch vazio em ${dir}.`); return 0; }
  for (const a of achados) console.error(`[${NOME}] FALHA: catch vazio (engole o erro) em ${a.arquivo}:${a.linha}`);
  console.error(`[${NOME}] COMO PASSAR: trate o erro (log/relançar/recuperar) ou deixe-o subir; se for MESMO pra ignorar, ponha um comentário com "${MARCADOR_OPTOUT}: <motivo>" dentro do catch.`);
  console.error(`[${NOME}] POR QUE EXISTE: catch vazio engole a falha — o bug fica invisível até explodir longe da causa.`);
  return 1;
}

// ── fixtures: a palavra "catch" é MONTADA (cat+ch) pra não existir catch-vazio literal nesta fonte ──
const K = 'cat' + 'ch';
const trecho = (corpo, bind = '') => `try { risco(); } ${K}${bind ? ` (${bind})` : ''} {${corpo}}`;

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── o que NUNCA pode passar ──
  check('BYPASS: catch {} vazio → achado', achaCatchVazio(trecho('')).length === 1);
  check('BYPASS: catch (e) {} vazio → achado', achaCatchVazio(trecho('', 'e')).length === 1);
  check('BYPASS: catch { } só espaço → achado', achaCatchVazio(trecho('   ')).length === 1);
  check('BYPASS (COMENTÁRIO): catch { // engoliu } comentário-só → achado', achaCatchVazio(`try {} ${K} {\n  // engoliu\n}`).length === 1);
  check('BYPASS (COMENTÁRIO): catch { /* nada */ } bloco-só → achado', achaCatchVazio(trecho(' /* nada */ ')).length === 1);
  check('reporta o número da linha certo', achaCatchVazio(`linha1\nlinha2\n${K} {}`)[0]?.linha === 3);

  // ── o que NUNCA pode bloquear ──
  check('NUNCA BLOQUEIA: catch com throw → 0', achaCatchVazio(trecho(' throw e; ', 'e')).length === 0);
  check('NUNCA BLOQUEIA: catch com log/código → 0', achaCatchVazio(trecho(' console.error(e); ', 'e')).length === 0);
  check('NUNCA BLOQUEIA: catch com return → 0', achaCatchVazio(trecho(' return null; ')).length === 0);
  check('NUNCA BLOQUEIA: opt-out explícito (ignora-de-proposito) → 0', achaCatchVazio(trecho(` /* ${MARCADOR_OPTOUT}: storage indisponível no SSR */ `)).length === 0);
  check('NUNCA BLOQUEIA (VAZIO): fonte vazia/undefined → 0', achaCatchVazio('').length === 0 && achaCatchVazio(undefined).length === 0);
  check('NUNCA BLOQUEIA: código sem catch nenhum → 0', achaCatchVazio('export const x = 1;\nfunction f(){ return 2; }').length === 0);
  check('NUNCA BLOQUEIA (COMENTÁRIO de linha): catch vazio dentro de // não conta (despido)', achaCatchVazio('// ' + trecho('')).length === 0);
  check('NUNCA BLOQUEIA (STRING): catch vazio dentro de string não conta (despido)', achaCatchVazio('const doc = ' + JSON.stringify(trecho(''))).length === 0);
  check('NUNCA BLOQUEIA (COMENTÁRIO de bloco): catch vazio citado num /* */ não conta', achaCatchVazio('/* exemplo: ' + trecho('') + ' */\nconst x = 1;').length === 0);
  check('BYPASS (HOLE 2): catch de corpo só ";" (no-op) → achado', achaCatchVazio(trecho(' ; ', 'e')).length === 1 && achaCatchVazio(trecho(';;')).length === 1);
  check('BYPASS (HOLE 1/regex): um literal regex com aspa ACIMA não esconde o catch vazio a jusante', achaCatchVazio(`const re = /` + `'` + `/;\n` + trecho('', 'e')).length === 1);
  check('NUNCA BLOQUEIA: divisão a/b não é lida como regex (não corrompe o resto)', achaCatchVazio('const x = a / b;\n' + trecho(' throw e; ', 'e')).length === 0);

  // ── PORTA (issue #17): processo real, via --dir em árvores tmp ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (dir) => spawnSync(process.execPath, [meu, '--dir', dir], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '' } }).status;
  const limpo = mkdtempSync(join(tmpdir(), 'ec-limpo-'));
  const sujo = mkdtempSync(join(tmpdir(), 'ec-sujo-'));
  try {
    writeFileSync(join(limpo, 'ok.mjs'), trecho(' throw e; ', 'e') + '\n');           // catch tratado
    writeFileSync(join(limpo, 'nota.md'), `um ${K} {} num .md não é código, não conta\n`); // extensão não-código: ignorada
    check('PORTA: --dir de árvore limpa (catch tratado, .md ignorado) → exit 0', porta(limpo) === 0);
    writeFileSync(join(sujo, 'vaza.mjs'), trecho('') + '\n');                          // catch vazio
    check('PORTA: --dir de árvore com catch vazio → exit 1', porta(sujo) === 1);
    check('PORTA: --dir sem caminho → exit 2', spawnSync(process.execPath, [meu, '--dir'], { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } }).status === 2);
    check('PORTA: --dir inexistente → escanear rejeita → rodapé → exit 2', porta(join(sujo, 'nao-existe')) === 2);
  } finally { rmSync(limpo, { recursive: true, force: true }); rmSync(sujo, { recursive: true, force: true }); }

  // ── PORTA: subpasta que é outro checkout git DE VERDADE (.git/ com HEAD) não é varrida ──
  const aninha = mkdtempSync(join(tmpdir(), 'ec-aninha-'));
  try {
    mkdirSync(join(aninha, 'sub', '.git'), { recursive: true });
    writeFileSync(join(aninha, 'sub', '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(aninha, 'sub', 'viola.mjs'), trecho('') + '\n'); // catch vazio DENTRO de outro checkout REAL
    check('NUNCA BLOQUEIA (checkout real): subpasta com .git/HEAD não é varrida → exit 0', porta(aninha) === 0);
    writeFileSync(join(aninha, 'viola.mjs'), trecho('') + '\n'); // o MESMO arquivo fora de sub/ (raiz sem .git próprio) é varrido normalmente
    check('PORTA: o mesmo arquivo fora de sub/ (sem .git) é varrido normalmente → exit 1', porta(aninha) === 1);
    // BYPASS (.git falso): troca o checkout REAL por um `.git` arquivo com gitdir pro nada — não esconde nada.
    rmSync(join(aninha, 'viola.mjs'), { force: true }); // tira a violação da raiz: o exit 1 abaixo só pode vir de dentro de sub/
    rmSync(join(aninha, 'sub', '.git'), { recursive: true, force: true });
    writeFileSync(join(aninha, 'sub', '.git'), 'gitdir: nao-existe\n');
    check('BYPASS (.git falso): sub/.git com "gitdir: nao-existe" NÃO esconde a violação → exit 1', porta(aninha) === 1);
  } finally { rmSync(aninha, { recursive: true, force: true }); }

  // ── STACK (R6, 2026-09-11): "stack":"python" em esteira.json isenta este guard (só lê JS/TS) ──
  const stackPy = mkdtempSync(join(tmpdir(), 'ec-stack-py-'));
  const stackNode = mkdtempSync(join(tmpdir(), 'ec-stack-node-'));
  const stackRuim = mkdtempSync(join(tmpdir(), 'ec-stack-ruim-'));
  try {
    writeFileSync(join(stackPy, 'esteira.json'), JSON.stringify({ stack: 'python' }));
    writeFileSync(join(stackPy, 'vaza.mjs'), trecho('') + '\n'); // catch vazio de verdade — mas o projeto é python
    check('STACK: projeto python (esteira.json) → NAO_APLICAVEL exit 0, mesmo com catch vazio no disco', porta(stackPy) === 0);
    writeFileSync(join(stackNode, 'esteira.json'), JSON.stringify({ stack: 'node' }));
    writeFileSync(join(stackNode, 'vaza.mjs'), trecho('') + '\n');
    check('STACK: projeto node (explícito) → regra normal (reprova o catch vazio)', porta(stackNode) === 1);
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
