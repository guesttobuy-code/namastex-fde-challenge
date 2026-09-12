#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: segredo commitado é o incidente que não tem "desfazer" — uma vez no histórico do
 *   git (e num repo remoto), vazou, mesmo que um commit depois o remova. Chave de nuvem, token de
 *   API, bloco de chave privada: o custo é conta invadida / dado exfiltrado. O guard varre o código
 *   ANTES do commit e no CI, e reprova alto quando acha um segredo LITERAL (não uma referência a
 *   variável de ambiente, que é o jeito certo).
 *
 * O QUE FAZ: escaneia arquivos de texto de um diretório (--dir, ou o cwd) procurando padrões de alta
 *   confiança (AWS AKIA, bloco PRIVATE KEY, token do GitHub/Slack, chave do Google) e atribuições
 *   genéricas `senha|secret|api_key|token = "<valor>"` cujo valor NÃO seja um placeholder. Pula
 *   node_modules/.git e a área `referencia/` (as minas do campo minado são violações de propósito).
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. AKIA…, `-----BEGIN … PRIVATE KEY-----`, `ghp_…`, `xox…`, `AIza…` LITERAL no código;
 *   2. `password/secret/api_key/token = "<valor real>"` embutido (em vez de `process.env`).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) segredo já no HISTÓRICO do git (só o conteúdo atual); (b) segredo
 *   de alta entropia SEM rótulo nem prefixo conhecido (base64 solto = indistinguível de dado — FP caro);
 *   (c) valor de segredo COM espaço, com cara de hash (md5/sha)/UUID, ou all-lowercase com <16 chars —
 *   o `pareceSegredo` os descarta pra não bloquear prosa/fixtures/palavra-de-dicionário (falso-negativo
 *   raro, trocado por zero-FP); (d) rótulo ambíguo fora da lista (`csrfToken`, `designToken`), `Bearer
 *   <opaco>` sem rótulo; (e) se o segredo é VÁLIDO; (f) subpasta que é outro checkout git DE VERDADE
 *   (`.git` com `HEAD`, ou `gitdir:` apontando para um diretório com `HEAD` — worktree, submódulo) não é
 *   varrida: é outra árvore; um `.git` FALSO não esconde nada.
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria: REGRA GENÉRICA quebrada nos dois lados — (H1) chave JSON
 *   `"apiKey":` não casava; (H2) rótulo embutido (`stripeSecretKey`) não casava; (H3) `ehPlaceholder`
 *   comia JWT como "ref pontilhada"; (H4) prosa sob `password:` flagrada; (H5) UUID/md5 flagrados.
 *   2ª auditoria (sobre esse conserto): (H6, FP alta) casar o rótulo como SUBSTRING solta flagrava
 *   `tokenizer`/`designToken`/`secretSanta` — agora `rotuloEhSegredo` casa palavra AMBÍGUA só inteira
 *   e uma lista curada de COMPOSTOS fortes; (H7, FN) o valor exigia letra+dígito e ≥12, perdendo
 *   segredo all-digit/all-lower-longo/11-char — o gate relaxou (≥8, sem exigir mistura; só descarta
 *   prosa/placeholder/hash/UUID/all-lower-curto).
 *
 * BANCA — as 10 classes:
 *   BANCA: BASELINE — NÃO SE APLICA: sem allowlist/baseline por arquivo; todo arquivo de texto no
 *     escopo é varrido (a única exclusão é estrutural: node_modules/.git/referencia, não por conteúdo).
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: varre por conteúdo de arquivo, não segue import/alias; o
 *     caminho vem de --dir/cwd (readdir), não de link a resolver.
 *   STRING/COMENTÁRIO/VAZIO/NULO/RENOMEAR(estrutural)/SUBSTITUIR viram casos no self-test; INVISÍVEL
 *     (U+200B dentro do próprio segredo) é falso-negativo raro e documentado — quebra o padrão literal.
 *
 * CONTRA-PROVA: node scripts/guards/secret-leak.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { varrerEDetectar } from '../lib/varredura.mjs';

const NOME = 'secret-leak';
const PULAR_DIR = new Set(['node_modules', '.git', 'referencia', '.venv', 'venv', '.uv', '__pycache__', 'site-packages']); // referencia/: minas são de propósito
const MAX_BYTES = 512 * 1024; // arquivo maior que isto é provavelmente dado/binário — pula

