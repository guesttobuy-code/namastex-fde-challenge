#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: arquivo gigante é monólito que ninguém revisa de verdade — 2000 linhas escondem
 *   bug no meio, viram dono-de-tudo (um arquivo, N responsabilidades → o oposto do dono único), e o
 *   diff fica ilegível. O teto força a quebrar ANTES de virar pântano. É um teto de TAMANHO (barato,
 *   objetivo), não de complexidade.
 *
 * O QUE FAZ: escaneia arquivos de código de um diretório (--dir, ou cwd) e reprova os que passam do
 *   TETO de LINHAS VISUAIS (default 600) OU do teto de BYTES (default ~300KB — pega o monólito de 1
 *   linha que a contagem de linhas não vê). LINHA VISUAL: cada linha CRUA conta max(1, ceil(colunas /
 *   largura)) — uma linha de 161 colunas com largura 160 conta 2, não 1 (HOLE 3: juntar linhas longas
 *   não economiza teto). largura default 160. Config por diretório: `.loc-ceiling.json` ({ teto,
 *   tetoBytes, largura }); `--teto <n>` (linhas) vence a config. Pula node_modules/.git e `referencia/`
 *   (minas de propósito).
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. arquivo grande demais pra revisar — por LINHAS VISUAIS ou por BYTES (minificado/gerado) — passar
 *      batido.
 *   2. arquivo quebrado em linhas artificialmente LARGAS (muitas colunas) escapando do teto por o guard
 *      só contar `\n` — juntar linhas nunca pode ser um jeito de burlar o teto (HOLE 3).
 *   3. `largura` absurda (fora de [80, 400], ou não-inteira) no config desligando a regra nova calada —
 *      isso é NÃO MEDIU (exit 2), nunca "cai pro padrão" em silêncio.
 *
 * O QUE NUNCA PODE BLOQUEAR (falso-positivo):
 *   - arquivo dentro dos dois tetos (linhas visuais e bytes); arquivo que não é de código (só a extensão
 *     de código conta); arquivo com linhas longas mas cuja soma de linhas VISUAIS ainda cabe no teto.
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) COMPLEXIDADE — 600 linhas visuais simples passam, 100 densas passam;
 *   mede tamanho, não dificuldade; (b) conta linhas CRUAS/VISUAIS (em branco/comentário contam igual),
 *   não LOC efetivo; (c) responsabilidade demais num arquivo PEQUENO (é arquitetura/capsule); (d)
 *   arquivo numa EXTENSÃO fora do conjunto (.go/.rb/… num projeto poliglota) — o conjunto é JS/TS + ps1 +
 *   py (ADR-0004: projetos da esteira podem ser Python — contar linhas vale pra qualquer linguagem, não
 *   só a de origem do kit);
 *   (e) subpasta que é outro checkout git DE VERDADE (`.git` com `HEAD`, ou `gitdir:` apontando para um
 *   diretório com `HEAD` — worktree, submódulo) não é varrida: é outra árvore; um `.git` FALSO não
 *   esconde nada; (f) TAB conta 1 coluna (não expande pra 2/4/8) — arquivo com tabs pode ter largura
 *   visual REAL maior que a medida; limitação conhecida, não escondida; (g) `largura` é POLÍTICA DO
 *   PROJETO — mudar o número é mudança de CONFIG revisada no PR (visível no diff do
 *   `.loc-ceiling.json`), não uma decisão automática do guard.
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial: (HOLE 1, média) a certidão prometia "tamanho" mas
 *   só contava `\n` — um arquivo minificado de 1 linha e 2MB escapava do teto de 600 linhas; corrigido
 *   com o teto de BYTES. (HOLE 2) fim-de-linha `\r`-only colapsava N linhas em 1; corrigido: contarLinhas
 *   normaliza \r\n/\r/\n. (HOLE 3) 2ª rodada da auditoria fria, incidente de 2026-09-11: na rodada R2 do
 *   Núcleo de Saúde v1, 8 guards novos pousaram com 504–590 linhas CRUAS cada (abaixo do teto de 600) —
 *   mas com 35–66 linhas acima de 140 colunas cada, e uma linha de COMENTÁRIO de 1.044 colunas; quebrados
 *   em largura normal teriam 634–687 linhas. O guard só contava `\n` e aprovou: juntar linhas burlava o
 *   teto sem violar a regra escrita. Corrigido: o teto agora compara LINHAS VISUAIS (colunas/largura),
 *   não linhas cruas — `contarLinhas` continua exportada (é a métrica "cru" do relatório de falha), mas
 *   quem decide passa/reprova é `contarLinhasVisuais`.
 *
 * BANCA — as 10 classes:
 *   BANCA: BASELINE — o teto (agora de LINHAS VISUAIS), o tetoBytes e a `largura` são POLÍTICA GLOBAL
 *     (config do projeto), não allowlist por-arquivo: mexer neles muda a barra pra TODOS os arquivos de
 *     uma vez (visível no diff do `.loc-ceiling.json`), não esconde UM arquivo gordo específico. Por
 *     isso não vira "inflar baseline pra um caso". `largura` fora de [80, 400] ou não-inteira é
 *     REJEITADA (NÃO MEDIU, exit 2) — não é uma baseline que qualquer valor "passa".
 *   BANCA: STRING/COMENTÁRIO — NÃO SE APLICA: conta `\n` e colunas por CODE POINT, não casa padrão em
 *     código — comentário e string contam como qualquer outra linha, sem tratamento especial (correto).
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: lê arquivo por readdir + caminho do --dir, sem import/link.
 *   VAZIO/NULO/INVISÍVEL(uma linha com só invisível ainda é linha)/RENOMEAR/SUBSTITUIR viram casos ou
 *     são inertes (contar linha não tem como ser burlado por conteúdo — só o teto, que é política).
 *
 * CONTRA-PROVA: node scripts/guards/file-loc-ceiling.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, statSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { varrerArvore, ehBinario } from '../lib/varredura.mjs';

