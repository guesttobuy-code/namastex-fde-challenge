#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: a rede caminha para ~110 guards. Sem um índice sempre-atual do que CADA guard
 *   defende, ninguém sabe a cobertura sem abrir 110 arquivos, e guard novo entra sem ninguém
 *   registrar o que ele protege — a coisa mais fácil de esquecer é o mapa da própria rede. Este
 *   guard mantém `governance/GUARDS_CATALOG.md` GERADO a partir da certidão de cada guard e exige
 *   que o arquivo commitado seja idêntico ao gerado (docs-batem-com-a-realidade).
 *
 * O QUE FAZ: lê o "POR QUE EXISTE" de cada guard real, gera o catálogo canônico e compara com o
 *   commitado. Guard sem entrada, entrada de guard que sumiu, resumo desatualizado, ou guard sem
 *   "POR QUE EXISTE" (viola a certidão obrigatória) → reprova. `--write` regenera o arquivo.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. guard novo sem linha no catálogo (a rede cresce sem mapa);
 *   2. catálogo citando guard que não existe mais (mapa mente);
 *   3. guard sem "POR QUE EXISTE" na certidão (nasce sem dizer o incidente que codifica);
 *   4. catálogo editado à mão divergindo do gerado (dono humano de um artefato gerado → LEI 11).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: se o guard FUNCIONA (prova-de-vida/campo minado) ou está CABEADO
 *   (guard-wiring); só se está no índice, com o resumo certo, e com certidão presente. O resumo é a
 *   1ª frase do "POR QUE EXISTE" — não julga a QUALIDADE da prosa, só que ela existe e bate. A
 *   convenção de NOME de arquivo (kebab-case) é vigiada pelo `guard-wiring` (nome-nao-canonico), não
 *   aqui — um dono só por regra (LEI 11); guard não-kebab reprova lá, no full-check, junto.
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial: (A) `resumoDaFonte` procurava "POR QUE EXISTE"
 *   no arquivo INTEIRO — o fix-hint obrigatório em `console.error` fazia um guard SEM certidão passar.
 *   (B) `comparar` era `===` cru e o catálogo LF virava CRLF num checkout novo (autocrlf) → falso-positivo;
 *   agora insensível a EOL. (C) o corte de 1ª frase cortava em "etc."; agora exige período+Maiúscula/fim.
 *   2ª auditoria (sobre o conserto de A): "o 1º bloco de comentário É a certidão" era falso — um bloco de
 *   pragma/licença de UMA estrela antes causava FALSO-POSITIVO, e um banner de uma estrela que só
 *   MENCIONA a frase era aceito. Corrigido: procura o bloco JSDoc de DUAS estrelas que CONTÉM "POR QUE
 *   EXISTE" (pula pragma/licença/banner de uma estrela). E o resumo ganhou TETO de tamanho (HOLE 3: a
 *   1ª frase não fechava antes de dígito/crase e virava um blob de 3 frases).
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — TRATADA (HOLE A): `resumoDaFonte` lê SÓ o bloco JSDoc de duas estrelas
 *     que contém "POR QUE EXISTE"; a frase em string de código (o fix-hint) ou em banner de uma estrela
 *     não é aceita como certidão. A INTEGRIDADE da certidão é do guard-change-ritual (LEI 11).
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: lê arquivos da pasta de guards por readdir + caminho fixo;
 *     nenhum caminho vem de entrada externa (os seams de teste são env, controlados pelo self-test).
 *   VAZIO, BASELINE, NULO, RENOMEAR, INVISÍVEL, SUBSTITUIR viram casos `BYPASS:` no self-test.
 *
 * CONTRA-PROVA: node scripts/guards/guards-catalog.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { raizDoProjeto } from '../lib/raiz-do-guard.mjs';
import { NAO_SAO_GUARDS } from './guards-esperados.mjs';

const NOME = 'guards-catalog';
const GUARDS_DIR = dirname(fileURLToPath(import.meta.url));
// RAIZ (issue #21): sobe até achar esteira.json (kit OU projeto bootstrapado, scripts/esteira/guards/
// incluso); sem esteira.json em lugar nenhum, cai no de sempre (dois níveis acima) — dono único em
// ../lib/raiz-do-guard.mjs, usado também por minefield.mjs.
const RAIZ = raizDoProjeto(GUARDS_DIR);
const CATALOGO_PADRAO = join(RAIZ, 'governance', 'GUARDS_CATALOG.md');
const CABECALHO = '# Catálogo de guards (GERADO — não edite à mão)';
const RODAPE = 'Gerado por `guards-catalog.mjs`. Para atualizar: `npm run guards-catalog -- --write`.';

