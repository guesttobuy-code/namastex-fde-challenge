/**
 * frente-registro.mjs — DONO ÚNICO da leitura e da escrita byte a byte do frontmatter de
 * `governance/active-work/_frentes/<slug>.md`.
 *
 * O registro nasce com BOM UTF-8 (e CRLF quando o git assim decidir). Toda escrita aqui troca
 * SÓ o valor de uma linha, preservando BOM e fim-de-linha; nenhum valor já preenchido é
 * sobrescrito. As funções puras (que não tocam disco) existem para o self-test dos guards
 * bombardear. Portado da esteira de origem (2026-09-05); a lógica é a mesma, o dono é este.
 *
 * Quem consome: o hook global `base-frente-check.mjs` (chat_id), o `frente-sessao-app.mjs`
 * (app_session_id/session_title), o `/ligar-frente-base` (github_frente) e os guards.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Alfabeto seguro para YAML entre aspas: id com aspas, newline, `:` ou `#` NUNCA chega ao disco. */
export function sanitizeSessionId(id) {
  if (typeof id !== 'string') return null;
  return /^[A-Za-z0-9._-]{1,128}$/.test(id) ? id : null;
}

/** Título de sessão para caber numa string YAML: sem controle, `"`→`'`, `\`→`/`, 120 chars. */
export function sanitizeTituloSessao(v) {
  if (typeof v !== 'string') return null;
  const limpo = v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/"/g, "'").replace(/\\/g, '/')
    .replace(/\s+/g, ' ').trim().slice(0, 120).trim();
  return limpo === '' ? null : limpo;
}

/** Label de frente: `frente:<slug>` e variantes com prefixo configurável. */
export function sanitizeLabelFrente(v) {
  if (typeof v !== 'string') return null;
  return /^[a-z0-9][a-z0-9._:-]{0,99}$/.test(v) ? v : null;
}

export const caminhoSessionIdFile = (gitDir) => join(gitDir, 'claude-session-id');

export function gravarSessionId(gitDir, sessionId) {
  const limpo = sanitizeSessionId(sessionId);
  if (!limpo || !gitDir) return false;
  try { writeFileSync(caminhoSessionIdFile(gitDir), limpo, 'utf-8'); return true; } catch { return false; }
}

export function lerSessionId(gitDir) {
  if (!gitDir) return null;
  try { return sanitizeSessionId(readFileSync(caminhoSessionIdFile(gitDir), 'utf-8').trim()); } catch { return null; }
}

const CAMPO_VALIDO = /^[a-z][a-z0-9_]*$/;
const semBom = (t) => String(t ?? '').replace(/^\uFEFF/, '');

/** Valor de um campo do frontmatter (trimmed, possivelmente ''), ou null se a linha não existe. */
export function lerCampoDeTexto(texto, campo) {
  if (!CAMPO_VALIDO.test(String(campo ?? ''))) return null;
  const m = new RegExp(`^${campo}:\\s*"?([^"\\n]*)"?\\s*$`, 'm').exec(semBom(texto));
  return m ? m[1].trim() : null;
}

/** Linha (1-based) do campo, para o guard citar arquivo:linha. */
export function linhaDoCampo(texto, campo) {
  if (!CAMPO_VALIDO.test(String(campo ?? ''))) return null;
  const re = new RegExp(`^${campo}:`);
  const linhas = semBom(texto).split('\n');
  for (let i = 0; i < linhas.length; i += 1) if (re.test(linhas[i])) return i + 1;
  return null;
}

/**
 * FUNÇÃO PURA. Regras, nesta ordem:
 *   campo inválido → 'campo-invalido' · valor atual não-vazio → 'ja-preenchido' (NUNCA sobrescreve)
 *   valor novo inválido → 'valor-invalido' · linha existe vazia → 'preenchido'
 *   linha não existe + âncora → 'inserido' (logo DEPOIS da âncora) · sem âncora → 'sem-campo' · âncora ausente → 'sem-ancora'
 * Preserva BOM e o `\r` da própria linha.
 */
export function preencherCampoEmTexto(texto, campo, valor, opcoes = {}) {
  const { sanitizar = sanitizeSessionId, depoisDe = null } = opcoes;
  const original = String(texto ?? '');
  if (!CAMPO_VALIDO.test(String(campo ?? ''))) return { status: 'campo-invalido', texto: original };
  const atual = lerCampoDeTexto(original, campo);
  if (atual !== null && atual !== '') return { status: 'ja-preenchido', texto: original };
  const limpo = sanitizar(valor);
  if (!limpo) return { status: 'valor-invalido', texto: original };
  if (atual !== null) {
    const re = new RegExp(`^(${campo}:)[^\\r\\n]*(\\r?)$`, 'm');
    return { status: 'preenchido', texto: original.replace(re, (_m, chave, cr) => `${chave} "${limpo}"${cr}`) };
  }
  if (!depoisDe) return { status: 'sem-campo', texto: original };
  if (!CAMPO_VALIDO.test(depoisDe)) return { status: 'campo-invalido', texto: original };
  const reAncora = new RegExp(`^(${depoisDe}:[^\\r\\n]*)(\\r?)(\\n)`, 'm');
  if (!reAncora.test(original)) return { status: 'sem-ancora', texto: original };
  return { status: 'inserido', texto: original.replace(reAncora, (_m, linha, cr, nl) => `${linha}${cr}${nl}${campo}: "${limpo}"${cr}${nl}`) };
}

/** I/O mínimo em torno da função pura. Fail-soft. */
export function preencherCampoArquivo(frenteFile, campo, valor, opcoes = {}) {
  let texto;
  try { texto = readFileSync(frenteFile, 'utf-8'); } catch { return 'sem-registro'; }
  try {
    const { status, texto: novo } = preencherCampoEmTexto(texto, campo, valor, opcoes);
    if (status === 'preenchido' || status === 'inserido') writeFileSync(frenteFile, novo, 'utf-8');
    return status;
  } catch { return 'erro'; }
}

export const preencherChatIdArquivoSeVazio = (frenteFile, sessionId) =>
  preencherCampoArquivo(frenteFile, 'chat_id', sessionId, { sanitizar: sanitizeSessionId });

/** app_session_id logo depois do chat_id; session_title logo depois do app_session_id. */
export function gravarSessaoAppNoRegistro(frenteFile, { appSessionId, sessionTitle } = {}) {
  const app = preencherCampoArquivo(frenteFile, 'app_session_id', appSessionId, { sanitizar: sanitizeSessionId, depoisDe: 'chat_id' });
  const titulo = sessionTitle == null ? 'nao-informado'
    : preencherCampoArquivo(frenteFile, 'session_title', sessionTitle, { sanitizar: sanitizeTituloSessao, depoisDe: 'app_session_id' });
  return { app_session_id: app, session_title: titulo };
}

/** github_frente logo depois de pr. */
export const gravarGithubFrente = (frenteFile, label) =>
  preencherCampoArquivo(frenteFile, 'github_frente', label, { sanitizar: sanitizeLabelFrente, depoisDe: 'pr' });
