#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: este projeto é acentuado (pt-BR) e roda em Windows com editores variados. Um arquivo
 *   salvo em Latin-1/CP1252 (em vez de UTF-8), com BOM, ou em UTF-16, corrompe acento em silêncio: o
 *   parser quebra ("Invalid or unexpected token"), o JSON.parse falha, o shebang para de funcionar, e o
 *   diff fica ilegível — e nada disso aparece no "compilou". A rede não pode deixar entrar byte que não
 *   seja UTF-8 limpo. É a higiene de encoding que todo o resto (as certidões, os docs) pressupõe.
 *
 * O QUE FAZ: varre arquivos de TEXTO (código/config/doc, por extensão) sob --dir (ou o cwd) e valida os
 *   BYTES. Reprova três defeitos, todos decidíveis só dos bytes (zero heurística): (1) sequência UTF-8
 *   INVÁLIDA — o marcador de um mis-save Latin-1/CP1252; (2) BOM (EF BB BF) num arquivo da família
 *   JS/TS/JSON, onde ele quebra shebang/import/JSON.parse; (3) byte NUL num arquivo de texto (UTF-16 ou
 *   corrupção). Pula node_modules/.git e a área referencia/ (as minas são de propósito) e binários por extensão.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. byte que não forma UTF-8 válido (arquivo salvo em Latin-1/CP1252/ISO-8859);
 *   2. BOM em arquivo .mjs/.cjs/.js/.jsx/.ts/.tsx/.mts/.cts/.json (quebra shebang/import/JSON.parse);
 *   3. byte NUL num arquivo de extensão de texto (conteúdo binário/UTF-16 se passando por texto).
 *
 * O QUE NUNCA PODE BLOQUEAR (família de falsos-positivos):
 *   - UTF-8 válido multibyte: acento (á é ç ã õ), travessão (—), aspas curvas, emoji (✅ 𝕏) — tudo passa;
 *   - BOM em .md/.ps1/.yml/.txt — tolerado nesses (PowerShell até prefere BOM); só a família JS/JSON reprova;
 *   - arquivo binário por extensão (.png/.pdf/.lock…) — fora do escopo, não é lido.
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) MOJIBAKE — bytes que SÃO UTF-8 válido mas semanticamente corrompidos
 *   (ex.: "certidao" virar "certidÃ£o"): é UTF-8 válido, exige conhecimento de idioma/conteúdo pra
 *   distinguir de um nome estrangeiro legítimo; o check (1) pega o mis-save que normalmente CRIA mojibake na
 *   hora de escrever, mas não o que já está gravado — mojibake fica pro auditor/olho humano; (b) normalização
 *   Unicode (NFC vs NFD: "á" como 1 code point ou "a"+combining) — dois "iguais" com bytes diferentes; (c)
 *   fim-de-linha CRLF vs LF — é de .gitattributes/editorconfig, não de encoding; (d) UTF-16 SEM byte NUL
 *   (raríssimo) escaparia — na prática UTF-16 tem NUL e cai no check (3); (e) ESCOPO por allowlist: só valida
 *   extensões de EXT_TEXTO + basenames conhecidos (LICENSE, Dockerfile, Makefile…). Um arquivo de texto com
 *   extensão fora da lista e sem basename conhecido NÃO é validado — adicione a extensão à lista (é allowlist
 *   de ESCOPO/"o que é texto", NÃO de perdão: dentro do escopo, nada é isento); (f) arquivo ACIMA do teto de
 *   tamanho (default 64 MB) NÃO é validado, mas também NÃO passa calado: vira NÃO MEDIU (exit 2), nunca "✅";
 *   (g) subpasta que é outro checkout git DE VERDADE (`.git` com `HEAD`, ou `gitdir:` apontando para um
 *   diretório com `HEAD` — worktree, submódulo) não é varrida: é outra árvore; um `.git` FALSO não esconde nada.
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial (onda 2) — o núcleo (validador UTF-8) foi provado EXATO
 *   (0 divergências vs TextDecoder fatal em ~4M buffers). Dois falsos-negativos de ESCOPO não-declarados:
 *   (TE-01, média) o teto de 8 MB pulava arquivo grande em silêncio e ainda dizia "✅ limpo" — agora o teto é
 *   64 MB e acima dele é NÃO MEDIU (exit 2, doutrina "não mediu → erra alto, nunca 0"), testado; (TE-02, média)
 *   arquivo sem extensão / de extensão fora da lista escapava sem aviso e a linha BANCA:BASELINE ("sem
 *   allowlist") era enganosa — escopo ampliado (mais extensões + basenames) e o corte declarado em (e)/BASELINE.
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — NÃO SE APLICA: opera sobre os BYTES do arquivo, não sobre tokens de código —
 *     não há string/comentário a despir. Um exemplo de byte ruim citado NESTA fonte é MONTADO por Buffer nas
 *     fixtures (nunca um byte inválido literal), então este arquivo não se auto-acusa quando varre a si mesmo.
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: descobre arquivos por readdir a partir de --dir/cwd; não segue import/link.
 *   BANCA: BASELINE/ALLOWLIST — TRATADA: EXT_TEXTO/BASENAME_TEXTO é allowlist de ESCOPO (define o que é
 *     "texto a validar"), NÃO uma allowlist de PERDÃO/baseline — dentro do escopo nada é isento nem herda
 *     "estado anterior". O corte de escopo (extensão fora da lista) é falso-NEGATIVO declarado em (e), não
 *     uma exceção que afrouxa a medição.
 *   BANCA: INVISÍVEL/RENOMEAR — TRATADA: um byte invisível/ilegal É exatamente o alvo → vira achado, não escape.
 *   BANCA: VAZIO/NULO — TRATADA: arquivo vazio → 0 (UTF-8 válido trivial); byte NUL → achado (check 3).
 *   SUBSTITUIR: o defeito é do byte, não de um símbolo mockável.
 *
 * CONTRA-PROVA: node scripts/guards/text-encoding.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { varrerEDetectar } from '../lib/varredura.mjs';

const NOME = 'text-encoding';
const PULAR_DIR = new Set(['node_modules', '.git', 'referencia', '.venv', 'venv', '.uv', '__pycache__', 'site-packages']);
// Teto de tamanho: acima dele o arquivo NÃO é validado, mas vira NÃO MEDIU (exit 2), nunca "✅" calado
// (TE-01 da auditoria). 64 MB cobre qualquer fonte/config/doc real; injetável pra o self-test exercitar a porta.
const MAX_BYTES = Number(process.env.TEXTENC_MAX_BYTES) || 64 * 1024 * 1024;
// Extensões que DEVEM ser UTF-8 (código, config, doc, dados-texto). Allowlist de ESCOPO ("o que é texto"),
// não de perdão. Fora daqui (e sem basename conhecido) não é lido — falso-negativo declarado (O QUE NÃO VÊ (e)).
const EXT_TEXTO = new Set([
  'mjs', 'cjs', 'js', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'json', 'jsonc', 'json5', // JS/TS/JSON
  'md', 'markdown', 'mdx', 'txt', 'rst', 'adoc', // doc
  'yml', 'yaml', 'toml', 'ini', 'env', 'xml', 'svg', 'html', 'htm', 'css', 'scss', 'less', 'vue', 'svelte', // config/markup/estilo
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'php', 'swift', 'lua', 'pl', // outras linguagens
  'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', // scripts
  'sql', 'graphql', 'gql', 'proto', // schema/query
  'csv', 'tsv', 'properties', 'conf', 'cfg', 'lock', 'gradle', 'dockerignore', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc', // dados/config extras
]);
// Arquivos de TEXTO sem extensão (ou de nome canônico): entram por BASENAME. Cobre o caso pt-BR realista de
// um LICENSE/AUTHORS com "José" salvo em CP1252 (TE-02 da auditoria).
const BASENAME_TEXTO = new Set([
  'LICENSE', 'LICENCE', 'COPYING', 'NOTICE', 'AUTHORS', 'CONTRIBUTORS', 'PATENTS', 'CODEOWNERS',
  'README', 'CHANGELOG', 'CHANGES', 'HISTORY', 'TODO', 'Dockerfile', 'Makefile', 'Procfile', 'Vagrantfile', 'Brewfile', 'Gemfile', 'Rakefile',
  '.gitignore', '.gitattributes', '.dockerignore', '.editorconfig', '.npmrc', '.nvmrc', '.env', '.prettierrc', '.eslintrc', '.babelrc',
]);
// Extensões onde o BOM é DEFEITO (quebra shebang/import/JSON.parse). Em .md/.ps1/.yml o BOM é tolerado.
const EXT_BOM_PROIBIDO = new Set(['mjs', 'cjs', 'js', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'json', 'jsonc', 'json5']);

/** FUNÇÃO PURA: um caminho/nome está no ESCOPO de "arquivo de texto a validar"? (extensão OU basename conhecido). */
export function ehArquivoDeTexto(nome) {
  const base = String(nome || '').split(/[\\/]/).pop();
  if (BASENAME_TEXTO.has(base)) return true;
  const e = extname(base).replace(/^\./, '').toLowerCase();
  return EXT_TEXTO.has(e);
}

const ehBOM = (buf) => buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;

/**
 * FUNÇÃO PURA: offset do primeiro byte que NÃO forma UTF-8 válido, ou -1 se tudo válido. Pula o BOM
 * inicial (o BOM é reportado à parte por `ehBOM`, não é "inválido"). Rejeita: continuação solta,
 * overlong (C0/C1, E0<A0, F0<90), surrogate (ED>9F), fora do range (F5-FF, F4>8F) e truncado.
 */
export function primeiroByteInvalidoUtf8(buf) {
  const n = buf.length;
  let i = ehBOM(buf) ? 3 : 0;
  while (i < n) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; } // ASCII
    let extra;
    if (b >= 0xC2 && b <= 0xDF) extra = 1;      // 2 bytes (C0/C1 = overlong → cai no else)
    else if (b >= 0xE0 && b <= 0xEF) extra = 2; // 3 bytes
    else if (b >= 0xF0 && b <= 0xF4) extra = 3; // 4 bytes (até U+10FFFF)
    else return i;                              // 80-BF solto, C0/C1, F5-FF
    if (i + extra >= n) return i;               // truncado no fim do buffer
    const b1 = buf[i + 1];
    // faixas do 2º byte (overlong/surrogate/range) — antes de aceitar as continuações genéricas
    if (b === 0xE0 && b1 < 0xA0) return i;       // overlong 3-byte
    if (b === 0xED && b1 > 0x9F) return i;       // surrogate D800-DFFF
    if (b === 0xF0 && b1 < 0x90) return i;       // overlong 4-byte
    if (b === 0xF4 && b1 > 0x8F) return i;       // > U+10FFFF
    for (let k = 1; k <= extra; k++) {
      const c = buf[i + k];
      if (c < 0x80 || c > 0xBF) return i + k;    // continuação inválida
    }
    i += extra + 1;
  }
  return -1;
}