/** FUNÇÃO PURA: a 1ª frase do "POR QUE EXISTE" da CERTIDÃO (o 1º bloco de comentário) de um guard. '' se não houver.
 *  HOLE A da 1ª auditoria: procurar no arquivo inteiro deixava um "POR QUE EXISTE" solto no CÓDIGO (o fix-hint
 *  obrigatório da Parte 6, `console.error('[x] POR QUE EXISTE: ...')`) valer como certidão. Só o cabeçalho conta. */
const CAP_RESUMO = 160; // teto de caracteres do resumo (índice conciso; HOLE 3 da 2ª auditoria)
export function resumoDaFonte(fonte) {
  const texto = String(fonte ?? '');
  // A certidão é um bloco JSDoc `/** ... */` (dois asteriscos — a convenção de COMO-CRIAR-GUARD) que
  // CONTÉM "POR QUE EXISTE". Não é "o 1º bloco de comentário" (HOLE 1 da 2ª auditoria: um
  // `/* eslint-disable */` ou licença viria antes) nem um `/* banner */` de uma estrela que só
  // MENCIONA a frase (HOLE 2). A INTEGRIDADE da certidão (todos os campos) é do guard-change-ritual.
  const blocos = texto.match(/\/\*\*[\s\S]*?\*\//g) || [];
  const cert = blocos.find((b) => /POR QUE EXISTE/.test(b));
  if (!cert) return '';
  const depois = cert.slice(cert.search(/POR QUE EXISTE/)).replace(/^POR QUE EXISTE[^:]*:/, '').replace(/\*+\/\s*$/, '');
  const limpo = depois.split('\n').map((l) => l.replace(/^\s*\*+\s?/, '')).join(' ').replace(/\s+/g, ' ').trim();
  if (!limpo) return '';
  // 1ª frase: período seguido de MAIÚSCULA ou fim — não corta em "etc."/"#1." antes de minúscula (HOLE C).
  const ponto = limpo.search(/\.(\s+[A-ZÀ-Þ]|\s*$)/);
  let resumo = (ponto >= 0 ? limpo.slice(0, ponto + 1) : limpo).trim();
  // teto de tamanho: quando a "1ª frase" não fecha cedo (período antes de dígito/crase/minúscula), corta na palavra.
  if (resumo.length > CAP_RESUMO) resumo = `${resumo.slice(0, CAP_RESUMO).replace(/\s+\S*$/, '').trim()}…`;
  return resumo;
}

/** FUNÇÃO PURA: o catálogo canônico a partir de [{arquivo, resumo}]. Ordenado por arquivo. */
export function gerarCatalogo(entradas) {
  const linhas = [...entradas].sort((a, b) => a.arquivo.localeCompare(b.arquivo))
    .map((e) => `- \`${e.arquivo}\` — ${e.resumo}`);
  return [CABECALHO, '', `${linhas.length} guard(s):`, '', ...linhas, '', RODAPE, ''].join('\n');
}

/** FUNÇÃO PURA: compara commitado × gerado, INSENSÍVEL a fim-de-linha. HOLE B da 1ª auditoria: com
 *  core.autocrlf=true e sem .gitattributes, o catálogo LF vira CRLF num checkout novo → o `===` cru
 *  reprovava um catálogo byte-idêntico-módulo-EOL (falso-positivo → --no-verify). EOL não é semântico aqui. */
export function comparar(commitado, gerado) {
  const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n');
  if (norm(commitado) === norm(gerado)) return { ok: true, motivo: 'catálogo bate com a rede' };
  return { ok: false, motivo: 'catálogo commitado difere do gerado a partir das certidões' };
}

function guardsReais(dir, naoSao = NAO_SAO_GUARDS) {
  return readdirSync(dir).filter((f) => /^[a-z0-9-]+\.mjs$/.test(f) && !naoSao.includes(f)).sort();
}

/** Lê os guards do dir e devolve {entradas, semPorque}. Lança se o dir é ilegível → rodapé → exit 2. */
function coletar(dir) {
  const arquivos = guardsReais(dir);
  const entradas = [], semPorque = [];
  for (const arquivo of arquivos) {
    const resumo = resumoDaFonte(readFileSync(join(dir, arquivo), 'utf8'));
    if (!resumo) semPorque.push(arquivo);
    else entradas.push({ arquivo, resumo });
  }
  return { entradas, semPorque };
}

export function principal({ argv = process.argv.slice(2), env = process.env } = {}) {
  const dir = env.GUARDS_CATALOG_DIR || GUARDS_DIR;       // seams de teste (como RUN_SELFTESTS_DIR)
  const catalogo = env.GUARDS_CATALOG_PATH || CATALOGO_PADRAO;
  const escrever = argv.includes('--write');
  const { entradas, semPorque } = coletar(dir); // se dir ilegível → lança → rodapé → exit 2
  if (semPorque.length) {
    for (const f of semPorque) console.error(`[${NOME}] FALHA: '${f}' não tem "POR QUE EXISTE" na certidão — não entra no catálogo.`);
    console.error(`[${NOME}] COMO PASSAR: escreva a certidão de INTENÇÃO (ver governance/COMO-CRIAR-GUARD.md).`);
    return 1;
  }
  const gerado = gerarCatalogo(entradas);
  if (escrever) { writeFileSync(catalogo, gerado); console.log(`[${NOME}] catálogo regenerado (${entradas.length} guards) em ${catalogo}`); return 0; }
  let commitado = null;
  try { commitado = readFileSync(catalogo, 'utf8'); } catch { commitado = null; }
  const r = comparar(commitado, gerado);
  if (r.ok) { console.log(`[${NOME}] ✅ ${r.motivo} (${entradas.length} guards).`); return 0; }
  console.error(`[${NOME}] FALHA: ${r.motivo}${commitado === null ? ' (catálogo ausente)' : ''}.`);
  console.error(`[${NOME}] COMO PASSAR: npm run guards-catalog -- --write, e commite governance/GUARDS_CATALOG.md.`);
  console.error(`[${NOME}] POR QUE EXISTE: guard novo sem mapa, ou mapa mentindo, some da cobertura sem ninguém ver.`);
  return 1;
}

// ── fixtures da banca: guards falsos (só em árvores tmp do self-test) ──
const FAKE_A = `/**\n * POR QUE EXISTE: guarda a coisa A do incidente #1. Detalhe extra que não entra no resumo.\n */\nprocess.exitCode = 0;\n`;
const FAKE_B = `/**\n * POR QUE EXISTE (LEI X): guarda a coisa B. Segunda frase ignorada.\n */\nprocess.exitCode = 0;\n`;
const FAKE_SEM = `/**\n * Um guard sem a linha obrigatoria da certidao.\n */\nprocess.exitCode = 0;\n`;
// HOLE A: certidão SÓ no cabeçalho. Este tem "POR QUE EXISTE" apenas no fix-hint (código) → não conta.
const FAKE_STRING = `#!/usr/bin/env node\n// sem certidao de cabecalho, so o fix-hint obrigatorio no codigo\nfunction main(){\n  console.error('[x] POR QUE EXISTE: o incidente #42 quebrou a producao. resto');\n  return 1;\n}\nprocess.exitCode = main();\n`;
// HOLE C: "etc." no meio não pode cortar a frase antes do que importa.
const FAKE_ABBR = `/**\n * POR QUE EXISTE: valida o token da OTA (Booking, Airbnb, etc. e afins) e bloqueia replay de reserva.\n */\nprocess.exitCode = 0;\n`;
// HOLE 1 (2ª auditoria): pragma/licença de UMA estrela ANTES da certidão de DUAS estrelas — a certidão ainda é achada.
const FAKE_PRAGMA = `#!/usr/bin/env node\n/* eslint-disable no-console */\n/**\n * POR QUE EXISTE: incidente real #123. Este guard reprova isso.\n */\nprocess.exitCode = 0;\n`;
// HOLE 2 (2ª auditoria): banner de UMA estrela que só MENCIONA a frase não é certidão.
const FAKE_BANNER = `#!/usr/bin/env node\n/* Projeto base — banner. Todo guard precisa de um POR QUE EXISTE: veja os docs. */\nprocess.exitCode = 0;\n`;
// HOLE 3 (2ª auditoria): 1ª frase que não fecha cedo → o resumo é capado por tamanho.
const FAKE_LONGO = `/**\n * POR QUE EXISTE: ${'palavra '.repeat(40)}fim.\n */\nprocess.exitCode = 0;\n`;

function comDirDeGuards(arquivos, fn) {
  const raiz = mkdtempSync(join(tmpdir(), 'gc-'));
  try { for (const [nome, src] of Object.entries(arquivos)) writeFileSync(join(raiz, nome), src); return fn(raiz); }
  finally { rmSync(raiz, { recursive: true, force: true }); }
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const normPath = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');

  // ── RAIZ do projeto (issue #21): guards-catalog assumia dirname(dirname(GUARDS_DIR)) — só bate no
  // layout do KIT. Casos novos (dono único em ../lib/raiz-do-guard.mjs): kit (esteira.json 2 níveis
  // acima → mesma raiz de antes), bootstrapado (scripts/esteira/guards/, esteira.json mais acima →
  // acha a raiz certa) e sem esteira.json em lugar nenhum (fallback = comportamento de hoje).
  {
    const t = mkdtempSync(join(tmpdir(), 'rg-kit-'));
    try {
      writeFileSync(join(t, 'esteira.json'), '{}');
      const guardsDir = join(t, 'scripts', 'guards');
      mkdirSync(guardsDir, { recursive: true });
      check('RAIZ: layout do kit (esteira.json 2 níveis acima) → mesma raiz de antes', normPath(raizDoProjeto(guardsDir)) === normPath(dirname(dirname(guardsDir))));
    } finally { rmSync(t, { recursive: true, force: true }); }
  }
  {
    const t = mkdtempSync(join(tmpdir(), 'rg-boot-'));
    try {
      writeFileSync(join(t, 'esteira.json'), '{}');
      const guardsDir = join(t, 'app', 'scripts', 'esteira', 'guards'); // codigo="app": esteira.json bem mais acima
      mkdirSync(guardsDir, { recursive: true });
      const r = raizDoProjeto(guardsDir);
      check('RAIZ: layout bootstrapado (scripts/esteira/guards/) — acha a raiz certa via esteira.json', normPath(r) === normPath(t) && normPath(r) !== normPath(dirname(dirname(guardsDir))));
    } finally { rmSync(t, { recursive: true, force: true }); }
  }
  {
    const t = mkdtempSync(join(tmpdir(), 'rg-sem-'));
    try {
      const guardsDir = join(t, 'scripts', 'guards'); // sem esteira.json em lugar nenhum
      mkdirSync(guardsDir, { recursive: true });
      // `finder` fake força "não achei" — determinístico, não depende de %TEMP% estar livre de um
      // esteira.json perdido (medido: já não estava, na máquina do dono).
      check('RAIZ: sem esteira.json em lugar nenhum → cai no comportamento de hoje (dois níveis acima)', normPath(raizDoProjeto(guardsDir, () => null)) === normPath(dirname(dirname(guardsDir))));
    } finally { rmSync(t, { recursive: true, force: true }); }
  }

  // ── funções puras ──
  check('resumoDaFonte: pega a 1ª frase do POR QUE EXISTE', resumoDaFonte(FAKE_A) === 'guarda a coisa A do incidente #1.');
  check('resumoDaFonte: aceita o prefixo entre parênteses', resumoDaFonte(FAKE_B) === 'guarda a coisa B.');
  check('BYPASS (NULO/VAZIO): fonte sem POR QUE EXISTE → resumo vazio (nunca inventa)', resumoDaFonte(FAKE_SEM) === '' && resumoDaFonte('') === '' && resumoDaFonte(undefined) === '');
  check('BYPASS (STRING/HOLE A): "POR QUE EXISTE" só no fix-hint do CÓDIGO → não conta como certidão (resumo vazio)', resumoDaFonte(FAKE_STRING) === '');
  check('HOLE C: "etc." no meio não corta a frase — mantém até o ponto final real', resumoDaFonte(FAKE_ABBR) === 'valida o token da OTA (Booking, Airbnb, etc. e afins) e bloqueia replay de reserva.');
  check('HOLE B: comparar é insensível a EOL (CRLF commitado × LF gerado → ok)', comparar('a\r\nb\r\n', 'a\nb\n').ok === true && comparar('x\ny', 'x\nY').ok === false);
  check('BYPASS (HOLE 1 r2): pragma/licença de 1 estrela ANTES da certidão → certidão ainda achada (não falso-positivo)', resumoDaFonte(FAKE_PRAGMA) === 'incidente real #123.');
  check('BYPASS (HOLE 2 r2): banner de 1 estrela que só menciona a frase → não é certidão (resumo vazio)', resumoDaFonte(FAKE_BANNER) === '');
  check('HOLE 3 r2: resumo que não fecha cedo é capado por tamanho (≤161, termina com …)', (() => { const r = resumoDaFonte(FAKE_LONGO); return r.length <= 161 && r.endsWith('…'); })());
  check('gerarCatalogo: ordena por arquivo e conta', (() => { const c = gerarCatalogo([{ arquivo: 'z.mjs', resumo: 'z' }, { arquivo: 'a.mjs', resumo: 'a' }]); return c.indexOf('a.mjs') < c.indexOf('z.mjs') && /2 guard\(s\)/.test(c); })());
  check('comparar: idêntico → ok', comparar(gerarCatalogo([]), gerarCatalogo([])).ok === true);
  check('comparar: diferente → reprova', comparar('x\ny', gerarCatalogo([])).ok === false);
  check('comparar: commitado ausente (null) → reprova', comparar(null, gerarCatalogo([])).ok === false);
  check('BYPASS (INVISÍVEL): U+200B no commitado difere do gerado → reprova', comparar('a​', 'a').ok === false);

  // ── PORTA (issue #17): processo real, via seams de dir/catálogo em tmp ──
  const meu = fileURLToPath(import.meta.url);
  comDirDeGuards({ 'a-guard.mjs': FAKE_A, 'b-guard.mjs': FAKE_B }, (dir) => {
    const cat = join(dir, 'CAT.md');
    const porta = (args, extraEnv) => spawnSync(process.execPath, [meu, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', GUARDS_CATALOG_DIR: dir, GUARDS_CATALOG_PATH: cat, ...extraEnv } }).status;
    check('PORTA: --write gera o catálogo → exit 0', porta(['--write']) === 0);
    check('PORTA: --check logo após --write → exit 0 (bate)', porta([]) === 0);
    // corrompe o catálogo à mão → tem que reprovar
    writeFileSync(cat, readFileSync(cat, 'utf8').replace('a-guard.mjs', 'sumiu.mjs'));
    check('BYPASS (RENOMEAR/edição à mão): catálogo divergente → exit 1', porta([]) === 1);
    // catálogo ausente
    rmSync(cat, { force: true });
    check('PORTA: catálogo ausente → exit 1', porta([]) === 1);
  });
  // guard sem POR QUE EXISTE presente no dir → reprova
  comDirDeGuards({ 'a-guard.mjs': FAKE_A, 'sem-guard.mjs': FAKE_SEM }, (dir) => {
    const porta = (args, extraEnv) => spawnSync(process.execPath, [meu, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', GUARDS_CATALOG_DIR: dir, GUARDS_CATALOG_PATH: join(dir, 'CAT.md'), ...extraEnv } }).status;
    check('BYPASS (certidão): guard sem POR QUE EXISTE → exit 1 (não entra mudo no catálogo)', porta(['--write']) === 1 && porta([]) === 1);
  });
  // HOLE A no PROCESSO: guard com POR QUE EXISTE só no fix-hint do código → semPorque → exit 1
  comDirDeGuards({ 'a-guard.mjs': FAKE_A, 'string-guard.mjs': FAKE_STRING }, (dir) => {
    const porta = (args, extraEnv) => spawnSync(process.execPath, [meu, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', GUARDS_CATALOG_DIR: dir, GUARDS_CATALOG_PATH: join(dir, 'CAT.md'), ...extraEnv } }).status;
    check('BYPASS (STRING/HOLE A) no processo: certidão só no fix-hint → exit 1 (write e check)', porta(['--write']) === 1 && porta([]) === 1);
  });
  // rejeição real: dir de guards inexistente → coletar lança → rodapé → exit 2 (a lição do auditoria-vigente)
  const meuDir = mkdtempSync(join(tmpdir(), 'gc-x-'));
  try {
    const porta2 = spawnSync(process.execPath, [meu], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', GUARDS_CATALOG_DIR: join(meuDir, 'nao-existe'), GUARDS_CATALOG_PATH: join(meuDir, 'CAT.md') } }).status;
    check('PORTA: dir de guards inexistente → coletar rejeita → catch do rodapé → exit 2', porta2 === 2);
  } finally { rmSync(meuDir, { recursive: true, force: true }); }
  // (o run real na árvore do kit é o LIVE check no full-check/CI, não um caso hermético — self-test não
  //  pode depender do estado do repo: guard novo tornaria o catálogo stale e quebraria este self-test.)

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) selfTest();
  else { try { process.exitCode = principal(); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; } }
}
