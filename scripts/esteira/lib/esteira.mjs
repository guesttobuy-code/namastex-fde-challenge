/**
 * esteira.mjs — gêmea Node da Esteira.ps1: o único lugar em JS que sabe LER o esteira.json.
 * Fail-soft por desenho: quem chama decide se a ausência é erro (guard) ou silêncio (hook).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const norm = (p) => String(p ?? '').replaceAll('\\', '/');

/** Sobe a partir de `start` até achar esteira.json. Devolve a pasta (barras normais) ou null. */
export function findEsteiraRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'esteira.json'))) return norm(dir);
    const parent = dirname(dir);
    if (!parent || parent === dir) return null;
    dir = parent;
  }
}

const OBRIGATORIOS = ['projeto', 'repo', 'remote', 'branch_base', 'wt_root', 'codigo', 'coordenacao_issue'];

/**
 * Lê e valida o esteira.json. Lança Error com mensagem em português se inválido.
 * @returns {{projeto:string, repo:string, remote:string, branchBase:string, wtRoot:string, codigo:string,
 *   coordenacaoIssue:number, notebooklmId:string, labels:object|null, prefixoFrente:string,
 *   repoRoot:string, codigoRoot:string, configPath:string}}
 */
export function getEsteira(start = process.cwd()) {
  const root = findEsteiraRoot(start);
  if (!root) throw new Error(`esteira.json não encontrado subindo a partir de '${norm(start)}'. Este não é um projeto da esteira -base (ou você está fora dele).`);
  const configPath = `${root}/esteira.json`;
  let cfg;
  try { cfg = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch (e) { throw new Error(`esteira.json inválido em ${configPath}: ${e.message}`); }

  for (const c of OBRIGATORIOS) if (!(c in cfg)) throw new Error(`esteira.json sem o campo obrigatório '${c}' (${configPath})`);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(cfg.projeto)) throw new Error(`esteira.json: 'projeto' deve ser slug minúsculo (recebi '${cfg.projeto}')`);
  if (!/^[^/\s]+\/[^/\s]+$/.test(cfg.repo)) throw new Error(`esteira.json: 'repo' deve ser owner/repo (recebi '${cfg.repo}')`);
  if (!/^[A-Za-z]:\//.test(cfg.wt_root)) throw new Error(`esteira.json: 'wt_root' deve ser absoluto com barras normais (recebi '${cfg.wt_root}')`);
  // Adaptação local (2026-09-11): a checagem nominal por nome de OUTRO projeto saiu — este repositório é
  // público e não cita cliente algum. A proteção equivalente, e mais forte, é estrutural: o wt_root tem de
  // terminar no slug deste projeto (linhas abaixo), então uma pasta alheia nunca passa. Proposto ao kit.
  // issue #14 (2 rodadas): raiz de drive, `C:/./.`, `C:/Users/<eu>` etc. faziam hooks e varredor tratarem pastas
  // alheias como worktrees do projeto. Regra dura: wt_root NORMALIZADO tem ≥2 segmentos abaixo do drive E o último
  // segmento é o próprio slug do projeto (convenção C:/base-wt/<projeto>) — pasta alheia nunca termina no seu nome.
  const wtNorm = norm(resolve(cfg.wt_root)).replace(/\/+$/, '');
  const segs = wtNorm.split('/');
  if (segs.length < 3) throw new Error(`esteira.json: 'wt_root' precisa de pelo menos dois segmentos abaixo do drive, ex. C:/base-wt/<projeto> (recebi '${cfg.wt_root}')`);
  if (segs[segs.length - 1].toLowerCase() !== String(cfg.projeto).toLowerCase()) throw new Error(`esteira.json: 'wt_root' deve terminar em /${cfg.projeto} (convenção C:/base-wt/<projeto>); recebi '${cfg.wt_root}'`);
  const vaultDir = String(cfg.vault_dir ?? '');
  if (vaultDir && (!/^[A-Za-z]:\//.test(vaultDir) || norm(vaultDir).replace(/\/+$/, '').split('/').pop().toLowerCase() !== String(cfg.projeto).toLowerCase()))
    throw new Error(`esteira.json: 'vault_dir' deve ser absoluto e terminar em /${cfg.projeto} (convenção C:/base-vault/<projeto>); recebi '${vaultDir}'`);

  const labels = cfg.labels && typeof cfg.labels === 'object' ? cfg.labels : null;
  return {
    projeto: cfg.projeto,
    repo: cfg.repo,
    remote: cfg.remote,
    branchBase: cfg.branch_base,
    wtRoot: wtNorm,
    codigo: cfg.codigo,
    coordenacaoIssue: Number(cfg.coordenacao_issue) || 0,
    notebooklmId: String(cfg.notebooklm_id ?? ''),
    vaultDir: norm(cfg.vault_dir ?? '').replace(/\/+$/, ''),
    labels,
    prefixoFrente: (labels && labels.frente) || 'frente:',
    repoRoot: root,
    codigoRoot: cfg.codigo === '.' ? root : norm(resolve(root, cfg.codigo)),
    configPath,
  };
}

/** Caminho do registro de uma frente dentro de uma worktree já resolvida (raiz da worktree). */
export function registroDaFrente(cfgOuCodigoRoot, slug) {
  const codigoRoot = typeof cfgOuCodigoRoot === 'string' ? cfgOuCodigoRoot : cfgOuCodigoRoot.codigoRoot;
  return `${norm(codigoRoot)}/governance/active-work/_frentes/${slug}.md`;
}
