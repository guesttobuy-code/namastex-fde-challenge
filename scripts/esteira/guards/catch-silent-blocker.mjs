#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: irmão do empty-catch, a MESMA dor ("diz que funciona e não funciona") por outra
 *   porta. O empty-catch pega o `catch {}` vazio; este pega o catch que NÃO está vazio mas também não
 *   TRATA: o corpo só LOGA o erro (console/logger) e deixa a execução seguir como se nada tivesse
 *   falhado. O erro é "bloqueado" silenciosamente — vira uma linha de log que ninguém lê e o programa
 *   continua num estado inválido. Erro se trata (relança/recupera/retorna) ou sobe; logar-e-seguir não é tratar.
 *
 * O QUE FAZ: escaneia arquivos de código (.mjs/.cjs/.js/.jsx/.ts/.tsx/.mts/.cts) sob --dir (ou cwd),
 *   sobre o código DESPIDO (comentário/string/regex viram espaço → chaves dentro deles não contam, então
 *   o corpo do catch é extraído com CONTAGEM DE CHAVES confiável). Reprova um `catch` cujo corpo, tirados
 *   os logs reconhecidos, fica VAZIO — ou seja, o corpo é SÓ log e nada mais. Opt-out por-catch com
 *   `ignora-de-proposito` (o mesmo do empty-catch: "eu quis engolir, e pensei nisso").
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. `catch (e) { console.error(e); }` (ou `logger.warn(e)`, `log.info(e)`) e nada além — loga e engole.
 *
 * O QUE NUNCA PODE BLOQUEAR (família de falsos-positivos):
 *   - catch que RELANÇA (`throw`), RETORNA (`return`), recupera (atribuição/fallback) ou chama qualquer
 *     coisa que NÃO seja log reconhecido (ex.: `res.error(500)` responde o erro; `analytics.log(e)` não
 *     é log de console/logger; `next(e)` do express; `reject(e)`; `process.exit`) — tudo isso é tratamento;
 *   - catch VAZIO (é do empty-catch, não daqui); catch com opt-out `ignora-de-proposito`.
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) log via logger NÃO reconhecido — só conto `console`/`logger`/`log` na
 *   RAIZ da cadeia (ou sob this/self/globalThis); pino num `req.log.info(e)` ou `db.log.insert(e)` NÃO é
 *   tratado como log (de propósito — CSB-02: `.log.` de outro objeto costuma ser persistência/auditoria, não
 *   console), então um swallow com logger exótico escapa (o auditor pega); (b) log CONDICIONAL
 *   (`if (x) console.error(e)`) — sobra o `if` no corpo, não é "só log" → não flagra (conservador); (c)
 *   `return`/`throw`/atribuição no corpo (ex.: `catch { log; return null; }`) — é tratamento/decisão do autor,
 *   não flagra; (d) tratamento INADEQUADO que EXISTE (loga e recupera errado) — mede FORMA (só-log), não qualidade;
 *   (e) subpasta que é outro checkout git DE VERDADE (`.git` com `HEAD`, ou `gitdir:` apontando para um
 *   diretório com `HEAD` — worktree, submódulo) não é varrida: é outra árvore; um `.git` FALSO não esconde nada;
 *   (f) CÓDIGO PYTHON — este guard só lê JS/TS; num projeto com "stack": "python" em esteira.json ele sai
 *   NAO_APLICAVEL (exit 0) sem olhar um .py sequer (R6, 2026-09-11).
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial (onda 3): extração/despir/opt-out/meta passaram; o
 *   `soLog` tinha 4 furos, todos consertados. (CSB-01, alta) testava o corpo CRU por throw/return/`=` ANTES
 *   de tirar os logs → um `return`/`yield`/`=` DENTRO dos ARGS do log (`console.error(e,{return:null})`)
 *   isentava o catch (falso-negativo). (CSB-03, baixa) idem pra atribuição nos args. Consertados: agora tira
 *   os logs PRIMEIRO e julga só o RESÍDUO (o que sobra além dos logs) — as pré-checagens do texto cru sumiram.
 *   (CSB-02, média) a cadeia livre antes de `log` fazia `audit.log.record(e)` parecer log → falso-positivo em
 *   persistência; agora console/logger/log tem que ser a RAIZ (ou sob this/self/globalThis). (CSB-04, baixa)
 *   `catch ({x=def()})` — o `)` do default truncava o regex do parâmetro; agora o parâmetro é varrido por
 *   profundidade de parênteses.
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — TRATADA: opera no código DESPIDO; um `catch {…}` citado em doc/string não
 *     conta, e a contagem de chaves/parênteses não se confunde com os que estão dentro de string/regex
 *     (viraram espaço). Esta fonte monta os fixtures com a palavra `catch` PARTIDA (cat+ch), não se auto-acusa.
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: varre conteúdo de arquivo (readdir a partir de --dir/cwd), não segue import.
 *   BANCA: BASELINE — NÃO SE APLICA: sem allowlist/baseline; todo catch no escopo é medido; opt-out é POR-CATCH.
 *   BANCA: INVISÍVEL/RENOMEAR — o alvo é a FORMA do corpo do catch, não um nome; renomear/mover não cria nem esconde.
 *   VAZIO (corpo vazio → é do empty-catch, aqui não flagra) e NULO (fonte vazia → 0) viram casos. SUBSTITUIR: forma sintática.
 *
 * CONTRA-PROVA: node scripts/guards/catch-silent-blocker.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { despirCodigo, fechar } from '../lib/despir-codigo.mjs';
