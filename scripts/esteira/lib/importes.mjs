/**
 * importes.mjs — DONO ÚNICO de: (1) achar/resolver os IMPORTS de um arquivo, (2) casar GLOB, (3) ler a
 * arquitetura-alvo (`.arch-layers.json`) e dizer a CAMADA/MÓDULO de um caminho.
 *
 * POR QUE EXISTE: import-boundaries e cross-module-impact precisam responder "este arquivo importa quem?"
 * e "em que camada/módulo ele está?" com o MESMO critério — em dois lugares seriam dois palpites (LEI 11).
 *
 * COMO ACHA OS IMPORTS: procura as palavras-chave (`from`, `import(`, `require(`, `import` side-effect) no
 * código DESPIDO (pra não ler um `import` que está dentro de string/comentário) e lê o ESPECIFICADOR — a
 * string — no ORIGINAL, na MESMA posição (o despir preserva comprimento). Formas: `import x from 'a'`,
 * `export … from 'a'`, `import 'a'`, `import('a')`, `require('a')`.
 *
 * LIMITE (declarado): especificador que não é string literal (`import(x + '/y')`, template com `${}`) é
 * ignorado; alias/paths de TS (`@/x`) e pacotes (`express`, `node:fs`) são EXTERNOS (não resolvidos a
 * arquivo) — só `./` e `../` resolvem. Extensão omitida é sondada (.mjs/.js/.ts/… e index.*).
 */