// Padrões de ALTA confiança (quase zero falso-positivo). `re` roda por LINHA.
const REGRAS_FORTES = Object.freeze([
  { nome: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nome: 'private-key-block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { nome: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { nome: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { nome: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
]);

// Atribuição genérica: `<identificador ou chave JSON> : | = "<valor>"`. Captura o identificador e o
// valor; a decisão fica em rotuloEhSegredo (o NOME) + pareceSegredo (o VALOR). O backref \1 casa as
// aspas do rótulo (chave JSON "apiKey": ou id nu apiKey=). /g pra pegar mais de uma atribuição por linha.
const RE_ATRIB = /(["'`]?)([A-Za-z_$][\w$-]{1,40})\1\s*[:=]\s*(["'`])([^"'`\n]+)\3/g;

// Palavras AMBÍGUAS (token/secret/pwd em inglês são palavras comuns) — só valem como IDENTIFICADOR INTEIRO.
const ROTULO_INTEIRO = new Set(['password', 'passwd', 'pwd', 'passphrase', 'secret', 'token', 'credential', 'credentials']);
// Compostos FORTES — quase sempre credencial; valem como SUBSTRING do identificador (stripeSecretKey).
const ROTULO_COMPOSTO = Object.freeze(['clientsecret', 'secretkey', 'secretaccesskey', 'privatekey', 'accesstoken', 'authtoken', 'refreshtoken', 'bearertoken', 'idtoken', 'apikey', 'apisecret', 'apitoken', 'accesskey', 'password', 'passwd', 'passphrase', 'clientkey']);

/** FUNÇÃO PURA: o NOME do identificador indica segredo? (HOLE 6 da 2ª auditoria: casar substring solta
 *  flagrava tokenizer/designToken/secretSanta — agora é palavra INTEIRA ambígua OU composto forte.) */
export function rotuloEhSegredo(id) {
  const low = String(id ?? '').toLowerCase().replace(/[_-]/g, '');
  if (ROTULO_INTEIRO.has(low)) return true;
  return ROTULO_COMPOSTO.some((c) => low.includes(c));
}

/** FUNÇÃO PURA: o valor é claramente um placeholder / referência (nunca um segredo)? */
export function ehPlaceholder(valor) {
  const v = String(valor ?? '').trim();
  if (v.length < 6) return true;
  if (/^[x*.\-_0]+$/i.test(v)) return true;                 // xxxx, ****, ----, 0000
  if (/^<.*>$/.test(v) || /\$\{.*\}/.test(v) || /^%[^%]*%$/.test(v)) return true; // <ph>, ${env}, %VAR%
  if (/(?:example|changeme|change[_-]?me|your[_-]|placeholder|dummy|sample|redacted|fake|foobar|todo|lorem)/i.test(v)) return true;
  if (/^(?:process\.env|import\.meta\.env|env|config|settings|opts|options|args)\b|\.env\b/i.test(v)) return true; // ref a env/config
  // referência pontilhada CURTA (a.b.c) — segmentos ≤15 e total ≤40, senão um JWT (eyJ….…) casaria (HOLE 3)
  if (v.length <= 40 && /^[A-Za-z_$][\w$]{0,15}(?:\.[A-Za-z_$][\w$]{0,15})+$/.test(v)) return true;
  return false;
}

/** FUNÇÃO PURA: dado que o RÓTULO já é de segredo, o VALOR é um segredo (não prosa/placeholder/hash/UUID)?
 *  Gate relaxado (HOLE 7 da 2ª auditoria: o requisito de "letra+dígito" perdia segredo all-letter/all-digit).
 *  Como o rótulo agora é preciso, o valor só precisa não ser claramente-não-segredo. */
export function pareceSegredo(valor) {
  const s = String(valor ?? '').trim();
  if (/\s/.test(s)) return false;                            // HOLE 4: prosa/frase tem espaço; segredo é contíguo
  if (s.length < 8) return false;                            // curto demais
  if (ehPlaceholder(s)) return false;                        // placeholder/env/ref (inclui HOLE 3: ref pontilhada)
  if (/^[0-9a-f]{32}$|^[0-9a-f]{40}$|^[0-9a-f]{64}$/i.test(s)) return false; // HOLE 5: md5/sha1/sha256 (hash, não segredo)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false; // HOLE 5: UUID
  if (/^[a-z]+$/.test(s) && s.length < 16) return false;     // all-lowercase curto = provável palavra (troca: perde segredo all-lower <16, evita FP de dicionário)
  return true;
}

/** FUNÇÃO PURA: acha segredos no conteúdo (por linha, com nº da linha). Sem fs, sem exit. */
export function varreduraSegredos(conteudo) {
  const achados = [];
  const linhas = String(conteudo ?? '').split('\n');
  linhas.forEach((linha, i) => {
    for (const r of REGRAS_FORTES) if (r.re.test(linha)) achados.push({ regra: r.nome, linha: i + 1 });
    for (const m of linha.matchAll(RE_ATRIB)) if (rotuloEhSegredo(m[2]) && pareceSegredo(m[4])) achados.push({ regra: 'atribuicao-secreta', linha: i + 1 });
  });
  return achados;
}

/** Percorre `dir`, lê arquivos de texto (pula binário/grande/PULAR_DIR) e acumula achados por arquivo.
 *  walker + ehBinario: DONO ÚNICO em lib/varredura.mjs (raiz sempre varrida, subpasta ilegível/PULAR_DIR/
 *  ehOutroCheckout pulada, dir raiz ilegível LANÇA → NÃO MEDIU no main; arquivo acima de MAX_BYTES é
 *  pulado calado — ignoramos `naoMedidos`, é o comportamento de sempre). Aceita QUALQUER arquivo (a
 *  decisão de "é texto" é o `ehBinario` DEPOIS de ler, não uma extensão — segredo pode estar em .env,
 *  .yml, sem extensão…). */
function escanear(dir) {
  return varrerEDetectar(dir, {
    aceitar: () => true, pular: PULAR_DIR, maxBytes: MAX_BYTES, comoBuffer: true, pularBinario: true,
    detector: (conteudo) => varreduraSegredos(conteudo.toString('utf8')),
  });
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  const dir = i >= 0 ? argv[i + 1] : cwd;
  if (i >= 0 && !argv[i + 1]) { console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`); return 2; }
  const achados = escanear(dir); // se o dir raiz for ilegível → lança → rodapé → exit 2
  if (achados.length === 0) { console.log(`[${NOME}] ✅ nenhum segredo literal em ${dir} (${REGRAS_FORTES.length + 1} padrões).`); return 0; }
  for (const a of achados) console.error(`[${NOME}] FALHA (${a.regra}): possível segredo em ${a.arquivo}:${a.linha}`);
  console.error(`[${NOME}] COMO PASSAR: tire o segredo do código e leia de process.env / secret manager; se for placeholder, use <...>/\${...}/example.`);
  console.error(`[${NOME}] POR QUE EXISTE: segredo commitado vazou — o histórico do git não esquece, mesmo removido depois.`);
  return 1;
}