const NOME = 'file-loc-ceiling';
const PULAR_DIR = new Set(['node_modules', '.git', 'referencia', '.venv', 'venv', '.uv', '__pycache__', 'site-packages']);
const EXT_CODIGO = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts|ps1|py)$/;
const TETO_PADRAO = 600; // agora é teto de LINHAS VISUAIS (HOLE 3), não mais de linhas cruas.
// ~300KB: fonte escrita à mão fica MUITO abaixo; pega o monólito de 1 linha (minificado/gerado/bundle)
// que o teto de linhas não vê (HOLE 1 da auditoria). Configurável por .loc-ceiling.json { tetoBytes }.
const TETO_BYTES_PADRAO = 300 * 1024;
// largura de revisão (colunas) usada pra converter linhas cruas em VISUAIS. Configurável por
// .loc-ceiling.json { largura }, só um inteiro em [80, 400] — ver larguraValida.
const LARGURA_PADRAO = 160;

/** FUNÇÃO PURA (interna): as linhas CRUAS da fonte, já normalizadas (\r\n, \r e \n contam igual — HOLE
 *  2: \r-only não colapsa N linhas em 1). '' → []; ignora um único fim-de-linha final. Base compartilhada
 *  de contarLinhas e contarLinhasVisuais: as duas dividem a fonte do MESMO jeito, só divergem em como
 *  cada linha vale. */
function linhasCruas(fonte) {
  const s = String(fonte ?? '').replace(/\r\n?/g, '\n');
  if (s === '') return [];
  return s.replace(/\n$/, '').split('\n');
}

/** FUNÇÃO PURA: quantas linhas de conteúdo (cruas) tem a fonte. '' → 0; ignora um único fim-de-linha
 *  final. Continua exportada: é a métrica "cru" mostrada ao lado da visual no relatório de falha. */
export function contarLinhas(fonte) {
  return linhasCruas(fonte).length;
}

/** FUNÇÃO PURA (HOLE 3 — 2ª rodada da auditoria fria): quantas linhas VISUAIS a fonte ocupa numa
 *  revisão de `largura` colunas. Cada linha CRUA conta max(1, ceil(comprimento em CODE POINTS /
 *  largura)) — uma linha de 161 colunas com largura 160 conta 2, nunca 1: juntar linhas longas NUNCA
 *  economiza teto. `[...linha].length` conta CODE POINTS (não unidades UTF-16) — emoji e acento contam
 *  como 1 coluna cada, não 2. Mesma normalização de EOL de contarLinhas (mesma base, linhasCruas). */
export function contarLinhasVisuais(fonte, largura) {
  const w = Number(largura);
  return linhasCruas(fonte).reduce((soma, linha) => soma + Math.max(1, Math.ceil([...linha].length / w)), 0);
}

