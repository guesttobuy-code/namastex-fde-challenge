#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: o CI verde não lê o corpo do PR, e o corpo é onde a IA (e o dono) declaram
 *   "pronto". Ver a certidão de lib/prova-colada.mjs. Este arquivo é a PORTA: lê o corpo
 *   (`--file <md>` · `--pr <N> [--repo owner/repo]` via gh · env PR_BODY no CI) e aplica as 3
 *   regras da lib, citando `corpo:<linha>` e o fix-hint.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. "não consegui ler o corpo" saindo como exit 0 — sem corpo é exit 2 (NÃO MEDIU);
 *   2. tudo que a lib lista.
 *
 * LIMITE CONHECIDO: julga formato; não roda no pre-commit (não há corpo de PR ali) — roda no CI
 *   (job `prova-colada`, gatilho `edited`) e à mão no passo 3, no passo 4 e no /feito-base.
 *   Tornar required é decisão do dono. PR em draft não é julgado (o job pula).
 *
 * CONTRA-PROVA: `npm run prova-colada:selftest` (= node guards/prova-colada.mjs --self-test).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { julgarCorpo, ehDeclaracaoNegativa, achaClaim, R } from '../lib/prova-colada.mjs';

const NOME = 'prova-colada';

export function lerCorpo(argv = process.argv.slice(2), env = process.env, io = { lerArquivo: (p) => readFileSync(p, 'utf8'), gh: ghBody }) {
  const iFile = argv.indexOf('--file');
  if (iFile >= 0 && argv[iFile + 1]) return { origem: `arquivo ${argv[iFile + 1]}`, body: io.lerArquivo(argv[iFile + 1]) };
  const iPr = argv.indexOf('--pr');
  if (iPr >= 0 && argv[iPr + 1]) {
    const iRepo = argv.indexOf('--repo');
    return { origem: `PR #${argv[iPr + 1]}`, body: io.gh(argv[iPr + 1], iRepo >= 0 ? argv[iRepo + 1] : null) };
  }
  if (typeof env.PR_BODY === 'string') return { origem: 'env PR_BODY', body: env.PR_BODY };
  return null;
}

