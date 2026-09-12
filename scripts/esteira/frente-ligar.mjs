#!/usr/bin/env node
/**
 * frente-ligar.mjs — grava `github_frente` no registro da frente (quinto termo da LEI 73).
 * Porta de linha de comando para o /ligar-frente-base; a escrita byte a byte é de lib/frente-registro.mjs.
 *
 * USO: npm run frente:ligar -- [--label frente:<slug>] [--slug <slug>]
 * Sem --label usa <cfg.labels.frente><slug>. Nunca sobrescreve valor já preenchido.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getEsteira, registroDaFrente } from './lib/esteira.mjs';
import { gravarGithubFrente } from './lib/frente-registro.mjs';

const NOME = 'frente:ligar';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };
function falhar(motivo, passos) { console.error(`[${NOME}] FALHA: ${motivo}\n\n    FIX-HINT:`); for (const p of passos) console.error(`      ${p}`); process.exit(1); }

let cfg;
try { cfg = getEsteira(process.cwd()); } catch (e) { falhar(e.message, ['Rode de dentro da worktree da frente.']); }
let branch = '';
try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: cfg.repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* ignora-de-proposito: sem git */ }
const slug = arg('slug') || (branch.startsWith('claude/') ? branch.slice(7) : null);
if (!slug) falhar(`a branch "${branch || '?'}" não é claude/<slug>.`, ['Passe a frente: npm run frente:ligar -- --slug <slug>']);
const label = arg('label') || `${cfg.prefixoFrente}${slug}`;
const registro = registroDaFrente(cfg, slug);
if (!existsSync(registro)) falhar(`sem registro em ${registro}.`, ['A worktree foi aberta fora do frente:abrir. Crie a label no GitHub mesmo assim, mas não crie o arquivo à mão.']);

const st = gravarGithubFrente(registro, label);
if (st === 'valor-invalido') falhar(`label "${label}" fora do alfabeto seguro.`, ['Use letras minúsculas, dígitos, ".", "_", ":", "-".']);
if (st === 'sem-ancora' || st === 'sem-campo') falhar('o registro não tem a linha `pr:`, âncora do campo.', [`Confira o frontmatter de ${registro}.`]);
if (st === 'erro' || st === 'sem-registro') falhar(`não escrevi em ${registro} (status=${st}).`, ['Confira permissão de escrita.']);
console.log(`[${NOME}] frente "${slug}": github_frente=${st} (${label})`);
if (st === 'ja-preenchido') console.log(`[${NOME}] já estava ligada — nada sobrescrito.`);
else console.log(`[${NOME}] commite o registro junto com o trabalho.`);