/** FUNÇÃO PURA: offset do primeiro byte NUL (0x00), ou -1. */
export function primeiroNul(buf) {
  for (let i = 0; i < buf.length; i++) if (buf[i] === 0) return i;
  return -1;
}

/** FUNÇÃO PURA: nº da linha (1-based) do byte em `offset` — conta os 0x0A antes dele. */
export function linhaDoOffset(buf, offset) {
  let linha = 1;
  const ate = Math.min(offset, buf.length);
  for (let i = 0; i < ate; i++) if (buf[i] === 0x0A) linha++;
  return linha;
}

/** FUNÇÃO PURA: defeitos de encoding de UM arquivo (por NOME p/ escopo + bytes). Sem fs, sem exit. */
export function analisar(nome, buf) {
  if (!ehArquivoDeTexto(nome)) return []; // fora do escopo (binário/desconhecido/extensão não listada)
  const base = String(nome || '').split(/[\\/]/).pop();
  const e = extname(base).replace(/^\./, '').toLowerCase();
  const achados = [];
  const nul = primeiroNul(buf);
  if (nul >= 0) { achados.push({ tipo: 'byte-nul', linha: linhaDoOffset(buf, nul) }); return achados; } // binário/UTF-16: um defeito só basta
  if (EXT_BOM_PROIBIDO.has(e) && ehBOM(buf)) achados.push({ tipo: 'bom', linha: 1 });
  const inv = primeiroByteInvalidoUtf8(buf);
  if (inv >= 0) achados.push({ tipo: 'utf8-invalido', linha: linhaDoOffset(buf, inv) });
  return achados;
}