function ghBody(n, repo) {
  const args = ['pr', 'view', String(n), '--json', 'body', '-q', '.body'];
  if (repo) args.push('--repo', repo); // sem --repo, o gh deduz do remote da pasta atual
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function main() {
  const fonte = lerCorpo();
  if (!fonte) {
    console.error(`[${NOME}] NÃO MEDIU: sem corpo de PR — use --pr <N> [--repo owner/repo], --file <md>, ou PR_BODY no ambiente.`);
    process.exitCode = 2; return;
  }
  const r = julgarCorpo(fonte.body);
  const blocos = r.secoes.reduce((a, s) => a + s.blocos.filter((b) => b.linhas.length > 0).length, 0);
  console.log(`[${NOME}] corpo de ${fonte.origem}: ${r.secoes.length} seção(ões), ${blocos} bloco(s) de saída`);
  for (const f of r.faltas) { console.error(`  ❌ [${f.regra}] corpo:${f.linha}  ${f.trecho}`); console.error(`       ${f.motivo}`); }
  if (!r.ok) {
    console.error(`\n[${NOME}] ❌ ${r.faltas.length} falta(s) — corpo que NARRA resultado sem COLAR a saída não é prova.`);
    console.error('   FIX-HINT: (1) seção "## Prova executada" com o comando e a saída literal entre crases triplas;');
    console.error('   (2) seção "## O que NÃO verifiquei (e por quê)" com ao menos um item; (3) toda frase "subiu/funciona/');
    console.error('   idempotente/backfill/aplicado em prod" precisa do SEU bloco AO LADO (um bloco prova uma frase) — ou vire');
    console.error('   declaração ("não rodei X" ANTES da palavra), ou citação em blockquote (> …). Aspas não isentam.');
    console.error('   Template: .github/pull_request_template.md.');
    process.exitCode = 1; return;
  }
  console.log(`[${NOME}] ✅ prova colada e limites declarados.`);
  process.exitCode = 0;
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const BLOCO = '```\nℹ tests 21\nℹ pass 21\nℹ fail 0\n```';
  const NV = '## O que NÃO verifiquei\n\n- `full-check` completo — não rodado.\n';
  const PROVA = `## Prova executada\n\n${BLOCO}\n`;
  const regras = (b) => julgarCorpo(b).faltas.map((f) => f.regra);
  const soClaim = (b) => regras(b).filter((r) => r === R.CLAIM_SEM_BLOCO).length;

  const INCIDENTE = '## O que mudou\n\n1. Upload sai da service account e passa ao token do dono.\n\n## Prova\n\n✅ **Dumps dos 3 ambientes SUBIRAM ao Drive**: `OK: enviado`\n✅ Ledger: 3× `partial`.\n';
  const r1 = julgarCorpo(INCIDENTE);
  check('INCIDENTE: "SUBIRAM" sem bloco → CLAIM_SEM_BLOCO na linha 7', r1.faltas.some((f) => f.regra === R.CLAIM_SEM_BLOCO && f.linha === 7 && /SUBIRAM/.test(f.trecho)));
  check('INCIDENTE: seção "Prova" sem bloco → SEM_BLOCO_DE_PROVA', regras(INCIDENTE).includes(R.SEM_BLOCO_DE_PROVA));
  check('INCIDENTE: sem "O que NÃO verifiquei" → SEM_NAO_VERIFIQUEI', regras(INCIDENTE).includes(R.SEM_NAO_VERIFIQUEI));
  check('INCIDENTE: reprova', r1.ok === false);
  check('INCIDENTE: "(idempotente)" como promessa sem bloco → CLAIM_SEM_BLOCO', regras(`## Não conserta\n\n- pode rodar de novo (idempotente).\n\n${PROVA}\n${NV}`).includes(R.CLAIM_SEM_BLOCO));

  check('CONTRA-PROVA: prova com bloco + limites → passa', julgarCorpo(`## Why\n\nContexto.\n\n${PROVA}\n${NV}`).ok === true);
  check('CONTRA-PROVA: palavra-quente DENTRO do bloco não é claim', julgarCorpo(`## Prova executada\n\n\`\`\`\n[abrir-frente] OK (idempotente)\n\`\`\`\n\n${NV}`).ok === true);
  check('CONTRA-PROVA: claim com bloco na mesma seção → sem falta', julgarCorpo(`## Prova executada\n\nO backfill funciona:\n\n${BLOCO}\n\n${NV}`).ok === true);
  check('CONTRA-PROVA: declaração negativa é isenta', julgarCorpo(`## Quality\n\n- [ ] backfill — não rodado nesta rodada.\n\n${PROVA}\n${NV}`).ok === true && ehDeclaracaoNegativa('não aplicável: sem migration') && !ehDeclaracaoNegativa('✅ subiram ao Drive'));
  check('CONTRA-PROVA: títulos sem acento / em inglês', julgarCorpo(`## prova de refutacao ao vivo\n\n${BLOCO}\n\n## o que nao verifiquei\n\n- nada além do diff\n`).ok === true && julgarCorpo(`## Proof (executed)\n\n${BLOCO}\n\n## Not verified\n\n- x\n`).ok === true);
  check('CONTRA-PROVA: citação em BLOCKQUOTE não é claim', julgarCorpo(`## Why\n\n> "Dumps SUBIRAM ao Drive" — zero uploads.\n\nA função \`funciona\` foi renomeada.\n\n${PROVA}\n${NV}`).ok === true);
  check('BYPASS: citação em ASPAS na prosa, sem bloco → claim', regras(`## Why\n\nO caso ("Dumps SUBIRAM ao Drive" — zero uploads) motivou este guard.\n\n${PROVA}\n${NV}`).includes(R.CLAIM_SEM_BLOCO));
  check('CONTRA-PROVA: palavra-quente dentro de "O que NÃO verifiquei" é declaração', julgarCorpo(`${PROVA}\n## O que NÃO verifiquei\n\n- se o job funciona no CI de verdade.\n`).ok === true);
  check('BYPASS: afirmação inteira entre aspas ainda é claim', regras(`## Prova\n\n"funciona nos 3 ambientes"\n\n${NV}`).includes(R.CLAIM_SEM_BLOCO));
  check('BYPASS: UM bloco não lava a seção — 2 frases, 1 bloco → 1 falta', soClaim(`## Prova executada\n\nRodei o lint:\n\n${BLOCO}\n\nO backfill funcionou nos 3 ambientes.\n\nOs dumps subiram com sucesso.\n\n${NV}`) === 1);
  check('BYPASS: afirmação entre aspas com prosa em volta, sem bloco ao lado → falta', regras(`## Prova executada\n\n${BLOCO}\n\nContexto.\n\nConfirmado: "dumps subiram" conforme esperado.\n\n${NV}`).includes(R.CLAIM_SEM_BLOCO));
  check('BYPASS: afirmação no TÍTULO "##" com prosa antes do bloco → falta', regras(`## Prova executada — o backfill funcionou com sucesso\n\nTexto.\n\nMais.\n\n${BLOCO}\n\n${NV}`).includes(R.CLAIM_SEM_BLOCO));
  check('BYPASS: "funcionou — não inclui X" continua afirmação', regras(`## Prova executada\n\n${BLOCO}\n\nNota.\n\nO backfill funcionou — não inclui o Storage.\n\n${NV}`).includes(R.CLAIM_SEM_BLOCO));
  check('BYPASS: 2 linhas de prosa entre afirmação e bloco → não é "ao lado"', regras(`## Prova executada\n\nO backfill funciona.\n\nLinha 1.\n\nLinha 2.\n\n${BLOCO}\n\n${NV}`).includes(R.CLAIM_SEM_BLOCO));
  check('BYPASS: frase em crases COM espaço é claim; identificador não', regras(`## Prova\n\n\`os dumps subiram ao Drive\`\n\n${NV}`).includes(R.CLAIM_SEM_BLOCO) && achaClaim('a função `funciona` foi renomeada') === null);
  check('CONTRA-PROVA: cerca ~~~ conta como bloco', julgarCorpo(`## Prova executada\n\n~~~\nℹ tests 3\n~~~\n\n${NV}`).ok === true);
  check('CONTRA-PROVA: bloco logo ACIMA da frase conta', julgarCorpo(`## Prova executada\n\n${BLOCO}\n\nO backfill funcionou: 21 casos.\n\n${NV}`).ok === true);
  check('CONTRA-PROVA: 1 linha de introdução é aceita', julgarCorpo(`## Prova executada\n\nO backfill funciona.\n\nSaída:\n\n${BLOCO}\n\n${NV}`).ok === true);
  check('CONTRA-PROVA: comentário HTML de template não é item nem claim', regras(`${PROVA}\n## O que NÃO verifiquei\n\n<!-- escreva ao menos um item; "funciona" aqui não conta -->\n`).includes(R.SEM_NAO_VERIFIQUEI));
  check('achaClaim: negação isenta só o que vem depois; substantivo aceita "— não rodado"; blockquote nunca', achaClaim('não rodei o backfill nesta rodada') === null && achaClaim('- [ ] backfill — não rodado.') === null && achaClaim('O backfill funcionou — não inclui o Storage') !== null && achaClaim('> os dumps subiram') === null);
  check('BYPASS: bloco VAZIO não conta', (() => { const rr = regras(`## Prova executada\n\nfunciona nos 3 ambientes\n\n\`\`\`\n\n\`\`\`\n\n${NV}`); return rr.includes(R.CLAIM_SEM_BLOCO) && rr.includes(R.SEM_BLOCO_DE_PROVA); })());
  check('BYPASS: claim numa seção, bloco em OUTRA → falta', regras(`## Why\n\nSubiu nos 3 ambientes.\n\n${PROVA}\n${NV}`).includes(R.CLAIM_SEM_BLOCO));
  check('BYPASS: título "O que NÃO verifiquei" sem item', regras(`${PROVA}\n## O que NÃO verifiquei\n\n\n## Rastro\nx`).includes(R.SEM_NAO_VERIFIQUEI));
  check('BYPASS: corpo vazio / undefined nunca passa', julgarCorpo('').ok === false && julgarCorpo(undefined).ok === false);
  check('BYPASS: "###" não abre seção', regras(`## Prova executada\n\n### detalhe\n\nfunciona.\n\n${NV}`).includes(R.CLAIM_SEM_BLOCO));
  check('BYPASS: "aplicado em homologação" é claim (generalização do kit)', achaClaim('aplicado em homologacao com sucesso') !== null);
  // Medido no kit (2026-09-10) contra o próprio template de PR: comentário HTML MULTILINHA com as
  // palavras-quentes das instruções virava claim, e "nunca funcionou" (linha de regressão) também.
  check('CONTRA-PROVA (kit): comentário HTML multilinha do template não é claim nem item',
    (() => { const rr = regras(`## Prova executada\n\n<!-- Cole a saída. Cada frase "funciona", "subiu"\n     precisa do bloco. -->\n\n${BLOCO}\n\n## O que NÃO verifiquei\n\n<!-- Ao menos um item.\n     Ex.: "- produção não checada" -->\n\n- x\n`); return !rr.includes(R.CLAIM_SEM_BLOCO) && !rr.includes(R.SEM_NAO_VERIFIQUEI); })());
  check('CONTRA-PROVA (kit): linha de regressão "defeito que nunca funcionou" é declaração', achaClaim('**Regressão:** não — defeito que nunca funcionou (nasceu assim em #12)') === null && achaClaim('**Regressão:** SIM — funcionava até #12; parou por X') === null);
  check('BYPASS (kit): item de lista VAZIO ("-", "- [ ]") em "O que NÃO verifiquei" não conta como item',
    regras(`${PROVA}\n## O que NÃO verifiquei\n\n-\n- [ ]\n`).includes(R.SEM_NAO_VERIFIQUEI) && julgarCorpo(`${PROVA}\n## O que NÃO verifiquei\n\n- nada além do diff\n`).ok === true);
  check('BYPASS (kit): comentário multilinha não esconde claim FORA dele', regras(`## Prova executada\n\n<!-- a\n b -->\nO backfill funcionou nos 3 ambientes.\n\n${NV}`).includes(R.CLAIM_SEM_BLOCO));

  const dir = mkdtempSync(join(tmpdir(), 'pc-'));
  try {
    const p = join(dir, 'corpo.md'); writeFileSync(p, 'x');
    check('lerCorpo --file lê o arquivo', lerCorpo(['--file', p], {}).body === 'x');
    check('lerCorpo env PR_BODY (CI)', lerCorpo([], { PR_BODY: 'y' }).body === 'y');
    check('lerCorpo --pr usa o gh (injetado) e repassa --repo', lerCorpo(['--pr', '7', '--repo', 'o/r'], {}, { gh: (n, repo) => `pr${n}@${repo}`, lerArquivo: () => '' }).body === 'pr7@o/r');
    check('lerCorpo sem origem → null (exit 2, NÃO MEDIU — nunca 0)', lerCorpo([], {}) === null);

    // ── PORTA (issue #17): o guard como processo, exit code cobrado ──────────────────────────
    const bom = join(dir, 'bom.md'); writeFileSync(bom, `## O que mudou\n\nx\n\n${PROVA}\n${NV}`);
    const ruim = join(dir, 'ruim.md'); writeFileSync(ruim, INCIDENTE);
    const porta = (args, env = {}) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', PR_BODY: undefined, ...env } }).status;
    check('PORTA: sem corpo → exit 2 (NÃO MEDIU nunca é 0)', porta([]) === 2);
    check('PORTA: corpo ruim (--file) → exit 1', porta(['--file', ruim]) === 1);
    check('PORTA: corpo bom (--file) → exit 0', porta(['--file', bom]) === 0);
    check('PORTA: PR_BODY ruim (forma do CI) → exit 1', porta([], { PR_BODY: INCIDENTE }) === 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
