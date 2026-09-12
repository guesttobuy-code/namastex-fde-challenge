#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: a issue #17 mostrou que um guard pode ter self-test verde e o `main()` (a PORTA,
 *   o exit code) silenciado ao mesmo tempo — nada na bateria cobrava que o self-test de CADA guard
 *   realmente MORDESSE uma mutação na decisão exit 0/1/2. `run-selftests.mjs` cobra que o self-test
 *   RODE e IMPRIMA "SELF-TEST OK"; não cobra que ele reprove quando a porta é sabotada. Este é o
 *   META-GUARD que fecha essa lacuna: a defesa estrutural da classe do #17, um nível acima de cada
 *   guard individual.
 *
 * O QUE FAZ: descobre os guards em `scripts/guards/*.mjs` (exceto `run-selftests.mjs` e este
 *   próprio arquivo). Para cada um, acha as mutações CANÔNICAS que casam no fonte, aplica cada uma a
 *   uma CÓPIA DESCARTÁVEL de toda a árvore `scripts/` (nunca a real — os guards importam `../lib/...`
 *   por caminho relativo) e roda `node <cópia>/guards/<guard>.mjs --self-test`. Exige que o
 *   self-test REPROVE (exit ≠ 0 = MORDEU). Mutante que sobrevive (exit 0 = SOBREVIVEU) significa que
 *   a porta daquele guard tem um caminho sem contra-prova — o guard não está pronto.
 *
 * MUTAÇÕES CANÔNICAS (Parte 8 de governance/COMO-CRIAR-GUARD.md):
 *   `process.exitCode = 1` → `= 0` · `process.exitCode = 2` → `= 0` · `process.exit(1)` → `exit(0)`
 *   · `? 0 : 1` → `? 0 : 0` (cobre `return r.ok ? 0 : 1`). NÃO usa `return 1;` cru — casaria demais.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. guard cujo self-test não morde a mutação da própria porta (a classe exata da issue #17);
 *   2. guard sem NENHUMA mutação canônica aplicável passando batido como "ok" — vira suspeito, exit 1;
 *   3. cópia/mutação que falha saindo como exit 0 — é exit 2 (NÃO MEDIU; "não consegui medir" nunca
 *      é a mesma coisa que "medi e está tudo bem").
 *
 * INCIDENTE DE ORIGEM: issue #17.
 *
 * MODO DE FALHA JÁ ESCAPADO: nenhum ainda — guard novo (onda da prova-de-vida, 2ª rodada da
 *   auditoria fria do kit).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: mutações FORA da porta. A lógica de decisão pura (a função exportada
 *   de cada guard, tipo `julgar`/`avaliar`) é coberta pelo self-test do PRÓPRIO guard, não por aqui —
 *   este meta-guard só audita o EXIT CODE final (a PORTA), nunca se a decisão em si está certa.
 *
 * LIMITE CONHECIDO: a mutação é por SUBSTITUIÇÃO LITERAL DE STRING (texto, não AST). Se um padrão
 *   canônico aparecesse dentro de um COMENTÁRIO ou STRING (não como código real), a mutação daquele
 *   trecho seria inerte: o comportamento não muda e o mutante é corretamente reportado como
 *   SOBREVIVEU — o mesmo veredito que uma porta morta de verdade receberia. Nunca vira uma aprovação
 *   falsa (o pior caso é um fix-hint apontando para texto em vez de código); nos 5 guards reais de
 *   hoje isso não ocorre (conferido por grep antes de escrever este arquivo).
 *   BANCA: BASELINE — NÃO SE APLICA: não há allowlist/baseline/opt-out por guard; todo `.mjs` em
 *     `scripts/guards/` é varrido, sem exceção configurável.
 *   BANCA: IMPORT — NÃO SE APLICA: a descoberta é por NOME DE ARQUIVO (`readdirSync`) e cada guard
 *     roda como PROCESSO separado (`spawnSync` com caminho explícito) — não há import/alias/
 *     re-export no mecanismo de descoberta ou execução para um atacante entrar por atalho.
 *   BANCA: PATH — NÃO SE APLICA: o caminho do mutante é construído pelo próprio prova-de-vida
 *     (`join(cópia, subpasta, guard)`), nunca vem de entrada externa — não há link/junction a resolver.
 *   BANCA: RENOMEAR — NÃO SE APLICA: a existência/contagem certa dos guards é vigiada por
 *     `GUARDS_ESPERADOS` em `run-selftests.mjs` (mutante R1); este guard só julga a PORTA dos guards
 *     que RECEBE, nunca se a lista de guards está completa.
 *
 * CONTRA-PROVA: node scripts/guards/prova-de-vida.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { NAO_SAO_GUARDS } from './guards-esperados.mjs';

const NOME = 'prova-de-vida';
const GUARDS_DIR = dirname(fileURLToPath(import.meta.url));
// Excluídos por definição (não por medida): o que não é guard (dono único: guards-esperados.mjs) e
// o próprio prova-de-vida (um guard não se mede a si mesmo).
const EXCLUIDOS = new Set([...NAO_SAO_GUARDS, 'prova-de-vida.mjs']);

// ─── as 4 mutações canônicas (Parte 8 de COMO-CRIAR-GUARD.md) ────────────────
const CANONICAS = Object.freeze([
  Object.freeze({ de: 'process.exitCode = 1', para: 'process.exitCode = 0' }),
  Object.freeze({ de: 'process.exitCode = 2', para: 'process.exitCode = 0' }),
  Object.freeze({ de: 'process.exit(1)', para: 'process.exit(0)' }),
  Object.freeze({ de: '? 0 : 1', para: '? 0 : 0' }),
]);

/**
 * FUNÇÃO PURA: quais das 4 mutações canônicas casam ≥1 vez no fonte, e quantas vezes.
 * Sem fs, sem git, sem process.exit — só texto entrando, lista saindo.
 * @param {string} fonte
 * @returns {{de:string, para:string, ocorrencias:number}[]}
 */
export function mutacoesAplicaveis(fonte) {
  const texto = String(fonte ?? '');
  return CANONICAS
    .map(({ de, para }) => ({ de, para, ocorrencias: texto.split(de).length - 1 }))
    .filter((m) => m.ocorrencias > 0);
}

function aplicarMutacao(texto, { de, para }) {
  return texto.split(de).join(para);
}

/** Env do filho: sem GIT_* (hook do git contaminaria repos temporários dos self-tests) e sem passthrough do npm. */
function envParaFilho(base = process.env) {
  const limpo = Object.fromEntries(Object.entries(base).filter(([k]) => !/^GIT_/i.test(k)));
  return { ...limpo, npm_lifecycle_event: '' };
}

/** Roda `node <caminho> --self-test` do guard MUTADO (na cópia) e devolve o exit code cru. */
function rodarSelfTestMutado(caminho) {
  const r = spawnSync(process.execPath, [caminho, '--self-test'], { encoding: 'utf8', timeout: 600_000, env: envParaFilho(), windowsHide: true });
  return r.status;
}

function descobrirGuards(dir, only) {
  const todos = readdirSync(dir).filter((f) => /\.mjs$/i.test(f) && !EXCLUIDOS.has(f)).sort();
  return only ? todos.filter((f) => f === only) : todos;
}

/**
 * Copia a árvore inteira (`scriptsRoot`) para um tmp descartável, muta APENAS a cópia do
 * `guard` alvo e roda o self-test mutado. Limpa o tmp num finally. NUNCA toca a árvore real.
 */
function rodarMutante({ scriptsRoot, subpasta, guard, mutacao }) {
  const tmp = mkdtempSync(join(tmpdir(), 'pdv-'));
  try {
    cpSync(scriptsRoot, tmp, { recursive: true });
    const alvo = join(tmp, subpasta, guard);
    writeFileSync(alvo, aplicarMutacao(readFileSync(alvo, 'utf8'), mutacao));
    const exit = rodarSelfTestMutado(alvo);
    return { de: mutacao.de, para: mutacao.para, ocorrencias: mutacao.ocorrencias, exit, mordeu: exit !== 0 };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Faz cópia+mutação+run para cada guard descoberto em `dir` (ou só `only`, se informado).
 * `dir` é a pasta de GUARDS — o pai (`dirname(dir)`) é a árvore `scripts/` inteira que vira cópia,
 * porque os guards importam `../lib/...` por caminho relativo.
 * @returns {{guard:string, semMutacaoAplicavel:boolean, mutantes:object[], passou:boolean}[]}
 */
export function medir({ dir = GUARDS_DIR, only = null } = {}) {
  const scriptsRoot = dirname(dir);
  const subpasta = relative(scriptsRoot, dir);
  const guards = descobrirGuards(dir, only);
  return guards.map((guard) => {
    const fonte = readFileSync(join(dir, guard), 'utf8');
    const mutacoes = mutacoesAplicaveis(fonte);
    if (mutacoes.length === 0) return { guard, semMutacaoAplicavel: true, mutantes: [], passou: false };
    const mutantes = mutacoes.map((m) => rodarMutante({ scriptsRoot, subpasta, guard, mutacao: m }));
    return { guard, semMutacaoAplicavel: false, mutantes, passou: mutantes.every((x) => x.mordeu) };
  });
}

function main() {
  const argv = process.argv.slice(2);
  const iOnly = argv.indexOf('--only');
  const only = iOnly >= 0 ? argv[iOnly + 1] : null;

  let resultados;
  try {
    resultados = medir({ dir: GUARDS_DIR, only });
  } catch (e) {
    console.error(`[${NOME}] NÃO MEDIU: a cópia/mutação falhou antes de rodar qualquer self-test: ${e?.message || e}`);
    process.exitCode = 2;
    return;
  }
  if (resultados.length === 0) {
    console.error(`[${NOME}] NÃO MEDIU: nenhum guard encontrado em ${GUARDS_DIR}${only ? ` para --only ${only}` : ''}.`);
    process.exitCode = 2;
    return;
  }

  let ruins = 0;
  for (const r of resultados) {
    if (r.semMutacaoAplicavel) {
      console.error(`❌ ${r.guard}: sem porta de saída mutável — suspeito (nenhuma das 4 mutações canônicas casa no fonte).`);
      ruins++;
      continue;
    }
    const sobreviventes = r.mutantes.filter((m) => !m.mordeu);
    if (sobreviventes.length === 0) {
      const ocorrencias = r.mutantes.reduce((a, m) => a + m.ocorrencias, 0);
      console.log(`✅ ${r.guard}: ${r.mutantes.length} mutante(s) mordido(s) (${ocorrencias} ocorrência(s) no fonte).`);
    } else {
      for (const s of sobreviventes) console.error(`❌ ${r.guard}: mutante SOBREVIVEU (${s.de} → ${s.para}) — self-test mutado saiu ${s.exit} (esperava ≠ 0).`);
      ruins++;
    }
  }
  if (ruins) {
    console.error(`\n[${NOME}] ❌ ${ruins}/${resultados.length} guard(s) reprovado(s).`);
    console.error('   FIX-HINT: o self-test do guard precisa RODAR A PORTA como processo (spawnSync do próprio arquivo');
    console.error('   com --self-test) e CONFERIR O EXIT CODE — asserção só sobre a função pura não morde mutação no');
    console.error('   main(). Ver a seção "PORTA (issue #17)" de prova-colada.mjs ou frente-registro.mjs como modelo.');
    console.error('   "sem porta de saída mutável" → confira se o guard usa process.exitCode/process.exit ou `?0:1`;');
    console.error('   se usa outra forma de sinalizar exit code, isto é um achado — não silencie, avise antes.');
    process.exitCode = 1;
    return;
  }
  console.log(`\n[${NOME}] ✅ ${resultados.length} guard(s): todo mutante aplicável foi mordido pelo próprio self-test.`);
  process.exitCode = 0;
}

// ─── fixtures da banca de burla (guards FALSOS, só existem dentro de árvores tmp do self-test) ──
const FAKE_SUBSTITUIR = `#!/usr/bin/env node
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
function main() {
  const ruim = process.argv.includes('--ruim');
  if (ruim) { process.exitCode = 1; return; }
  process.exitCode = 0;
}
function selfTest() {
  // BURLA (classe 10, SUBSTITUIR): nunca roda main() nem spawna a si mesmo - so afirma sucesso.
  console.log('[fake-substituir] SELF-TEST OK - 1/1 casos (incl. 0 tentativas de bypass).');
  process.exitCode = 0;
}
if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
`;

const FAKE_NULO = `#!/usr/bin/env node
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
function main() {
  const ruim = process.argv.includes('--ruim');
  if (ruim) { process.exitCode = 1; return; }
  process.exitCode = 0;
}
function selfTest() {
  // BURLA (classe 7, NULO/VAZIO): quebra sem logar nada reconhecivel - nunca pode virar "sem violacao".
  throw new Error('fake-nulo: self-test quebrado de proposito (nao loga SELF-TEST OK)');
}
if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
`;

const FAKE_HONESTO = `#!/usr/bin/env node
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
export function julgar(entrada) { return entrada === 'bom'; }
function main() {
  const entrada = process.argv[2];
  if (!julgar(entrada)) { process.exitCode = 1; return; }
  process.exitCode = 0;
}
function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const rodar = (arg) => {
    const argvAntes = process.argv;
    const exitAntes = process.exitCode;
    process.argv = ['node', 'fake-honesto.mjs', arg];
    process.exitCode = undefined;
    main();
    const resultado = process.exitCode;
    process.argv = argvAntes;
    process.exitCode = exitAntes;
    return resultado;
  };
  check('entrada ruim vira exit 1', rodar('ruim') === 1);
  check('entrada boa vira exit 0', rodar('bom') === 0);
  process.exitCode = relatarSelfTest('fake-honesto', casos);
}
if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
`;

const FAKE_SEM_PORTA = `#!/usr/bin/env node
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
function decidir(entrada) { return entrada === 'bom' ? 'aprovado' : 'reprovado'; }
function main() {
  const r = decidir(process.argv[2]);
  console.log('[fake-sem-porta] ' + r);
  process.exitCode = r === 'aprovado' ? 0 : 9;
}
function selfTest() {
  const casos = [{ nome: 'decidir aprova entrada boa', ok: decidir('bom') === 'aprovado' }];
  process.exitCode = relatarSelfTest('fake-sem-porta', casos);
}
if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
`;

/** Monta `<tmp>/guards/<nomeArquivo>` + `<tmp>/lib` (copiada da real) e chama `fn(<tmp>/guards)`. Limpa depois. */
function comArvoreFalsa(fonte, nomeArquivo, fn) {
  const raiz = mkdtempSync(join(tmpdir(), 'pdv-banca-'));
  try {
    cpSync(join(dirname(GUARDS_DIR), 'lib'), join(raiz, 'lib'), { recursive: true });
    mkdirSync(join(raiz, 'guards'), { recursive: true });
    writeFileSync(join(raiz, 'guards', nomeArquivo), fonte);
    return fn(join(raiz, 'guards'));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── mutacoesAplicaveis: função pura ──────────────────────────────────────────
  check('mutacoesAplicaveis: "process.exitCode = 1;" → não-vazio', mutacoesAplicaveis('process.exitCode = 1;').length > 0);
  check('mutacoesAplicaveis: "process.exitCode = 2;" → não-vazio', mutacoesAplicaveis('process.exitCode = 2;').length > 0);
  check('mutacoesAplicaveis: "process.exit(1);" → não-vazio', mutacoesAplicaveis('process.exit(1);').length > 0);
  check('mutacoesAplicaveis: "return r.ok ? 0 : 1;" → não-vazio (cobre o ternário)', mutacoesAplicaveis('return r.ok ? 0 : 1;').length > 0);
  check('mutacoesAplicaveis: "return foo();" → vazio (sem porta reconhecível)', mutacoesAplicaveis('return foo();').length === 0);
  check('mutacoesAplicaveis: conta ocorrências (a mesma linha 2x → 2)', mutacoesAplicaveis('process.exitCode = 1;\nprocess.exitCode = 1;\n').find((m) => m.de === 'process.exitCode = 1')?.ocorrencias === 2);
  check('mutacoesAplicaveis: "process.exitCode = 0;" sozinho não casa nenhuma canônica', mutacoesAplicaveis('process.exitCode = 0;').length === 0);
  check('BYPASS: "return 1;" cru não é reconhecido (casaria demais — fora das 4 canônicas)', mutacoesAplicaveis('return 1;').length === 0);
  check('BYPASS (classe 1, VAZIO): fonte vazia/undefined → nenhuma mutação aplicável, nunca aprova por falta do que reprovar', mutacoesAplicaveis('').length === 0 && mutacoesAplicaveis(undefined).length === 0);
  check('BYPASS (classe 9, INVISÍVEL): U+200B dentro do padrão quebra o casamento literal (cai em "suspeito", nunca em aprovação silenciosa)', mutacoesAplicaveis('process.exitCode​ = 1;').length === 0);

  // ── banca de burla: guards FALSOS em árvores scripts/ descartáveis (lib real copiada) ─────────
  comArvoreFalsa(FAKE_SUBSTITUIR, 'fake-substituir.mjs', (dirGuards) => {
    const r = medir({ dir: dirGuards, only: 'fake-substituir.mjs' });
    check('BYPASS (classe 10, SUBSTITUIR): self-test que nunca roda a porta de verdade → prova-de-vida reporta SOBREVIVEU (reprova)',
      r.length === 1 && r[0].semMutacaoAplicavel === false && r[0].passou === false && r[0].mutantes.length === 1 && r[0].mutantes[0].mordeu === false);
  });

  comArvoreFalsa(FAKE_NULO, 'fake-nulo.mjs', (dirGuards) => {
    const r = medir({ dir: dirGuards, only: 'fake-nulo.mjs' });
    check('BYPASS (classe 7, NULO/VAZIO): self-test que explode sem logar nada → classificado MORDEU pelo exit ≠ 0, nunca "sem violação" silenciosa',
      r.length === 1 && typeof r[0].passou === 'boolean' && r[0].mutantes.length === 1 && r[0].mutantes[0].mordeu === true && r[0].passou === true);
  });

  comArvoreFalsa(FAKE_HONESTO, 'fake-honesto.mjs', (dirGuards) => {
    const r = medir({ dir: dirGuards, only: 'fake-honesto.mjs' });
    check('CONTROLE POSITIVO (o que NUNCA pode bloquear): guard honesto cujo self-test roda a porta de verdade → prova-de-vida aprova',
      r.length === 1 && r[0].semMutacaoAplicavel === false && r[0].passou === true && r[0].mutantes.every((m) => m.mordeu === true));
  });

  comArvoreFalsa(FAKE_SEM_PORTA, 'fake-sem-porta.mjs', (dirGuards) => {
    const r = medir({ dir: dirGuards, only: 'fake-sem-porta.mjs' });
    check('guard sem nenhuma das 4 mutações canônicas aplicáveis → "sem porta de saída mutável", nunca passou',
      r.length === 1 && r[0].semMutacaoAplicavel === true && r[0].mutantes.length === 0 && r[0].passou === false);
  });

  // ── descoberta exclui o runner e a si mesmo, mesmo pedindo --only explicitamente ──────────────
  check('descoberta nunca inclui run-selftests.mjs nem prova-de-vida.mjs',
    medir({ dir: GUARDS_DIR, only: 'run-selftests.mjs' }).length === 0 && medir({ dir: GUARDS_DIR, only: 'prova-de-vida.mjs' }).length === 0);
  check('medir com --only em arquivo inexistente → lista vazia (main() trata como NÃO MEDIU)', medir({ dir: GUARDS_DIR, only: 'nao-existe-de-verdade.mjs' }).length === 0);

  // ── PORTA (issue #17, aplicada a si mesmo): o guard como processo, exit code cobrado ──────────
  const porta = (args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', timeout: 600_000, env: envParaFilho() }).status;
  check('PORTA: --only num guard real e imune (frente-registro.mjs) → exit 0', porta(['--only', 'frente-registro.mjs']) === 0);
  check('PORTA: --only num arquivo que não existe → exit 2 (NÃO MEDIU, nunca 0)', porta(['--only', 'nao-existe-de-verdade.mjs']) === 2);

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