/** FUNÇÃO PURA: `largura` é uma política plausível? inteiro em [80, 400] (limites inclusos). Fora disso
 *  é ABSURDO (0, negativo, fração, string, um milhão) — desligaria a regra nova sem avisar. Por isso
 *  `tetoDe` trata "false" aqui como NÃO MEDIU (lança), nunca como "cai pro padrão" em silêncio. */
export function larguraValida(largura) {
  const n = Number(largura);
  return Number.isInteger(n) && n >= 80 && n <= 400;
}

/** FUNÇÃO PURA: o arquivo estoura o teto? (compara linhas VISUAIS contra o teto — o chamador decide o
 *  que passar aqui.) */
export function estouraTeto(nLinhas, teto) {
  return Number(nLinhas) > Number(teto);
}

/** Config efetiva {teto (linhas VISUAIS), tetoBytes, largura}: config do dir < --teto <n> (linhas).
 *  Config ILEGÍVEL (sem arquivo, JSON quebrado) → padrões, como sempre. `largura` PRESENTE mas INVÁLIDA
 *  (fora de [80, 400] ou não-inteira) é DIFERENTE: não cai pro padrão — lança (NÃO MEDIU no chamador,
 *  HOLE 3). Uma largura absurda desligaria a regra nova calada; melhor parar e mandar o dono consertar
 *  o config (LEI 2 — não fabrica, não segue calado). */
function tetoDe(dir, argv) {
  let teto = TETO_PADRAO, tetoBytes = TETO_BYTES_PADRAO, largura = LARGURA_PADRAO;
  let cfg = null;
  try { cfg = JSON.parse(readFileSync(join(dir, '.loc-ceiling.json'), 'utf8')); }
  catch { /* ignora-de-proposito: sem config ou config inválida (JSON quebrado/ausente) → padrões */ }
  if (cfg && typeof cfg === 'object') {
    const t = Number(cfg.teto); if (Number.isFinite(t) && t > 0) teto = t;
    const b = Number(cfg.tetoBytes); if (Number.isFinite(b) && b > 0) tetoBytes = b;
    if (cfg.largura !== undefined) {
      if (!larguraValida(cfg.largura)) {
        throw new Error(`[${NOME}] NÃO MEDIU: "largura" em .loc-ceiling.json precisa ser um inteiro em ` +
          `[80, 400] — recebeu ${JSON.stringify(cfg.largura)}.`);
      }
      largura = Number(cfg.largura);
    }
  }
  const i = argv.indexOf('--teto');
  if (i >= 0) { const n = Number(argv[i + 1]); if (Number.isFinite(n) && n > 0) teto = n; }
  return { teto, tetoBytes, largura };
}