import { existsSync, statSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { despirCodigo } from './despir-codigo.mjs';
import { varrerArvore } from './varredura.mjs';

const EXTS = ['', '.mjs', '.js', '.ts', '.tsx', '.jsx', '.cjs', '.mts', '.cts'];
const INDEXES = ['index.mjs', 'index.js', 'index.ts', 'index.tsx', 'index.jsx'];
export const RE_EXT_CODIGO = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i;
const PULAR_SEMPRE = new Set(['node_modules', '.git']);
// Padrão NodeNext: o especificador do import aponta pro .js COMPILADO; em dev o arquivo real no disco é
// o gêmeo .ts (o TS reescreve a extensão na hora de compilar, não no source). Mapa extensão-do-import → gêmeo TS.
const GEMEOS_TS = { '.js': '.ts', '.jsx': '.tsx', '.mjs': '.mts', '.cjs': '.cts' };

/** Lê uma string literal do ORIGINAL a partir de `pos`, pulando espaço E comentário (bloco ou de linha)
 *  antes da aspa — ex.: um import com comentário entre o parêntese e a string não pode esconder o
 *  especificador. Devolve {valor, fim} ou null. */
function lerString(orig, pos) {
  let i = pos;
  for (;;) {
    while (i < orig.length && /\s/.test(orig[i])) i++;
    if (orig[i] === '/' && orig[i + 1] === '*') {
      const f = orig.indexOf('*/', i + 2);
      if (f < 0) return null; // comentário de bloco nunca fecha — sem string alcançável
      i = f + 2;
      continue;
    }
    if (orig[i] === '/' && orig[i + 1] === '/') {
      const f = orig.indexOf('\n', i + 2);
      i = f < 0 ? orig.length : f + 1;
      continue;
    }
    break;
  }
  const q = orig[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let j = i + 1, s = '';
  while (j < orig.length && orig[j] !== q) { if (orig[j] === '\\') j++; s += orig[j]; j++; }
  if (orig[j] !== q) return null;
  if (q === '`' && s.includes('${')) return null; // template com interpolação: não é literal
  return { valor: s, fim: j };
}

/** FUNÇÃO PURA: imports de um fonte → [{especificador, linha, forma}]. forma ∈ from|side-effect|dinamico|require. */
export function acharImports(fonte) {
  const orig = String(fonte ?? '');
  const desp = despirCodigo(orig);
  const linhaDe = (idx) => desp.slice(0, idx).split('\n').length;
  const achados = [];
  // CUIDADO: o match é no DESPIDO, onde a string do especificador virou ESPAÇOS — por isso o regex PARA na
  // palavra-chave/parêntese (sem `\s*` no fim, que engoliria a string apagada) e `lerString` pula o espaço
  // no ORIGINAL, onde a string está intacta.
  const push = (m, forma) => { const s = lerString(orig, m.index + m[0].length); if (s) achados.push({ especificador: s.valor, linha: linhaDe(m.index), forma }); };
  for (const m of desp.matchAll(/\bfrom\b/g)) push(m, 'from');
  for (const m of desp.matchAll(/\b(?:import|require)\s*\(/g)) push(m, m[0].startsWith('require') ? 'require' : 'dinamico');
  for (const m of desp.matchAll(/\bimport\b/g)) push(m, 'side-effect'); // só vira achado se logo após vier uma string (import x / import( / import.meta → null)
  const vistos = new Set();
  return achados.filter((a) => { const k = `${a.linha}:${a.especificador}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
}

/** Especificador relativo (`./`, `../`)? Senão é EXTERNO (pacote, `node:`, alias). */
export const ehRelativo = (esp) => esp.startsWith('./') || esp.startsWith('../');

/** Resolve `esp` (relativo) a partir do arquivo `de` (relativo à `raiz`) → caminho RELATIVO À RAIZ com "/", ou null.
 *  Além da sondagem normal de extensão, se `esp` já TERMINA em .js/.jsx/.mjs/.cjs (o padrão NodeNext — o
 *  código importa a extensão do JS COMPILADO), tenta também o GÊMEO TS (.ts/.tsx/.mts/.cts) — em dev o
 *  arquivo real no disco costuma ser o fonte TS, não o compilado. O candidato achado (e a `raiz`) são
 *  normalizados por `realpathSync.native` antes do relativo — a CAIXA real do disco no Windows (NTFS é
 *  case-insensitive mas preserva caixa; comparar por string cru erraria maiúscula/minúscula) e segue
 *  junction/symlink até o alvo real, em vez de devolver um caminho por um atalho que some do grep. */
export function resolverImport(esp, de, raiz) {
  if (!ehRelativo(esp)) return null;
  const base = resolve(dirname(resolve(raiz, de)), esp);
  const cands = [...EXTS.map((e) => base + e), ...INDEXES.map((ix) => join(base, ix))];
  for (const [jsExt, tsExt] of Object.entries(GEMEOS_TS)) {
    if (esp.endsWith(jsExt)) cands.push(base.slice(0, base.length - jsExt.length) + tsExt);
  }
  let raizReal;
  try { raizReal = realpathSync.native(raiz); } catch { raizReal = raiz; } // raiz sintética (teste) → sem realpath, cai pro caminho cru
  for (const c of cands) {
    try {
      if (!existsSync(c) || !statSync(c).isFile()) continue;
      const alvoReal = realpathSync.native(c);
      return relative(raizReal, alvoReal).split(sep).join('/');
    } catch { /* ignora-de-proposito: candidato inválido no FS */ }
  }
  return null;
}

/** Glob mínimo → RegExp. `**` = qualquer profundidade, `*` = dentro de um segmento, `?` = um char. Caminhos com "/". */
export function globParaRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export const casaGlob = (caminho, glob) => globParaRegex(glob).test(caminho);

/** Lista os arquivos de CÓDIGO sob `raiz` (relativos, com "/"), pulando node_modules/.git, `pular` (nomes),
 *  `ignorar` (globs, tanto em arquivo quanto em subpasta inteira) e qualquer SUBPASTA que é outro checkout
 *  git DE VERDADE (`.git` com `HEAD`, ou `gitdir:` apontando para um diretório com `HEAD` — worktree,
 *  submódulo) não é varrida: é outra árvore; um `.git` FALSO não esconde nada. A raiz não é afetada por
 *  essa regra mesmo tendo `.git`. DONO ÚNICO do walker: `varrerArvore` (lib/varredura.mjs) — aqui só o
 *  RECORTE de código (glob por caminho relativo, sem teto de tamanho: lista caminho, não lê conteúdo pra
 *  decidir nada além do nome — a diferença de comportamento é que um arquivo cujo CONTEÚDO ficou
 *  ilegível no meio da varredura (raro: permissão/race) agora some da lista, como já acontecia nos 6
 *  scanners que também usam este walker — antes `listarCodigo` nunca abria o arquivo, então nunca via
 *  esse erro). */
export function listarCodigo(raiz, { ignorar = [], pular = [] } = {}) {
  const pularSet = new Set([...PULAR_SEMPRE, ...pular]);
  const relDe = (caminho) => relative(raiz, caminho).split(sep).join('/');
  // `pular` aceita qualquer objeto com `.has(nome, caminho)` — um Set normal ignora o 2º argumento
  // (compatível com os scanners), aqui uso o 2º pra casar o GLOB de `ignorar` contra o caminho relativo
  // da subpasta inteira (mesma semântica de antes: `casaGlob(p, g) || casaGlob(`${p}/`, g)`).
  const pularComGlob = {
    has: (nome, caminho) => {
      if (pularSet.has(nome)) return true;
      const rel = relDe(caminho);
      return ignorar.some((g) => casaGlob(rel, g) || casaGlob(`${rel}/`, g));
    },
  };
  const { arquivos } = varrerArvore(raiz, {
    aceitar: (nome, caminho) => RE_EXT_CODIGO.test(nome) && !ignorar.some((g) => casaGlob(relDe(caminho), g)),
    pular: pularComGlob,
  });
  return arquivos.map((a) => relDe(a.caminho)).sort();
}

// ─── arquitetura-alvo (.arch-layers.json) ────────────────────────────────────
/** Lê `<raiz>/.arch-layers.json` → objeto, ou null se não existe. JSON inválido LANÇA (o guard vira NÃO MEDIU). */
export function lerArchLayers(raiz) {
  const p = join(raiz, '.arch-layers.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}
/** Nome da CAMADA de `caminho` (o primeiro cujo glob casa) ou null (fora de qualquer camada). */
export function camadaDe(caminho, cfg) {
  for (const [nome, c] of Object.entries(cfg?.camadas || {})) if ((c.globs || []).some((g) => casaGlob(caminho, g))) return nome;
  return null;
}
/** Nome do MÓDULO (pasta imediatamente sob `modulos.raiz`) ou null. */
export function moduloDe(caminho, cfg) {
  const raizMod = cfg?.modulos?.raiz; if (!raizMod) return null;
  const pref = `${raizMod.replace(/\/+$/, '')}/`;
  if (!caminho.startsWith(pref)) return null;
  return caminho.slice(pref.length).split('/')[0] || null;
}
/** `caminho` é o barrel (index.*) de um módulo? Mede só o NOME do arquivo — casa em qualquer profundidade
 *  (um `index.mjs` dentro de subpasta interna do módulo também casa aqui; ver `ehBarrelDoModulo` pra a
 *  versão que exige a POSIÇÃO exata). */
export function ehBarrel(caminho, cfg) {
  const b = cfg?.modulos?.barrel ?? INDEXES;
  return (Array.isArray(b) ? b : [b]).includes(caminho.split('/').pop());
}
/** `caminho` é o barrel DO MÓDULO — exatamente `<modulos.raiz>/<modulo>/<nome-de-barrel>`, ou seja,
 *  EXATAMENTE 2 segmentos depois de `modulos.raiz` (o nome do módulo + o arquivo). Diferente de `ehBarrel`
 *  (que casa `index.*` em qualquer profundidade): um `index.mjs` numa subpasta INTERNA do módulo
 *  (`<raiz>/<modulo>/sub/index.mjs`, 3 segmentos) NÃO é o barrel do módulo — é só um index de subpasta. */
export function ehBarrelDoModulo(caminho, cfg) {
  const raizMod = cfg?.modulos?.raiz;
  if (!raizMod) return false;
  const pref = `${raizMod.replace(/\/+$/, '')}/`;
  if (!caminho.startsWith(pref)) return false;
  const resto = caminho.slice(pref.length).split('/');
  if (resto.length !== 2) return false; // <modulo>/<nome> — exatamente 2 segmentos depois da raiz
  const b = cfg?.modulos?.barrel ?? INDEXES;
  return (Array.isArray(b) ? b : [b]).includes(resto[1]);
}
/** `caminho` está na lista `ignorar` da config? */
export const ignoradoPelaArch = (caminho, cfg) => (cfg?.ignorar || []).some((g) => casaGlob(caminho, g));