const EXPLICA = {
  'byte-nul': 'byte NUL (00) — conteúdo binário/UTF-16 se passando por texto',
  'bom': 'BOM (EF BB BF) no início — quebra shebang/import/JSON.parse',
  'utf8-invalido': 'byte que não forma UTF-8 válido — arquivo salvo em Latin-1/CP1252?',
};

// walker: DONO ÚNICO em lib/varredura.mjs. Diferente dos irmãos: aqui `naoMedidos` NÃO é ignorado — é o
// TE-01 (arquivo acima do teto não pode sumir calado) e o `principal` abaixo o transforma em NÃO MEDIU
// (exit 2), nunca em "✅" silencioso.
function escanear(dir) {
  return varrerEDetectar(dir, {
    aceitar: (nome) => ehArquivoDeTexto(nome), pular: PULAR_DIR, maxBytes: MAX_BYTES,
    comoBuffer: true, incluirNaoMedidos: true,
    // `analisar` já reduz `nome` ao basename por dentro — pode receber o caminho completo direto.
    detector: (conteudo, caminho) => analisar(caminho, conteudo),
  });
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  if (i >= 0 && !argv[i + 1]) { console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`); return 2; }
  const dir = i >= 0 ? argv[i + 1] : cwd;
  const { achados, naoMedidos } = escanear(dir); // dir raiz ilegível → lança → rodapé → exit 2
  if (achados.length) { // defeito achado vence: reprova (1). Arquivos não medidos viram aviso ao lado.
    for (const a of achados) console.error(`[${NOME}] FALHA (${a.tipo}): ${a.arquivo}:${a.linha} — ${EXPLICA[a.tipo]}`);
    for (const nm of naoMedidos) console.error(`[${NOME}] AVISO (não medido): ${nm.arquivo} — ${nm.motivo}`);
    console.error(`[${NOME}] COMO PASSAR: re-salve o arquivo em UTF-8 SEM BOM (VS Code: "Save with Encoding" → "UTF-8"; PowerShell: Set-Content -Encoding utf8NoBOM). Acento e emoji em UTF-8 válido passam de boa.`);
    console.error(`[${NOME}] POR QUE EXISTE: byte fora de UTF-8 corrompe acento em silêncio — o parser quebra e o diff fica ilegível.`);
    return 1;
  }
  if (naoMedidos.length) { // nada errado no que li, mas não li tudo → NÃO afirmo "limpo" (doutrina: erra alto, nunca 0)
    for (const nm of naoMedidos) console.error(`[${NOME}] NÃO MEDIU: ${nm.arquivo} — ${nm.motivo}. Não posso afirmar "UTF-8 limpo" sobre um arquivo que não li.`);
    console.error(`[${NOME}] COMO PASSAR: valide o encoding desse arquivo por fora, ou reduza-o abaixo do teto (env TEXTENC_MAX_BYTES ajusta o teto).`);
    return 2;
  }
  console.log(`[${NOME}] ✅ nenhum defeito de encoding em ${dir} (UTF-8 limpo).`);
  return 0;
}

// ── fixtures: bytes ruins são MONTADOS por Buffer (nunca literais nesta fonte, senão o guard se auto-acusa) ──
const utf8 = (s) => Buffer.from(s, 'utf8');
const BOM = Buffer.from([0xEF, 0xBB, 0xBF]);
const comBOM = (s) => Buffer.concat([BOM, utf8(s)]);
const LATIN1_E_ACUTE = 0xE9;        // 'é' em Latin-1 (byte solto → inválido em UTF-8)
const CP1252_ASPA = 0x93;           // aspa curva esquerda em CP1252 (continuação solta em UTF-8)

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── primeiroByteInvalidoUtf8: aceita UTF-8 válido, rejeita mis-saves ──
  check('UTF-8 válido: ASCII → -1', primeiroByteInvalidoUtf8(utf8('const x = 1;\n')) === -1);
  check('UTF-8 válido: acentos/travessão/emoji (á é ç — ✅ 𝕏) → -1', primeiroByteInvalidoUtf8(utf8('café — açaí ✅ 𝕏 São João')) === -1);
  check('INVÁLIDO: byte Latin-1 é (0xE9) solto → achado no offset', primeiroByteInvalidoUtf8(Buffer.from([0x63, 0x61, 0x66, LATIN1_E_ACUTE, 0x0A])) === 3);
  check('INVÁLIDO: continuação solta (CP1252 0x93) → achado', primeiroByteInvalidoUtf8(Buffer.from([0x6F, 0x69, CP1252_ASPA])) === 2);
  check('INVÁLIDO: overlong C0 80 → achado no início', primeiroByteInvalidoUtf8(Buffer.from([0xC0, 0x80])) === 0);
  check('INVÁLIDO: surrogate ED A0 80 → achado no início', primeiroByteInvalidoUtf8(Buffer.from([0xED, 0xA0, 0x80])) === 0);
  check('INVÁLIDO: lead 4-byte fora do range (F5) → achado', primeiroByteInvalidoUtf8(Buffer.from([0xF5, 0x80, 0x80, 0x80])) === 0);
  check('INVÁLIDO: multibyte truncado no fim (E2 sozinho) → achado', primeiroByteInvalidoUtf8(Buffer.from([0x61, 0xE2])) === 1);
  check('BOM não é "inválido": BOM + ASCII válido → -1 (o BOM é reportado à parte)', primeiroByteInvalidoUtf8(comBOM('const x = 1;')) === -1);
  check('VAZIO: buffer vazio → -1', primeiroByteInvalidoUtf8(Buffer.alloc(0)) === -1);

  // ── ehBOM / primeiroNul / linhaDoOffset ──
  check('ehBOM: com BOM → true; sem → false', ehBOM(comBOM('x')) === true && ehBOM(utf8('x')) === false);
  check('primeiroNul: acha o NUL; sem NUL → -1', primeiroNul(Buffer.from([0x61, 0x00, 0x62])) === 1 && primeiroNul(utf8('abc')) === -1);
  check('linhaDoOffset: conta as quebras de linha', linhaDoOffset(utf8('a\nb\nX'), 4) === 3);

  // ── ehArquivoDeTexto: escopo por extensão OU basename (TE-02) ──
  check('ehArquivoDeTexto: extensão listada (a.mjs) e basename conhecido (LICENSE, Dockerfile) → true', ehArquivoDeTexto('src/a.mjs') && ehArquivoDeTexto('LICENSE') && ehArquivoDeTexto('deploy/Dockerfile') && ehArquivoDeTexto('.gitignore'));
  check('ehArquivoDeTexto: extensões que o TE-02 pegou (.py .sql .vue .mdx .csv) → true', ['a.py', 'q.sql', 'C.vue', 'doc.mdx', 'dados.csv'].every((n) => ehArquivoDeTexto(n)));
  check('ehArquivoDeTexto: binário (.png) e extensão fora da lista (.xyz) e nome qualquer → false', !ehArquivoDeTexto('img.png') && !ehArquivoDeTexto('a.xyz') && !ehArquivoDeTexto('coisa'));

  // ── analisar: por NOME (escopo) + bytes ──
  check('NUNCA BLOQUEIA: .mjs UTF-8 válido acentuado → 0 achados', analisar('a.mjs', utf8('// ação: valida input\nconst nome = "João";\n')).length === 0);
  check('BYPASS: .mjs com byte Latin-1 solto → utf8-invalido', analisar('a.mjs', Buffer.concat([utf8('const s = "caf'), Buffer.from([LATIN1_E_ACUTE]), utf8('";\n')])).some((a) => a.tipo === 'utf8-invalido'));
  check('BYPASS: .mjs com BOM → bom', analisar('a.mjs', comBOM('const x = 1;\n')).some((a) => a.tipo === 'bom'));
  check('NUNCA BLOQUEIA: .md com BOM → 0 (BOM tolerado fora da família JS/JSON)', analisar('r.md', comBOM('# título\n')).length === 0);
  check('BYPASS: .md com byte inválido AINDA reprova (UTF-8 vale em toda extensão de texto)', analisar('r.md', Buffer.concat([utf8('# t'), Buffer.from([LATIN1_E_ACUTE])])).some((a) => a.tipo === 'utf8-invalido'));
  check('BYPASS: .json com byte NUL → byte-nul', analisar('p.json', Buffer.from([0x7B, 0x00, 0x7D])).some((a) => a.tipo === 'byte-nul'));
  check('BYPASS (TE-02): LICENSE sem extensão com byte Latin-1 → utf8-invalido (entra por basename)', analisar('LICENSE', Buffer.concat([utf8('Copyright Jos'), Buffer.from([LATIN1_E_ACUTE])])).some((a) => a.tipo === 'utf8-invalido'));
  check('BYPASS (TE-02): .py com byte Latin-1 → utf8-invalido (extensão de código ampliada)', analisar('s.py', Buffer.concat([utf8('# a'), Buffer.from([LATIN1_E_ACUTE])])).some((a) => a.tipo === 'utf8-invalido'));
  check('FORA DO ESCOPO: extensão binária (.png) → 0 (não é lida como texto)', analisar('i.png', Buffer.from([LATIN1_E_ACUTE, 0x00, 0x93])).length === 0);
  check('FORA DO ESCOPO (TE-02 declarado): extensão não listada (.xyz) com defeito → 0 (limite conhecido)', analisar('a.xyz', Buffer.from([LATIN1_E_ACUTE])).length === 0);
  check('reporta a linha do byte inválido', analisar('a.mjs', Buffer.concat([utf8('linha1\nlinha2\n'), Buffer.from([LATIN1_E_ACUTE])]))[0]?.linha === 3);

  // ── PORTA (issue #17): processo real, via --dir em árvores tmp ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (dir) => spawnSync(process.execPath, [meu, '--dir', dir], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '' } }).status;
  const limpo = mkdtempSync(join(tmpdir(), 'te-limpo-'));
  const sujo = mkdtempSync(join(tmpdir(), 'te-sujo-'));
  try {
    writeFileSync(join(limpo, 'ok.mjs'), utf8('// ação e coração em UTF-8 válido ✅\nexport const x = 1;\n'));
    writeFileSync(join(limpo, 'nota.png'), Buffer.from([LATIN1_E_ACUTE, 0x00])); // binário por extensão: ignorado
    check('PORTA: --dir de árvore limpa (UTF-8 válido, .png ignorado) → exit 0', porta(limpo) === 0);
    writeFileSync(join(sujo, 'mau.mjs'), Buffer.concat([utf8('const s = "caf'), Buffer.from([LATIN1_E_ACUTE]), utf8('";\n')]));
    check('PORTA: --dir com byte Latin-1 solto → exit 1', porta(sujo) === 1);
    check('PORTA: --dir sem caminho → exit 2', spawnSync(process.execPath, [meu, '--dir'], { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } }).status === 2);
    check('PORTA: --dir inexistente → escanear rejeita → rodapé → exit 2', porta(join(sujo, 'nao-existe')) === 2);
  } finally { rmSync(limpo, { recursive: true, force: true }); rmSync(sujo, { recursive: true, force: true }); }

  // ── PORTA TE-01: arquivo acima do teto NÃO passa calado — vira NÃO MEDIU (exit 2), nunca "✅". Teto injetável. ──
  const grande = mkdtempSync(join(tmpdir(), 'te-teto-'));
  try {
    writeFileSync(join(grande, 'grande.mjs'), utf8('// arquivo de texto VÁLIDO, porém acima do teto injetado no self-test\nexport const x = 1;\n'));
    const portaTeto = (env) => spawnSync(process.execPath, [meu, '--dir', grande], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', ...env } }).status;
    check('PORTA (TE-01): arquivo acima do teto → NÃO MEDIU exit 2 (nunca ✅ calado)', portaTeto({ TEXTENC_MAX_BYTES: '8' }) === 2);
    check('PORTA (TE-01): o MESMO arquivo, teto padrão → exit 0 (o tamanho é a única causa)', portaTeto({ TEXTENC_MAX_BYTES: '' }) === 0);
  } finally { rmSync(grande, { recursive: true, force: true }); }

  // ── PORTA: subpasta que é outro checkout git DE VERDADE (.git/ com HEAD) não é varrida ──
  const aninha = mkdtempSync(join(tmpdir(), 'te-aninha-'));
  try {
    mkdirSync(join(aninha, 'sub', '.git'), { recursive: true });
    writeFileSync(join(aninha, 'sub', '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const mau = Buffer.concat([utf8('const s = "caf'), Buffer.from([LATIN1_E_ACUTE]), utf8('";\n')]);
    writeFileSync(join(aninha, 'sub', 'mau.mjs'), mau); // byte Latin-1 solto DENTRO de outro checkout REAL
    check('NUNCA BLOQUEIA (checkout real): subpasta com .git/HEAD não é varrida → exit 0', porta(aninha) === 0);
    writeFileSync(join(aninha, 'mau.mjs'), mau); // o MESMO arquivo fora de sub/ (sem .git próprio) é varrido normalmente
    check('PORTA: o mesmo arquivo fora de sub/ (sem .git) é varrido normalmente → exit 1', porta(aninha) === 1);
    // BYPASS (.git falso): troca o checkout REAL por um `.git` arquivo com gitdir pro nada — não esconde nada.
    rmSync(join(aninha, 'mau.mjs'), { force: true }); // tira o defeito da raiz: o exit 1 abaixo só pode vir de dentro de sub/
    rmSync(join(aninha, 'sub', '.git'), { recursive: true, force: true });
    writeFileSync(join(aninha, 'sub', '.git'), 'gitdir: nao-existe\n');
    check('BYPASS (.git falso): sub/.git com "gitdir: nao-existe" NÃO esconde a violação → exit 1', porta(aninha) === 1);
  } finally { rmSync(aninha, { recursive: true, force: true }); }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) selfTest();
  else { try { process.exitCode = principal(); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; } }
}
