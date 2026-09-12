#!/usr/bin/env node
/**
 * frente-sessao-app.mjs — grava no registro da frente a identidade da sessão do APP.
 *
 * O `chat_id` que o hook grava é o id do CLI. O `send_message` do app — canal pelo qual o
 * auditor entrega o veredito ao chat dono — só aceita o `sessionId` do APP (`local_…`), e os
 * dois só coincidem às vezes. Sem este gesto o check `frente-registro` reprova o PR.
 *
 * A lógica byte a byte é de `lib/frente-registro.mjs`. Este arquivo é a porta de linha de
 * comando para as skills (que vivem fora do repo) chamarem em vez de editar YAML à mão.
 *
 * USO: npm run frente:sessao-app -- --id <sessionId de get_session self> [--title "..."] [--slug <slug>]
 * Nenhum valor já preenchido é sobrescrito: o primeiro dono continua o dono.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getEsteira, registroDaFrente } from './lib/esteira.mjs';
import { gravarSessaoAppNoRegistro } from './lib/frente-registro.mjs';

const NOME = 'frente:sessao-app';
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null; };
function falhar(motivo, passos) {
  console.error(`[${NOME}] FALHA: ${motivo}\n\n    FIX-HINT:`);
  for (const p of passos) console.error(`      ${p}`);
  process.exit(1);
}

let cfg;
try { cfg = getEsteira(process.cwd()); } catch (e) { falhar(e.message, ['Rode de dentro da worktree da frente (qualquer subpasta serve).']); }

let branch = '';
try { branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: cfg.repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* ignora-de-proposito: sem git */ }

const id = arg('id');
const title = arg('title');
const slug = arg('slug') || (branch.startsWith('claude/') ? branch.slice(7) : null);

if (!id) falhar('faltou o id da sessão do app (--id).', ['Peça o id à própria sessão: get_session self → campo sessionId (começa com "local_").', 'Depois: npm run frente:sessao-app -- --id <sessionId> --title "<title>"']);
if (!slug) falhar(`não dá para deduzir a frente: a branch "${branch || '?'}" não é claude/<slug>.`, ['Passe a frente explicitamente: npm run frente:sessao-app -- --id <id> --slug <slug>']);

const registro = registroDaFrente(cfg, slug);
if (!existsSync(registro)) falhar(`a frente "${slug}" não tem registro em ${registro}.`, [`Se a frente não existe mesmo: npm run frente:abrir -- ${slug}`]);

const st = gravarSessaoAppNoRegistro(registro, { appSessionId: id, sessionTitle: title });
if (st.app_session_id === 'valor-invalido') falhar(`o id "${id}" não casa com o alfabeto seguro ([A-Za-z0-9._-], até 128).`, ['Use o sessionId exato devolvido por get_session self, sem aspas nem espaços.']);
if (st.app_session_id === 'sem-ancora' || st.app_session_id === 'sem-campo') falhar(`o registro não tem a linha chat_id, âncora do campo novo.`, [`Acrescente  chat_id: ""  ao frontmatter de ${registro} e reabra a sessão nesta worktree (o hook preenche).`]);
if (st.app_session_id === 'erro' || st.app_session_id === 'sem-registro') falhar(`não foi possível escrever em ${registro} (status=${st.app_session_id}).`, ['Confira permissão de escrita e se o arquivo não está aberto em outro programa.']);

console.log(`[${NOME}] frente "${slug}": app_session_id=${st.app_session_id} · session_title=${st.session_title}`);
if (st.app_session_id === 'ja-preenchido') console.log(`[${NOME}] o registro já tinha dono de app — nada foi sobrescrito (comportamento correto).`);
else console.log(`[${NOME}] commite o registro junto com o trabalho: git add ${registro.slice(cfg.repoRoot.length + 1)}`);
