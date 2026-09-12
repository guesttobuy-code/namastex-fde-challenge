/**
 * git-base.mjs — o que os guards de ANTI-REGRESSÃO compartilham: comparar o estado atual com a BASE.
 *
 * POR QUE EXISTE: guard-change-ritual, os ratchets (todo-debt, clean-console) e a onda 4
 * (cochange-companion, fix-recurrence, …) todos precisam de "como estava na base × como está no HEAD".
 * Um dono só pra isso (LEI 11), com o cuidado do envSemGit que o companion-red-green já pagou caro.
 *
 * CUIDADO GIT_* (medido no companion): dentro de um hook do git (pre-commit), o git exporta
 * GIT_DIR/GIT_INDEX_FILE pros filhos — sem limpar, um `git` spawnado opera no repo do hook. Todo git
 * daqui vai com env sem GIT_*.
 */
import { execFileSync } from 'node:child_process';
import { statSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';

export const envSemGit = (base = process.env) => Object.fromEntries(Object.entries(base).filter(([k]) => !/^GIT_/i.test(k)));

// `-c core.quotePath=false` em TODO git deste arquivo: sem isso, o git CITA caminho com acento/UTF-8
// acima de 0x7F como escape octal (`"a\303\247\303\243o.mjs"`) — o caminho some do parse de quem lê a
// saída esperando UTF-8 cru. Vai antes do subcomando (opção global).
const QUOTE_PATH_OFF = ['-c', 'core.quotePath=false'];

/** git que devolve stdout TRIMADO (pra refs, listas). Lança se o git falhar. */
export function git(args, cwd) {
  return execFileSync('git', [...QUOTE_PATH_OFF, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: envSemGit() }).trim();
}

/** O <arquivo> EXISTIA em <ref>? (git cat-file -e). Distingue "arquivo novo" de "git falhou". */
export function existeNaBase(ref, arquivo, cwd) {
  try { execFileSync('git', [...QUOTE_PATH_OFF, 'cat-file', '-e', `${ref}:${arquivo}`], { cwd, stdio: 'ignore', env: envSemGit() }); return true; } catch { return false; }
}

/** Conteúdo EXATO de <arquivo> em <ref>. '' se GENUINAMENTE não existia lá (arquivo novo). Se existia mas o
 *  `git show` falha (erro transitório: lock, clone raso com blob filtrado), LANÇA — nunca finge "novo" (isso
 *  seria "verde com ferramenta morta", modo #6 do COMO-CRIAR-GUARD). Caminho com "/". */
export function conteudoNaBase(ref, arquivo, cwd) {
  if (!existeNaBase(ref, arquivo, cwd)) return ''; // arquivo novo (não existia na base)
  return execFileSync('git', [...QUOTE_PATH_OFF, 'show', `${ref}:${arquivo}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: envSemGit() });
}

/** O <arquivo> está NO ÍNDICE (staged, stage 0)? (git cat-file -e :arquivo). */
function existeNoIndex(arquivo, cwd) {
  try { execFileSync('git', [...QUOTE_PATH_OFF, 'cat-file', '-e', `:${arquivo}`], { cwd, stdio: 'ignore', env: envSemGit() }); return true; } catch { return false; }
}

/** Conteúdo de <arquivo> NO ÍNDICE — o que vai ser commitado (`git show :arquivo`). '' se GENUINAMENTE
 *  não está staged. Se está staged mas o `git show` falha, LANÇA — mesma disciplina de `conteudoNaBase`
 *  (nunca finge "não estava lá" por um erro transitório). Caminho com "/". */
export function conteudoNoIndex(arquivo, cwd) {
  if (!existeNoIndex(arquivo, cwd)) return '';
  return execFileSync('git', [...QUOTE_PATH_OFF, 'show', `:${arquivo}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: envSemGit() });
}

/**
 * O `marcador` (ex.: um opt-out) foi ACRESCENTADO NESTE diff — está no que vai ser commitado (índice) E
 * NÃO estava na base. Um marcador HERDADO (já estava lá antes, ninguém tocou) NÃO conta: opt-out não é
 * "isenção pra sempre" — tem que ser uma decisão tomada AGORA, neste diff. `old` é o caminho ANTERIOR
 * num rename (de `arquivosMudados`); cai para `path` quando não há rename.
 */
export function marcadorAdicionadoNoDiff({ base, path, old, marcador, repo }) {
  const atual = conteudoNoIndex(path, repo);
  if (!atual.includes(marcador)) return false;
  const anterior = conteudoNaBase(base, old || path, repo);
  return !anterior.includes(marcador);
}

/**
 * Arquivos mudados vs a base: merge-base(base,HEAD)..HEAD + o staged (index). Devolve
 * `[{ path, old }]` — `path` é o caminho no HEAD (ou o deletado), `old` é o caminho ANTERIOR num
 * RENAME/COPY (senão null). RENAME-AWARE de propósito (`--name-status -M`): sem isso, renomear um
 * arquivo no mesmo commit esconderia deleções (o `--name-only` listaria só o caminho novo, que "não
 * existia na base" → falso "arquivo novo → isento"). Caminhos com "/".
 */
export function arquivosMudados(base, cwd, { incluirIndex = true } = {}) {
  const mb = git(['merge-base', base, 'HEAD'], cwd);
  const parse = (saida) => saida.split('\n').filter(Boolean).map((linha) => {
    const p = linha.split('\t');
    return /^[RC]/.test(p[0]) ? { path: p[2], old: p[1] } : { path: p[1], old: null };
  });
  const entradas = [...parse(git(['diff', '--no-color', '--no-ext-diff', '--name-status', '-M', `${mb}..HEAD`], cwd)),
    ...(incluirIndex ? parse(git(['diff', '--no-color', '--no-ext-diff', '--name-status', '-M', '--cached'], cwd)) : [])];
  const mapa = new Map(); // dedup por caminho do HEAD (a última entrada — index — vence)
  for (const e of entradas) mapa.set(e.path, e);
  return [...mapa.values()];
}

/**
 * Pares base/head de CADA arquivo mudado (vs `base`) que passa em `filtro(entrada)` — `entrada` é
 * `{path, old}` de `arquivosMudados`. DONO ÚNICO (LEI 11): testes-catraca, todo-debt-ratchet e
 * guard-change-ritual tinham o MESMO corpo de `medir()` a menos do filtro (regex de quais arquivos
 * julgar). Lê o HEAD do DISCO (arquivo deletado → '' — quem chama decide se isso é falha) e a BASE via
 * git (rename-aware: usa `old` quando existe, senão `path` — HOLE 1: sem isso, um rename esconderia a
 * perda). Descarta pares totalmente vazios dos dois lados (nem existia na base, nem existe no head —
 * nada pra comparar).
 */
export function paresBaseHead(base, repo, filtro) {
  const mudados = arquivosMudados(base, repo);
  const filtrados = mudados.filter(filtro);
  return filtrados.map((e) => {
    const disco = join(repo, e.path);
    const fonteHead = existsSync(disco) ? readFileSync(disco, 'utf8') : '';
    return { arquivo: e.path, fonteBase: conteudoNaBase(base, e.old || e.path, repo), fonteHead };
  }).filter((m) => m.fonteHead !== '' || m.fonteBase !== '');
}

/** A ref-base PADRÃO do projeto (remote/branch_base do esteira.json NA RAIZ de `repo` — sem subir
 *  diretório, ao contrário de `esteira.mjs#getEsteira`), ou null em QUALQUER falha (sem esteira.json,
 *  JSON quebrado, campo faltando) — fail-soft de propósito: quem chama trata null como "sem --base
 *  informado E sem projeto da esteira" (NÃO MEDIU), não uma exceção. DONO ÚNICO (LEI 11): guard-change-
 *  ritual, todo-debt-ratchet, testes-catraca, changelog-update, cross-module-impact e cochange-companion
 *  tinham a MESMA função copiada seis vezes. */
export function baseDaEsteira(repo) {
  try { const c = JSON.parse(readFileSync(join(repo, 'esteira.json'), 'utf8')); return c.remote && c.branch_base ? `${c.remote}/${c.branch_base}` : null; } catch { return null; }
}

/** Existe HEAD? (repo recém-nascido sem commit → false: não há "antes" pra comparar). */
export function temHead(cwd) {
  try { git(['rev-parse', '--verify', 'HEAD'], cwd); return true; } catch { return false; }
}

/** A ref existe? (base não fetchada → false). */
export function refExiste(ref, cwd) {
  try { git(['rev-parse', '--verify', ref], cwd); return true; } catch { return false; }
}

/** Raiz do repo (toplevel), ou null se não é repo. */
export function repoRaiz(cwd) {
  try { return git(['rev-parse', '--show-toplevel'], cwd); } catch { return null; }
}

/** A pasta é OUTRO checkout git DE VERDADE (worktree, submódulo, repo aninhado)? Pasta `.git` com `HEAD`,
 *  ou arquivo `.git` com `gitdir: <p>` onde `<p>/HEAD` existe (formato dos worktrees). Um `.git` FALSO
 *  (gitdir apontando pro nada, arquivo lixo) NÃO conta — senão um `.git` falso cegaria os scanners. */
export function ehOutroCheckout(dir) {
  const g = join(dir, '.git');
  try {
    if (statSync(g).isDirectory()) return existsSync(join(g, 'HEAD'));
    const m = readFileSync(g, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
    if (!m) return false;
    return existsSync(join(isAbsolute(m[1]) ? m[1] : resolve(dir, m[1]), 'HEAD'));
  } catch { return false; }
}