// walker + ehBinario: DONO ÚNICO em lib/varredura.mjs. Diferença dos irmãos: aqui o arquivo acima do teto de BYTES
// NÃO é pulado calado — é o próprio ACHADO (motivo 'bytes', o monólito de 1 linha da certidão/HOLE 1).
// `varrerArvore` bota esse arquivo em `naoMedidos` (o contrato genérico do walker); este guard converte
// CADA entrada de `naoMedidos` num achado (re-stat pelo caminho — o valor não muda entre o scan e aqui,
// dentro da mesma execução síncrona; erro nessa hora é o mesmo "sumiu no meio" que qualquer outro guard já pula).
function escanear(dir, teto, tetoBytes, largura) {
  const achados = [];
  const { arquivos, naoMedidos } = varrerArvore(dir, { aceitar: (nome) => EXT_CODIGO.test(nome), pular: PULAR_DIR, maxBytes: tetoBytes, comoBuffer: true });
  for (const nm of naoMedidos) {
    let valor;
    try { valor = statSync(nm.caminho).size; } catch { continue; }
    achados.push({ arquivo: nm.caminho, motivo: 'bytes', valor, teto: tetoBytes });
  }
  for (const { caminho, conteudo } of arquivos) {
    if (ehBinario(conteudo)) continue;
    const texto = conteudo.toString('utf8');
    const cruas = contarLinhas(texto);
    const visuais = contarLinhasVisuais(texto, largura);
    if (estouraTeto(visuais, teto)) achados.push({ arquivo: caminho, motivo: 'linhas', valor: visuais, cruas, teto });
  }
  return achados;
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  if (i >= 0 && !argv[i + 1]) { console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`); return 2; }
  const dir = i >= 0 ? argv[i + 1] : cwd;
  const { teto, tetoBytes, largura } = tetoDe(dir, argv); // largura absurda no config → lança aqui → rodapé → exit 2
  const achados = escanear(dir, teto, tetoBytes, largura); // dir raiz ilegível → lança → rodapé → exit 2
  if (achados.length === 0) {
    console.log(`[${NOME}] ✅ nenhum arquivo acima do teto (${teto} linhas visuais / ` +
      `${Math.round(tetoBytes / 1024)}KB, largura ${largura}) em ${dir}.`);
    return 0;
  }
  for (const a of achados) console.error(a.motivo === 'bytes'
    ? `[${NOME}] FALHA: ${a.arquivo} tem ${a.valor} bytes (teto ${a.teto}) — grande demais pra revisar (minificado/gerado?).`
    : `[${NOME}] FALHA: ${a.arquivo} tem ${a.cruas} linhas cruas (${a.valor} visuais, teto ${a.teto} visuais, ` +
      `largura ${largura}) — quebre as linhas longas ou divida o arquivo: juntar linhas não economiza.`);
  console.error(`[${NOME}] COMO PASSAR: quebre em módulos de responsabilidade única e evite linhas longas; ` +
    `ou ajuste teto/tetoBytes/largura em .loc-ceiling.json (política global, visível no diff).`);
  console.error(`[${NOME}] POR QUE EXISTE: arquivo gigante vira monólito irreviewável — bug se esconde no meio; juntar linhas não escapa do teto.`);
  return 1;
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── funções puras ──
  check('contarLinhas: "" → 0', contarLinhas('') === 0);
  check('contarLinhas: "a" → 1', contarLinhas('a') === 1);
  check('contarLinhas: "a\\nb\\nc" → 3', contarLinhas('a\nb\nc') === 3);
  check('contarLinhas: ignora um \\n final ("a\\nb\\n" → 2)', contarLinhas('a\nb\n') === 2);
  check('estouraTeto: 601 > 600 → true; 600 > 600 (no teto) → false', estouraTeto(601, 600) === true && estouraTeto(600, 600) === false);
  check(
    'BYPASS (NULO): contagem/teto inválidos (undefined/NaN) nunca "estouram" por acaso',
    estouraTeto(undefined, 600) === false && estouraTeto('x', 600) === false,
  );
  check('BYPASS (VAZIO): arquivo vazio → 0 linhas, nunca estoura', contarLinhas('') === 0 && estouraTeto(0, 600) === false);
  check('BYPASS (INVISÍVEL): linha só com caractere invisível ainda CONTA (não some da contagem)', contarLinhas('a\n​\nb') === 3);
  check(
    'BYPASS (HOLE 2): fim-de-linha \\r-only e \\r\\n contam N linhas (não colapsam em 1)',
    contarLinhas('a\rb\rc') === 3 && contarLinhas('a\r\nb\r\nc') === 3,
  );

  // ── PORTA (issue #17): processo real, via --dir + --teto e via .loc-ceiling.json ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (args) => spawnSync(process.execPath, [meu, ...args],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '' } }).status;
  const dir = mkdtempSync(join(tmpdir(), 'loc-'));
  try {
    writeFileSync(join(dir, 'curto.mjs'), 'a\nb\nc\n');                          // 3 linhas
    writeFileSync(join(dir, 'nota.md'), Array.from({ length: 50 }, () => 'x').join('\n')); // não-código: ignorado
    check('PORTA: abaixo do teto → exit 0', porta(['--dir', dir, '--teto', '10']) === 0);
    writeFileSync(join(dir, 'gordo.mjs'), Array.from({ length: 12 }, (_, k) => `linha ${k}`).join('\n')); // 12 linhas
    check('PORTA: acima do teto (--teto 10) → exit 1', porta(['--dir', dir, '--teto', '10']) === 1);
    check('PORTA: .md (50 linhas) NÃO conta (não é código) → some do achado', (() => {
      const r = spawnSync(process.execPath, [meu, '--dir', dir, '--teto', '10'],
        { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } });
      return /gordo\.mjs/.test(r.stderr) && !/nota\.md/.test(r.stderr);
    })());
    // ADR-0004: projetos da esteira podem ser Python — .py agora CONTA como código (EXT_CODIGO).
    writeFileSync(join(dir, 'gordo.py'), Array.from({ length: 12 }, (_, k) => `linha ${k}`).join('\n')); // 12 linhas
    check('PY: .py (12 linhas) CONTA como código → reprova junto com o .mjs gordo (--teto 10)', (() => {
      const r = spawnSync(process.execPath, [meu, '--dir', dir, '--teto', '10'],
        { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } });
      return r.status === 1 && /gordo\.py/.test(r.stderr);
    })());
    rmSync(join(dir, 'gordo.py'));
    // teto via .loc-ceiling.json (política do dir), sem --teto
    writeFileSync(join(dir, '.loc-ceiling.json'), JSON.stringify({ teto: 10 }));
    check('PORTA: teto vem do .loc-ceiling.json quando não há --teto → gordo (12) reprova', porta(['--dir', dir]) === 1);
    rmSync(join(dir, 'gordo.mjs'));
    check('PORTA: sem o gordo, com config teto 10 → exit 0', porta(['--dir', dir]) === 0);
    check('PORTA: --dir sem caminho → exit 2', porta(['--dir']) === 2);
    check('PORTA: --dir inexistente → escanear rejeita → rodapé → exit 2', porta(['--dir', join(dir, 'nao-existe')]) === 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // HOLE 1: arquivo de 1 LINHA mas muitos BYTES (minificado) é pego pelo teto de bytes, não pelo de linhas.
  const dirB = mkdtempSync(join(tmpdir(), 'loc-b-'));
  try {
    writeFileSync(join(dirB, '.loc-ceiling.json'), JSON.stringify({ teto: 100000, tetoBytes: 50 })); // teto de linhas altíssimo
    writeFileSync(join(dirB, 'bigline.mjs'), `const x = "${'a'.repeat(200)}";`);                     // 1 linha, ~210 bytes
    check('BYPASS (HOLE 1): minificado de 1 linha acima do teto de BYTES → exit 1 (não escapa por ter 1 linha)', porta(['--dir', dirB]) === 1);
    writeFileSync(join(dirB, '.loc-ceiling.json'), JSON.stringify({ teto: 100000, tetoBytes: 100000 }));
    check('NUNCA BLOQUEIA: o mesmo arquivo com tetoBytes folgado → exit 0', porta(['--dir', dirB]) === 0);
  } finally { rmSync(dirB, { recursive: true, force: true }); }

  // ── PORTA: subpasta que é outro checkout git DE VERDADE (.git/ com HEAD) não é varrida ──
  const aninha = mkdtempSync(join(tmpdir(), 'loc-aninha-'));
  try {
    mkdirSync(join(aninha, 'sub', '.git'), { recursive: true });
    writeFileSync(join(aninha, 'sub', '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const gordoLinhas = Array.from({ length: 12 }, (_, k) => `linha ${k}`).join('\n'); // 12 linhas, teto 10
    writeFileSync(join(aninha, 'sub', 'gordo.mjs'), gordoLinhas); // estoura o teto DENTRO de outro checkout REAL
    check('NUNCA BLOQUEIA (checkout real): subpasta com .git/HEAD não é varrida → exit 0', porta(['--dir', aninha, '--teto', '10']) === 0);
    writeFileSync(join(aninha, 'gordo.mjs'), gordoLinhas); // o MESMO arquivo fora de sub/ (sem .git próprio) é varrido normalmente
    check('PORTA: o mesmo arquivo fora de sub/ (sem .git) é varrido normalmente → exit 1', porta(['--dir', aninha, '--teto', '10']) === 1);
    // BYPASS (.git falso): troca o checkout REAL por um `.git` arquivo com gitdir pro nada — não esconde nada.
    rmSync(join(aninha, 'gordo.mjs'), { force: true }); // tira o estouro da raiz: o exit 1 abaixo só pode vir de dentro de sub/
    rmSync(join(aninha, 'sub', '.git'), { recursive: true, force: true });
    writeFileSync(join(aninha, 'sub', '.git'), 'gitdir: nao-existe\n');
    check('BYPASS (.git falso): sub/.git com "gitdir: nao-existe" NÃO esconde a violação → exit 1', porta(['--dir', aninha, '--teto', '10']) === 1);
  } finally { rmSync(aninha, { recursive: true, force: true }); }

  // ── HOLE 3 (2ª rodada da auditoria fria, 2026-09-11): LINHAS VISUAIS — largura conta, juntar linhas
  //    não escapa do teto. Ver certidão: incidente do Núcleo de Saúde v1 (8 guards com 504–590 linhas
  //    CRUAS, abaixo do teto de 600, mas com linhas de até 1.044 colunas) ──
  check('HOLE-3: contarLinhasVisuais: linha de 160 colunas (largura 160) conta 1 (no limite exato)', contarLinhasVisuais('x'.repeat(160), 160) === 1);
  check(
    'HOLE-3: contarLinhasVisuais: linha de 161 colunas (largura 160) conta 2 (1 code point acima do limite)',
    contarLinhasVisuais('x'.repeat(161), 160) === 2,
  );
  check(
    'HOLE-3: contarLinhasVisuais: emoji e acento contam por CODE POINT, não por unidade UTF-16',
    contarLinhasVisuais('😀'.repeat(160), 160) === 1 && contarLinhasVisuais('á'.repeat(161), 160) === 2,
  );
  check('HOLE-3: contarLinhasVisuais: mesma normalização de EOL de contarLinhas (\\r-only não colapsa)', contarLinhasVisuais('a\rb\rc', 160) === 3);
  check('HOLE-3: contarLinhasVisuais: "" → 0 (mesmo BYPASS-VAZIO de contarLinhas)', contarLinhasVisuais('', 160) === 0);
  check(
    'HOLE-3: larguraValida: inteiro em [80,400] → true (limites inclusos)',
    larguraValida(80) === true && larguraValida(400) === true && larguraValida(160) === true,
  );
  check(
    'HOLE-3: BYPASS (largura absurda): fora de [80,400], não-inteira ou ausente-de-sentido → false ' +
      '(nunca "cai pro padrão" calado)',
    larguraValida(79) === false && larguraValida(401) === false && larguraValida('abc') === false &&
      larguraValida(100.5) === false && larguraValida(undefined) === false,
  );

  const dirC = mkdtempSync(join(tmpdir(), 'loc-c-'));
  try {
    // HOLE-3: o incidente real — 590 linhas CRUAS (abaixo do teto de 600) com 200 colunas cada (>160
    // colunas): a regra antiga (só \n) aprovava calado; a nova soma VISUAIS (590×2=1180) e reprova.
    writeFileSync(join(dirC, 'largo.mjs'), Array.from({ length: 590 }, () => 'x'.repeat(200)).join('\n'));
    check('HOLE-3: PORTA: 590 linhas cruas × 200 colunas (abaixo do teto de linhas CRUAS) → reprova em VISUAIS', porta(['--dir', dirC]) === 1);
    rmSync(join(dirC, 'largo.mjs'));

    // HOLE-3: 600 linhas CURTAS, no teto exato — visual == cru quando a linha é curta, então passa
    // (>600 reprova, ==600 não).
    writeFileSync(join(dirC, 'curto.mjs'), Array.from({ length: 600 }, () => 'x').join('\n'));
    check('HOLE-3: PORTA: 600 linhas curtas (no teto exato de linhas VISUAIS) → passa', porta(['--dir', dirC]) === 0);
    rmSync(join(dirC, 'curto.mjs'));

    // HOLE-3: largura fora de [80,400] ou não-inteira no config → NÃO MEDIU (exit 2) — nunca "desliga a
    // regra" calado caindo pro padrão.
    for (const larguraRuim of [79, 401, 'abc']) {
      writeFileSync(join(dirC, '.loc-ceiling.json'), JSON.stringify({ largura: larguraRuim }));
      check(`HOLE-3: PORTA: largura inválida no config (${JSON.stringify(larguraRuim)}) → NÃO MEDIU (exit 2)`, porta(['--dir', dirC]) === 2);
    }

    // HOLE-3: largura VÁLIDA e diferente do default é RESPEITADA — muda o veredito da mesma árvore.
    writeFileSync(join(dirC, '.loc-ceiling.json'), JSON.stringify({ largura: 400 }));
    writeFileSync(join(dirC, 'largo.mjs'), Array.from({ length: 590 }, () => 'x'.repeat(200)).join('\n'));
    check('HOLE-3: PORTA: largura 400 no config é respeitada — a mesma árvore de 590×200 colunas (1 visual/linha) passa', porta(['--dir', dirC]) === 0);
  } finally { rmSync(dirC, { recursive: true, force: true }); }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) selfTest();
  else { try { process.exitCode = principal(); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; } }
}