import { escanearCodigoPadrao } from '../lib/varredura.mjs';
import { stackDoProjeto } from '../lib/stack.mjs';

const NOME = 'catch-silent-blocker';
const MARCADOR_OPTOUT = 'ignora-de-proposito';
// ABERTURA de uma chamada de LOG reconhecida, até o `(`. Conservador (CSB-02 da auditoria): console/logger/log
// tem que ser a RAIZ da cadeia (opcionalmente sob this/self/globalThis) — assim `this.logger.error(` conta,
// mas `audit.log.record(`/`db.log.insert(` (onde `.log` é sub-objeto de OUTRA coisa, e o método é persistência,
// não console) NÃO conta. Forma-bare pega `log(`/`logger(`/`console(` que não sejam método de outra coisa.
const RE_LOG_ABRE = /(?<![.\w$])(?:(?:this|self|globalThis)\s*\.\s*)?(?:console|logger|log)\s*\.\s*\w+\s*\(|(?<![.\w$])(?:console|logger|log)\s*\(/;

// `fechar` (contagem de profundidade — índice do fecho de `abertura`) mudou de dono: agora vive em
// lib/despir-codigo.mjs (exportada), compartilhada por quem mais precisar extrair um bloco balanceado.

/** FUNÇÃO PURA: extrai o corpo do catch (entre as chaves) por profundidade no DESPIDO.
 *  `abre` é o índice da `{` de abertura. Devolve {corpo, fim} ou null se as chaves não fecham. */
export function corpoDoCatch(despido, abre) {
  const fim = fechar(despido, abre, '{', '}');
  return fim < 0 ? null : { corpo: despido.slice(abre + 1, fim), fim };
}

/** FUNÇÃO PURA: o corpo (despido) é SÓ log? Estratégia (CSB-01/03 da auditoria): PRIMEIRO tira todas as
 *  chamadas de log com args BALANCEADOS (parênteses por profundidade — não `[^;]*`, que atravessaria um `;`
 *  omitido/ASI, nem teste do texto CRU, que confundiria um `return`/`=` DENTRO dos args do log com
 *  tratamento no corpo). O que sobra é "tudo ALÉM dos logs": se for só espaço/`;`, o corpo era só log
 *  (engole). Qualquer resíduo — throw/return/atribuição/outra chamada — é tratamento → não flagra. */
export function soLog(corpo) {
  let s = String(corpo ?? ''), temLog = false, mudou = true;
  while (mudou) {
    mudou = false;
    const m = s.match(RE_LOG_ABRE);
    if (m) {
      const fim = fechar(s, m.index + m[0].length - 1, '(', ')');
      if (fim >= 0) { s = `${s.slice(0, m.index)} ${s.slice(fim + 1)}`; temLog = true; mudou = true; }
    }
  }
  return temLog && !/[^\s;]/.test(s);
}

/** FUNÇÃO PURA: catches silenciosos (só-log, sem opt-out). Recebe o fonte ORIGINAL. Sem fs, sem exit.
 *  Acha o `catch` por palavra e localiza o `{` do corpo com scan por PROFUNDIDADE do parâmetro opcional
 *  (CSB-04: `catch ({ x = def() })` — o `)` interno do default não pode truncar o casamento). Um `.catch(`
 *  de Promise não tem `{` logo após o parâmetro → é ignorado. */
export function achaCatchSilencioso(fonte) {
  const texto = String(fonte ?? '');
  const despido = despirCodigo(texto);
  const achados = [];
  const reKw = /\bcatch\b/g;
  let m;
  while ((m = reKw.exec(despido))) {
    let i = m.index + 5; // após "catch"
    while (i < despido.length && /\s/.test(despido[i])) i++;
    if (despido[i] === '(') { const f = fechar(despido, i, '(', ')'); if (f < 0) continue; i = f + 1; while (i < despido.length && /\s/.test(despido[i])) i++; }
    if (despido[i] !== '{') continue; // não é bloco catch (ex.: método `.catch(` de Promise)
    const corpo = corpoDoCatch(despido, i);
    if (!corpo || !soLog(corpo.corpo)) continue;
    const original = texto.slice(m.index, corpo.fim + 1); // catch inteiro no ORIGINAL (pra ver o opt-out)
    if (original.includes(MARCADOR_OPTOUT)) continue;
    achados.push({ linha: despido.slice(0, m.index).split('\n').length });
  }
  return achados;
}

// walker + config de código: DONO ÚNICO em lib/varredura.mjs (mesma semântica de sempre; arquivo acima
// do teto é pulado calado — ignoramos `naoMedidos`, como este guard sempre fez).
function escanear(dir) {
  return escanearCodigoPadrao(dir, achaCatchSilencioso);
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
  if (achados.length === 0) { console.log(`[${NOME}] ✅ nenhum catch que só loga e engole em ${dir}.`); return 0; }
  for (const a of achados) console.error(`[${NOME}] FALHA: catch que só loga e engole o erro em ${a.arquivo}:${a.linha}`);
  console.error(`[${NOME}] COMO PASSAR: além de logar, TRATE o erro (relance com \`throw\`, retorne um fallback explícito, recupere) ou deixe-o subir. Se logar-e-seguir é MESMO o certo aqui, comente com "${MARCADOR_OPTOUT}: <motivo>" dentro do catch.`);
  console.error(`[${NOME}] POR QUE EXISTE: catch que só loga engole a falha — o programa segue num estado inválido e o bug explode longe da causa.`);
  return 1;
}

// ── fixtures: a palavra "catch" é MONTADA (cat+ch) pra não existir catch literal nesta fonte ──
const K = 'cat' + 'ch';
const t = (corpo, bind = 'e') => `try { risco(); } ${K}${bind ? ` (${bind})` : ''} { ${corpo} }`;

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── soLog / corpoDoCatch (função pura) ──
  check('soLog: só console.error → true', soLog(' console.error(e); ') === true);
  check('soLog: só logger.warn / log.info → true', soLog(' logger.warn(e); ') === true && soLog(' log.info(x) ') === true);
  check('soLog: this.logger.error (cadeia) → true', soLog(' this.logger.error(e); ') === true);
  check('soLog: log + throw → false (relança)', soLog(' console.error(e); throw e; ') === false);
  check('soLog: log + return → false', soLog(' console.error(e); return null; ') === false);
  check('soLog: log + atribuição (recupera) → false', soLog(' console.error(e); estado = fallback; ') === false);
  check('soLog: res.error(500) (não é log reconhecido) → false', soLog(' res.error(500); ') === false);
  check('soLog: analytics.log(e) (método .log de outro objeto) → false', soLog(' analytics.log(e); ') === false);
  check('soLog: corpo vazio → false (é do empty-catch)', soLog('   ') === false && soLog('') === false);
  check('corpoDoCatch: casa a chave certa com aninhamento', corpoDoCatch('X{ a{b} c }', 1).corpo === ' a{b} c ');
  // CSB-01 (auditoria): palavra-chave DENTRO dos args do log não pode isentar (some junto com a chamada)
  check('soLog CSB-01: console.error(e, { return: null }) → true (return está NOS ARGS, não no corpo)', soLog(' console.error(e, { return: null }); ') === true);
  check('soLog CSB-01: logger.warn(e, { yield: 1 }) / console.error(e, { throw: true }) → true', soLog(' logger.warn(e, { yield: 1 }); ') === true && soLog(' console.error(e, { throw: true }); ') === true);
  // CSB-03 (auditoria): atribuição DENTRO dos args do log também não isenta
  check('soLog CSB-03: console.error((seen = seen + 1), e) → true (atribuição nos args)', soLog(' console.error((seen = seen + 1), e); ') === true);
  // CSB-02 (auditoria): `.log.` de OUTRO objeto (persistência) não é log reconhecido → não flagra
  check('soLog CSB-02: audit.log.record(err) → false (persistência, não console/logger raiz)', soLog(' audit.log.record(err); ') === false);
  check('soLog CSB-02: db.log.insert({ err }) → false', soLog(' db.log.insert({ err }); ') === false);

  // ── o que NUNCA pode passar ──
  check('BYPASS: catch { console.error(e); } → achado', achaCatchSilencioso(t('console.error(e);')).length === 1);
  check('BYPASS: catch { logger.warn(e); } → achado', achaCatchSilencioso(t('logger.warn(e);')).length === 1);
  check('BYPASS: catch com dois logs e nada mais → achado', achaCatchSilencioso(t('console.error(e); console.debug(e);')).length === 1);
  check('BYPASS: log com arg FORMATADO (parênteses aninhados) console.error(fmt(e)) → achado (é só log)', achaCatchSilencioso(t('console.error(fmt(e));')).length === 1);
  check('BYPASS (CSB-01): catch { console.error(e, { return: null }); } → achado', achaCatchSilencioso(t('console.error(e, { return: null });')).length === 1);
  check('BYPASS (CSB-04): catch com destructuring + default de CHAMADA no parâmetro → achado', achaCatchSilencioso(`try { risco(); } ${K} ({ x = def() }) { console.error(x); }`).length === 1);
  check('reporta a linha certa', achaCatchSilencioso(`linha1\nlinha2\n${t('console.error(e);')}`)[0]?.linha === 3);

  // ── o que NUNCA pode bloquear ──
  check('NUNCA BLOQUEIA: catch que relança → 0', achaCatchSilencioso(t('console.error(e); throw e;')).length === 0);
  check('NUNCA BLOQUEIA: catch que retorna fallback → 0', achaCatchSilencioso(t('console.error(e); return null;')).length === 0);
  check('NUNCA BLOQUEIA: catch que recupera (atribui) → 0', achaCatchSilencioso(t('console.error(e); ok = false;')).length === 0);
  check('NUNCA BLOQUEIA: catch com res.error (responde) → 0', achaCatchSilencioso(t('res.error(500);')).length === 0);
  check('NUNCA BLOQUEIA (CSB-02): catch com audit.log.record (persistência) → 0', achaCatchSilencioso(t('audit.log.record(err);')).length === 0);
  check('NUNCA BLOQUEIA (ASI): log + handler SEM ponto-e-vírgula não é engolido (args balanceados) → 0', achaCatchSilencioso(t('console.error(e)\n recuperar()')).length === 0);
  check('NUNCA BLOQUEIA: catch VAZIO (é do empty-catch) → 0', achaCatchSilencioso(t('')).length === 0);
  check('NUNCA BLOQUEIA: opt-out ignora-de-proposito → 0', achaCatchSilencioso(t(`console.error(e); /* ${MARCADOR_OPTOUT}: best-effort */`)).length === 0);
  check('NUNCA BLOQUEIA (COMENTÁRIO): catch só-log dentro de // não conta (despido)', achaCatchSilencioso('// ' + t('console.error(e);')).length === 0);
  check('NUNCA BLOQUEIA (STRING): catch só-log dentro de string não conta (despido)', achaCatchSilencioso('const s = ' + JSON.stringify(t('console.error(e);')) + ';').length === 0);
  check('NUNCA BLOQUEIA (VAZIO): fonte vazia/undefined → 0', achaCatchSilencioso('').length === 0 && achaCatchSilencioso(undefined).length === 0);
  check('NUNCA BLOQUEIA: catch aninhando try/catch real → outer não flagra (tem código)', achaCatchSilencioso(t(`try { y(); } ${K} (e2) { throw e2; }`)).length === 0);

  // ── PORTA (issue #17): processo real, via --dir em árvores tmp ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (dir) => spawnSync(process.execPath, [meu, '--dir', dir], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '' } }).status;
  const limpo = mkdtempSync(join(tmpdir(), 'csb-limpo-'));
  const sujo = mkdtempSync(join(tmpdir(), 'csb-sujo-'));
  try {
    writeFileSync(join(limpo, 'ok.mjs'), t('console.error(e); throw e;') + '\n');
    writeFileSync(join(limpo, 'nota.md'), 'um ' + t('console.error(e);') + ' num .md não conta\n');
    check('PORTA: --dir de árvore limpa (relança, .md ignorado) → exit 0', porta(limpo) === 0);
    writeFileSync(join(sujo, 'engole.mjs'), t('console.error(e);') + '\n');
    check('PORTA: --dir com catch só-log → exit 1', porta(sujo) === 1);
    check('PORTA: --dir sem caminho → exit 2', spawnSync(process.execPath, [meu, '--dir'], { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } }).status === 2);
    check('PORTA: --dir inexistente → escanear rejeita → rodapé → exit 2', porta(join(sujo, 'nao-existe')) === 2);
  } finally { rmSync(limpo, { recursive: true, force: true }); rmSync(sujo, { recursive: true, force: true }); }

  // ── PORTA: subpasta que é outro checkout git DE VERDADE (.git/ com HEAD) não é varrida ──
  const aninha = mkdtempSync(join(tmpdir(), 'csb-aninha-'));
  try {
    mkdirSync(join(aninha, 'sub', '.git'), { recursive: true });
    writeFileSync(join(aninha, 'sub', '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(aninha, 'sub', 'engole.mjs'), t('console.error(e);') + '\n'); // catch só-log DENTRO de outro checkout REAL
    check('NUNCA BLOQUEIA (checkout real): subpasta com .git/HEAD não é varrida → exit 0', porta(aninha) === 0);
    writeFileSync(join(aninha, 'engole.mjs'), t('console.error(e);') + '\n'); // o MESMO arquivo fora de sub/ (sem .git próprio) é varrido normalmente
    check('PORTA: o mesmo arquivo fora de sub/ (sem .git) é varrido normalmente → exit 1', porta(aninha) === 1);
    // BYPASS (.git falso): troca o checkout REAL por um `.git` arquivo com gitdir pro nada — não esconde nada.
    rmSync(join(aninha, 'engole.mjs'), { force: true }); // tira a violação da raiz: o exit 1 abaixo só pode vir de dentro de sub/
    rmSync(join(aninha, 'sub', '.git'), { recursive: true, force: true });
    writeFileSync(join(aninha, 'sub', '.git'), 'gitdir: nao-existe\n');
    check('BYPASS (.git falso): sub/.git com "gitdir: nao-existe" NÃO esconde a violação → exit 1', porta(aninha) === 1);
  } finally { rmSync(aninha, { recursive: true, force: true }); }

  // ── STACK (R6, 2026-09-11): "stack":"python" em esteira.json isenta este guard (só lê JS/TS) ──
  const stackPy = mkdtempSync(join(tmpdir(), 'csb-stack-py-'));
  const stackNode = mkdtempSync(join(tmpdir(), 'csb-stack-node-'));
  const stackRuim = mkdtempSync(join(tmpdir(), 'csb-stack-ruim-'));
  try {
    writeFileSync(join(stackPy, 'esteira.json'), JSON.stringify({ stack: 'python' }));
    writeFileSync(join(stackPy, 'engole.mjs'), t('console.error(e);') + '\n'); // catch só-log de verdade — mas o projeto é python
    check('STACK: projeto python (esteira.json) → NAO_APLICAVEL exit 0, mesmo com catch só-log no disco', porta(stackPy) === 0);
    writeFileSync(join(stackNode, 'esteira.json'), JSON.stringify({ stack: 'node' }));
    writeFileSync(join(stackNode, 'engole.mjs'), t('console.error(e);') + '\n');
    check('STACK: projeto node (explícito) → regra normal (reprova o catch só-log)', porta(stackNode) === 1);
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