// ── fixtures da banca: segredos MONTADOS por concatenação, pra NÃO existirem literais nesta fonte
//    (senão o próprio secret-leak, ao varrer scripts/, se acusaria). ──
const AWS = 'AKIA' + 'ABCD1234EFGH5678';                              // AKIA + 16 [0-9A-Z]
const GH = 'ghp_' + 'abcd1234EFGH5678ijkl9012MNOP3456qrst';           // ghp_ + 36+
const SEGREDO_REAL = 'Xk9' + 'pQ2mV7nR4tZ1wB6';                        // valor sem cara de placeholder
const PK = '-----BEGIN ' + 'PRIVATE KEY-----';
const SK = 'sk_' + 'live_51H8xYReal000SecretV9';                      // stripe-ish: misto, sem espaço
const JWT = 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'dozjgNryP4J3jVmNHl0w5N';
const KEYVAL = 'Abcd1234Efgh5678Ijkl9012';                            // key-ish, misto
// montam a linha em RUNTIME (o literal `rótulo = "valor"` não existe nesta fonte → não se auto-acusa)
const idn = (l, v) => `const ${l} = ${JSON.stringify(v)}`;
const jsonkv = (l, v) => `${JSON.stringify(l)}: ${JSON.stringify(v)}`;

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── o que NUNCA pode passar (padrões fortes) ──
  check('BYPASS: AWS AKIA → achado', varreduraSegredos(`const k = "${AWS}"`).some((a) => a.regra === 'aws-access-key'));
  check('BYPASS: bloco PRIVATE KEY → achado', varreduraSegredos(PK).some((a) => a.regra === 'private-key-block'));
  check('BYPASS: token do GitHub → achado', varreduraSegredos(`token: "${GH}"`).some((a) => a.regra === 'github-token'));
  check('BYPASS: atribuição secreta com valor real → achado', varreduraSegredos(`const senha = "${SEGREDO_REAL}"; password = "${SEGREDO_REAL}"`).some((a) => a.regra === 'atribuicao-secreta'));
  check('BYPASS: reporta o número da linha certo', (() => { const a = varreduraSegredos(`linha1\nconst k="${AWS}"`); return a[0]?.linha === 2; })());

  // ── o que NUNCA pode bloquear (família de falsos-positivos) ──
  check('NUNCA BLOQUEIA: leitura de env (process.env.X) não é segredo', varreduraSegredos('const t = process.env.GITHUB_TOKEN;').length === 0);
  check('NUNCA BLOQUEIA: atribuição = process.env não é segredo', varreduraSegredos('const password = process.env.DB_PASS;').length === 0);
  check('NUNCA BLOQUEIA: placeholder <...>/${...}/example/changeme', ['const secret = "<seu-secret>";', 'api_key = "${API_KEY}";', 'password: "changeme"', 'token = "example-token-here"', 'pwd = "xxxxxxxx"'].every((l) => varreduraSegredos(l).length === 0));
  check('NUNCA BLOQUEIA: referência pontilhada (config.token) não é literal', varreduraSegredos('const token = config.auth.token;').length === 0);
  check('NUNCA BLOQUEIA: valor curto (<6) não dispara a atribuição genérica', varreduraSegredos('pwd = "abc"').length === 0);
  check('ehPlaceholder: pega vazio/curto/<>/${}/env/pontilhado', ['', 'ab', '<x>', '${X}', 'process.env.X', 'a.b.c', 'changeme', 'xxxxxx'].every((v) => ehPlaceholder(v) === true));
  check('ehPlaceholder: NÃO trata um valor aleatório como placeholder', ehPlaceholder(SEGREDO_REAL) === false);

  // ── 2ª auditoria: buracos do rótulo/valor genérico (H1 chave JSON, H2 rótulo embutido, H3 JWT, H4 prosa, H5 hash/UUID) ──
  check('BYPASS (H1): chave JSON "apiKey": "<segredo>" → achado', varreduraSegredos(jsonkv('apiKey', KEYVAL)).some((a) => a.regra === 'atribuicao-secreta'));
  check('BYPASS (H2): rótulo embutido (stripeSecretKey) → achado', varreduraSegredos(idn('stripeSecretKey', SK)).some((a) => a.regra === 'atribuicao-secreta'));
  check('BYPASS (H3): JWT em auth_token → achado (não confundido com ref pontilhada)', varreduraSegredos(idn('auth_token', JWT)).some((a) => a.regra === 'atribuicao-secreta'));
  check('NUNCA BLOQUEIA (H4): prosa "Enter your password…" sob password → não é segredo (tem espaço)', varreduraSegredos(jsonkv('password', 'Enter your password to continue')).length === 0);
  check('NUNCA BLOQUEIA (H5): UUID e md5 sob rótulo → não flagra', varreduraSegredos(idn('secret', '550e8400-e29b-41d4-a716-446655440000')).length === 0 && varreduraSegredos(idn('apiKey', 'd41d8cd98f00b204e9800998ecf8427e')).length === 0);
  check('pareceSegredo: token misto=sim; prosa/hash/uuid/curto/ref=não', pareceSegredo(SK) === true && pareceSegredo('Enter your password') === false && pareceSegredo('d41d8cd98f00b204e9800998ecf8427e') === false && pareceSegredo('config.auth.token') === false && pareceSegredo('abc') === false);
  check('BANCA COMENTÁRIO: segredo em comentário ainda é achado (varre por linha, ignora sintaxe)', varreduraSegredos('// ' + idn('apiKey', KEYVAL)).some((a) => a.regra === 'atribuicao-secreta'));
  check('BANCA VAZIO: conteúdo vazio/undefined → nenhum achado (nunca inventa)', varreduraSegredos('').length === 0 && varreduraSegredos(undefined).length === 0);

  // ── 2ª auditoria: over-match do rótulo (H6, FP) e gate do valor estreito demais (H7, FN) ──
  check('NUNCA BLOQUEIA (H6): tokenizer/designToken/secretSanta/brokenToken/tokenizer-json → NÃO flagra', [
    idn('tokenizerModel', 'gpt2large3v2xy'), idn('designToken', 'spacing4large2md'), idn('secretSantaPick', 'alice2bob3carol'),
    idn('brokenTokenList', 'item1item2item3'), jsonkv('tokenizer', 'bert2base3uncased'), idn('retokenizeBuffer', 'chunk1chunk2xy'),
  ].every((l) => varreduraSegredos(l).length === 0));
  check('rotuloEhSegredo: palavra inteira/composto=sim; tokenizer/designToken/secretSanta=não', rotuloEhSegredo('password') && rotuloEhSegredo('apiKey') && rotuloEhSegredo('stripeSecretKey') && rotuloEhSegredo('refresh_token') && !rotuloEhSegredo('tokenizer') && !rotuloEhSegredo('designToken') && !rotuloEhSegredo('secretSanta'));
  check('BYPASS (H7): all-digit / all-lower-longo / 11-misto sob rótulo forte → achado', varreduraSegredos(idn('authToken', '839201847562903')).length > 0 && varreduraSegredos(idn('password', 'correcthorsebattery')).length > 0 && varreduraSegredos(idn('clientSecret', 'sk9Xk2pQ4mV')).length > 0);
  check('H7 troca documentada: all-lowercase CURTO (<16, palavra de dicionário) NÃO flagra', varreduraSegredos(idn('apiSecret', 'authentication')).length === 0 && pareceSegredo('authentication') === false);

  // ── PORTA (issue #17): processo real, via --dir em árvores tmp ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (dir, extraEnv = {}) => spawnSync(process.execPath, [meu, '--dir', dir], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', ...extraEnv } }).status;

  const limpo = mkdtempSync(join(tmpdir(), 'sl-limpo-'));
  const sujo = mkdtempSync(join(tmpdir(), 'sl-sujo-'));
  try {
    writeFileSync(join(limpo, 'ok.mjs'), 'export const t = process.env.TOKEN;\nconst s = "<placeholder>";\n');
    check('PORTA: --dir de árvore limpa → exit 0', porta(limpo) === 0);
    writeFileSync(join(sujo, 'vaza.mjs'), `const k = "${AWS}";\n`);
    check('PORTA: --dir de árvore com segredo → exit 1', porta(sujo) === 1);
    check('PORTA: --dir sem caminho → exit 2', spawnSync(process.execPath, [meu, '--dir'], { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } }).status === 2);
    check('PORTA: --dir inexistente → escanear rejeita → rodapé → exit 2', porta(join(sujo, 'nao-existe')) === 2);
    // BYPASS estrutural: um segredo que existe SÓ dentro de referencia/ é pulado na varredura padrão.
    const soMina = mkdtempSync(join(tmpdir(), 'sl-min-'));
    try { mkdirSync(join(soMina, 'referencia'), { recursive: true }); writeFileSync(join(soMina, 'referencia', 'm.mjs'), `const k="${AWS}";\n`);
      check('BYPASS estrutural: segredo SÓ em referencia/ é pulado na varredura padrão → exit 0', porta(soMina) === 0);
    } finally { rmSync(soMina, { recursive: true, force: true }); }
  } finally { rmSync(limpo, { recursive: true, force: true }); rmSync(sujo, { recursive: true, force: true }); }

  // ── PORTA: subpasta que é outro checkout git DE VERDADE (.git/ com HEAD) não é varrida ──
  const aninha = mkdtempSync(join(tmpdir(), 'sl-aninha-'));
  try {
    mkdirSync(join(aninha, 'sub', '.git'), { recursive: true });
    writeFileSync(join(aninha, 'sub', '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(aninha, 'sub', 'viola.mjs'), `const k = "${AWS}";\n`); // segredo DENTRO de outro checkout REAL
    check('NUNCA BLOQUEIA (checkout real): subpasta com .git/HEAD não é varrida → exit 0', porta(aninha) === 0);
    writeFileSync(join(aninha, 'viola.mjs'), `const k = "${AWS}";\n`); // o MESMO arquivo fora de sub/ (sem .git próprio) é varrido normalmente
    check('PORTA: o mesmo arquivo fora de sub/ (sem .git) é varrido normalmente → exit 1', porta(aninha) === 1);
    // BYPASS (.git falso): troca o checkout REAL por um `.git` arquivo com gitdir pro nada — não esconde nada.
    rmSync(join(aninha, 'viola.mjs'), { force: true }); // tira o segredo da raiz: o exit 1 abaixo só pode vir de dentro de sub/
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
