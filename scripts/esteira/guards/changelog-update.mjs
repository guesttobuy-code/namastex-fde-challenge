#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: "mapear e documentar cada PR vencido" é um inegociável do kit — sem isso, um PR que
 *   muda código (corrige bug, muda comportamento, adiciona feature) entra e sai sem deixar rastro em
 *   lugar nenhum lido por humano: só o `git log` fica, e ninguém lê `git log` pra saber "o que mudou
 *   nesta leva". O CHANGELOG.md é o único artefato cuja função é essa. A catraca (dor do dono): todo
 *   PR/commit vencido que muda código TEM que deixar uma entrada aqui, citando a issue/PR (`#N`) — é
 *   assim que cada PR vencido fica mapeado e documentado, não por convenção verbal.
 *
 * INCIDENTE DE ORIGEM: preventivo — decisão do dono 2026-09-11 (ADR-0003, #21).
 *
 * O QUE FAZ: pega os arquivos MUDADOS vs a base (git, rename-aware, via `arquivosMudados`). Se algum
 *   arquivo de CÓDIGO (`.mjs/.cjs/.js/.jsx/.ts/.tsx/.mts/.cts/.ps1/.psm1/.sh/.py`, ou qualquer arquivo
 *   sob `.githooks/`) que NÃO é arquivo de teste está no diff, exige `CHANGELOG.md` (raiz) tocado E pelo
 *   menos uma linha GENUINAMENTE NOVA nele — um bullet (`"- "`, `"* "`, `"+ "` ou `"1. "`) com `#N`.
 *   "GENUINAMENTE NOVA" é medido por CONTEÚDO, não por `git diff`: confronta as linhas (despidas de
 *   comentário HTML/cerca de código via `despirMarkdown`, normalizadas — trim + colapsa espaço) do
 *   `CHANGELOG.md` na BASE (`git show <merge-base>:CHANGELOG.md` — o caminho ANTIGO, se o arquivo que
 *   virou `CHANGELOG.md` neste diff é um RENAME) contra as do ÍNDICE (`git show :CHANGELOG.md` — o que
 *   vai virar o commit) num MULTISET: uma linha do lado novo só conta como "nova" se sobrar depois de
 *   consumir uma ocorrência igual da base. Isso fecha, na fonte, tanto "só re-tocar uma entrada antiga"
 *   quanto "o pre-commit mede o índice, não a união de dois diffs independentes" (ver certidão abaixo).
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. diff que muda código (fora de teste) sem `CHANGELOG.md` no diff (`changelog-ausente`).
 *   2. `CHANGELOG.md` mudou mas nenhuma linha GENUINAMENTE NOVA cita uma issue/PR (`entrada-sem-
 *      referencia`) — mudar o arquivo por mudar (reordenar, só acrescentar espaço numa linha existente,
 *      renomear OUTRO arquivo pra `CHANGELOG.md` carregando conteúdo velho) não é documentar o PR
 *      vencido: o conteúdo tem que ser NOVO de verdade, não só re-apresentado.
 *
 * O QUE NUNCA PODE BLOQUEAR:
 *   1. diff SEM código (só docs/config/markdown/json) — `NAO_APLICAVEL`, exit 0.
 *   2. diff que só toca arquivo(s) de TESTE — teste não é "código" pra esta regra (mesma convenção do
 *      `testes-catraca`); mudar só teste não exige entrada no CHANGELOG (inclui REMOVER um teste que já
 *      existia na base).
 *   3. repo sem `CHANGELOG.md` nem na base nem no head QUANDO não há código no diff (nada a cobrar).
 *   4. entrada no `CHANGELOG.md` só STAGED (no índice, ainda não commitada) COM referência — conta igual
 *      a uma commitada: o guard mede merge-base × ÍNDICE, o que vai VIRAR o commit — nunca a união de
 *      dois diffs independentes (commit-range + `--cached`), que deixava uma entrada COMMITADA e depois
 *      revertida/removida só no stage ainda "emprestar" aprovação (o gate local mentia; o CI pegava
 *      depois — furo fechado na fonte, não é mais possível pela mecânica do guard).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) se a entrada do CHANGELOG DESCREVE de verdade a mudança de código —
 *   só mede "existe um bullet NOVO com #N", não a fidelidade do texto (isso é revisão humana/auditor);
 *   (b) se o `#N` citado é a issue/PR CERTA (poderia citar qualquer número) — não valida contra o PR
 *   real (não tem acesso à rede aqui; seria checado por `gh` num guard de rede à parte); (c) `#N` dentro
 *   de uma linha que não é bullet não conta DE PROPÓSITO — texto solto sem marcador de lista não é uma
 *   "entrada", é prosa; (d) caminho de `CHANGELOG.md` fora da raiz, ou renomeado com caixa diferente
 *   (`changelog.md`), não é reconhecido — casa só o literal `CHANGELOG.md` na raiz, como a spec pede;
 *   (e) categoria Keep a Changelog (Adicionado/Corrigido/…) — não exige seção, só bullet + referência,
 *   em qualquer lugar do arquivo; (f) dívida acumulada ANTES desta leva (arquivo que já tinha entradas
 *   sem `#N` na base) — a catraca é sobre o DIFF, não varre o arquivo inteiro; (g) linguagem/script FORA
 *   do conjunto listado em "O QUE FAZ" (ex.: `.rb`, `.go`, `Dockerfile`, `.yml` de infra) não conta como
 *   "código" pra esta regra — fronteira igual à de antes, agora DECLARADA de propósito (achado CU-7 da
 *   1ª auditoria), não descoberta por fora.
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial (rodada 1 do Núcleo de Saúde v1, veredito FURADO,
 *   8 achados) — todos consertados nesta reconciliação: (CU-1, alta) uma linha ANTIGA só RE-TOCADA
 *   (espaço no fim, reordenar as duas entradas, renomear `HISTORY.md`→`CHANGELOG.md` carregando um
 *   bullet velho) era relida pelo `git diff -U0` como linha "+" e emprestava aprovação — trocado por
 *   confronto de CONTEÚDO (multiset base×índice), não de diff. (CU-2, média) uma entrada "fantasma"
 *   dentro de um comentário HTML `<!-- -->` ou de uma cerca de código ``` (invisível no CHANGELOG
 *   renderizado) aprovava, e a certidão vendia "STRING/COMENTÁRIO NÃO SE APLICA" — falso: agora o
 *   conteúdo passa por `despirMarkdown` antes de julgar. (CU-3, média) o pre-commit somava o diff
 *   commit-range com o `--cached` como duas listas INDEPENDENTES — uma entrada commitada e depois
 *   revertida/removida só no ÍNDICE ainda aprovava local (o CI reprovava depois; o gate mentia) —
 *   trocado por um confronto único merge-base×índice. (CU-4, média) os caminhos PORTA "branch órfã (sem
 *   merge-base) → NÃO MEDIU" e "repo sem nenhum commit → NAO_APLICAVEL" eram alcançáveis mas sem
 *   self-test dedicado (mutante isolado dessas linhas sobrevivia) — casos PORTA acrescentados pra cada
 *   um. (CU-5, baixa) o `try/catch` em volta do diff do CHANGELOG podia mascarar um erro REAL do git como
 *   "entrada-sem-referencia" (exit 1, diagnóstico errado) em vez de NÃO MEDIU (exit 2) — o redesenho por
 *   CONTEÚDO usa `conteudoNaBase`/`conteudoNoIndex` da lib, que já LANÇAM em erro real (nunca escondem);
 *   não sobrou try/catch supérfluo. (CU-6, baixa) `RE_BULLET` só reconhecia `"- "`/`"* "` — uma entrada
 *   válida com `"+ "` ou lista numerada (`"1. "`) reprovava por falso-positivo; e o `git diff` sem
 *   `--no-color`/`--no-ext-diff` quebrava com `color.diff=always` do autor — ambos resolvidos: regex
 *   ampliada, e o CONTEÚDO agora vem de `git show` (nunca de `git diff`), imune a config de cor. (CU-7,
 *   baixa) PR que mudava `.ps1/.sh/.py` ou `.githooks/*` (inclusive o próprio pre-commit) passava sem
 *   exigir CHANGELOG, sem a fronteira declarada — `RE_CODIGO` ampliada e a fronteira que sobra agora é
 *   item (g) do "NÃO VÊ", de propósito. (CU-8, baixa) um caso do self-test prometia cobrir "deletar um
 *   teste existente" mas rodava, na prática, o mesmo cenário (decorativo) de "sem diff nenhum" — trocado
 *   pelo cenário real.
 *
 * BANCA — as 10 classes:
 *   BANCA: VAZIO — TRATADA: nenhum arquivo de código no diff → `arquivosCodigo.length === 0` →
 *     `aplicavel: false`, `ok: true` (não é "aprovar por não ter o que reprovar" — é genuinamente fora
 *     de escopo). `CHANGELOG.md` tocado mas sem NENHUMA linha genuinamente nova (mesmo conteúdo antes e
 *     depois, ex.: só reformatação) → `entrada-sem-referencia`, nunca aprova em silêncio.
 *   BANCA: STRING/COMENTÁRIO — TRATADA (achado CU-2): o guard não faz parsing de código-fonte (o PATH
 *     decide se é "código"); mas o CONTEÚDO relevante É markdown, e markdown TEM comentário (`<!-- -->`)
 *     e bloco de código cercado (```/~~~) — antes de julgar, `despirMarkdown` apaga (com espaço, sem
 *     mudar nº de linha) o que está dentro deles, então uma entrada "fantasma" ali nunca vira uma linha
 *     candidata a bullet+referência.
 *   BANCA: BASELINE — NÃO SE APLICA: a "base" é o commit-base do git (`--base`), não um
 *     arquivo/allowlist editável pelo autor do PR.
 *   BANCA: IMPORT/PATH — PARCIAL (declarada): não segue import/link (não se aplica, como os ratchets
 *     irmãos); mas o PATH de `CHANGELOG.md` é casado por igualdade LITERAL (`e.path === 'CHANGELOG.md'`)
 *     — mover o arquivo pra outro caminho ou outra caixa (`Changelog.md`) faz o guard tratá-lo como "não
 *     tocado" → reprova por `changelog-ausente` (conservador: NUNCA aprova em falso; o autor tem que
 *     corrigir o caminho, não um bypass).
 *   BANCA: RENOMEAR — TRATADA (achado CU-1, A3): renomear um arquivo de CÓDIGO continua contando (o path
 *     novo, se ainda tiver extensão/local de código, casa); renomear `CHANGELOG.md` PARA FORA faz o path
 *     no HEAD deixar de ser `CHANGELOG.md` exato → `changelogTocado = false` → reprova (nunca deixa
 *     passar por engano); renomear ALGO PARA `CHANGELOG.md` (ex.: `HISTORY.md`→`CHANGELOG.md`) já NÃO
 *     "empresta" o conteúdo antigo: a base do confronto vira o CAMINHO ANTIGO (`entrada.old`), então só
 *     conta se, além do rename, uma linha GENUINAMENTE NOVA (ausente também no arquivo de origem) foi
 *     acrescentada.
 *   BANCA: INVISÍVEL — TRATADA (achado CU-2, extra): `\r` residual (CRLF) é limpo antes de casar
 *     bullet/referência; `RE_BULLET` exige espaço/tab **ASCII** (`[ \t]`) logo após o marcador — um NBSP
 *     (`U+00A0`) ou outro espaço Unicode ali NUNCA casa (CommonMark também não reconhece isso como item
 *     de lista), então nunca aprova por engano; o passo de NORMALIZAÇÃO usado só pra comparar "já
 *     existia na base?" roda numa CÓPIA da linha (a checagem de bullet vê a linha original, com o NBSP
 *     intacto) — as duas responsabilidades não se misturam.
 *   BANCA: NULO — TRATADA: `arquivosMudados`/`conteudoNaBase`/`conteudoNoIndex` (lib) LANÇAM em erro real
 *     (nunca devolvem null/undefined fingindo "sem mudança") — `main()` captura e sai 2 (NÃO MEDIU),
 *     nunca 0. `julgar` recebe campos `undefined` sem quebrar (trata como vazio).
 *   BANCA: SUBSTITUIR — TRATADA: o self-test usa repositório git REAL (mesmo processo, sem mock do git);
 *     a única dependência é `git-base.mjs` + `despir-codigo.mjs`, dono único, não reimplementados aqui.
 *   BANCA: TRUNCADO/TAMANHO — NÃO SE APLICA: não há limite de tamanho no CHANGELOG nem no diff; um
 *     `CHANGELOG.md` gigante funciona igual (só as linhas são comparadas por conteúdo, não recortadas).
 *
 * CONTRA-PROVA: node scripts/guards/changelog-update.mjs --self-test (suíte em
 *   scripts/guards/selftest/changelog-update.mjs) — repo git real: código muda sem tocar CHANGELOG →
 *   reprova; CHANGELOG muda mas linha nova sem `#N` → reprova; código + CHANGELOG com `"- algo (#12)"`
 *   NOVO → ok; entrada só STAGED com referência → ok; só doc muda → ok (NAO_APLICAVEL); só teste muda
 *   (adicionar OU remover) → ok; renomear arquivo de código sem tocar CHANGELOG → reprova; BYPASS CU-1
 *   (espaço/reorder/rename-com-conteúdo-velho) → reprova; BYPASS CU-2 (comentário/cerca) → reprova;
 *   BYPASS CU-3 (revertido/removido só no índice) → reprova; `.ps1`/`.githooks/*` sem CHANGELOG →
 *   reprova; PORTA 2 sem base/fora de repo/base inexistente/branch órfã; PORTA 0 repo sem commit.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
import { despirMarkdown } from '../lib/despir-codigo.mjs';
import { git, conteudoNaBase, conteudoNoIndex, arquivosMudados, baseDaEsteira, temHead, refExiste, repoRaiz } from '../lib/git-base.mjs';

export const NOME = 'changelog-update';
// (achado CU-7) além das extensões JS/TS, também conta como "código": scripts .ps1/.psm1/.sh/.py e
// QUALQUER arquivo sob .githooks/ (o próprio gate de pre-commit não tem extensão).
const RE_CODIGO = /\.(?:mjs|cjs|js|jsx|ts|tsx|mts|cts|ps1|psm1|sh|py)$/i;
const RE_GITHOOKS = /(?:^|\/)\.githooks\/[^/]+$/;
// Mesma convenção de "arquivo de teste" do testes-catraca.mjs (dono único da REGEX é aquele arquivo;
// aqui é uma CÓPIA LOCAL — reimplementar é preferível a importar de OUTRO GUARD, que não é lib).
const RE_EXT = 'mjs|cjs|js|jsx|ts|tsx|mts|cts';
const RE_TESTE = new RegExp(`(?:^|/)(?:[^/]*\\.(?:test|spec|tests|specs)\\.(?:${RE_EXT})|__tests__/(?:[^/]+/)*[^/]*\\.(?:${RE_EXT}))$`, 'i');
export const CHANGELOG_PATH = 'CHANGELOG.md';
// (achado CU-6) "-"/"*"/"+" (as 3 marcas de lista do CommonMark) OU número seguido de "." ou ")"; o
// espaço/tab depois é ASCII de propósito ([ \t], não \s) — fecha o NBSP (achado CU-2, extra) sem casar
// por engano um marcador seguido de espaço Unicode que o CommonMark também não reconheceria como lista.
const RE_BULLET = /^(?:[-*+]|\d+[.)])[ \t]/;
const RE_REF = /#\d+/;

/** FUNÇÃO PURA: <caminho> é código (pra esta regra) — código de verdade, não arquivo de teste. */
export function ehCodigoNaoTeste(caminho) {
  const p = String(caminho ?? '');
  if (RE_TESTE.test(p)) return false;
  return RE_CODIGO.test(p) || RE_GITHOOKS.test(p);
}

/** FUNÇÃO PURA: <linha> é um bullet de changelog com referência #N? Vê a linha ORIGINAL (não
 *  normalizada) — é aqui que um NBSP/espaço Unicode depois do marcador é rejeitado (BANCA INVISÍVEL). */
export function ehLinhaBulletComReferencia(linha) {
  const l = String(linha ?? '').replace(/\r$/, '').trim();
  if (!l) return false;
  return RE_BULLET.test(l) && RE_REF.test(l);
}

/** FUNÇÃO PURA: chave de comparação de uma linha — trim + colapsa espaço interno. Só serve pra decidir
 *  "isto já existia?" (multiset); NUNCA é o texto usado pra julgar se é bullet — essa checagem usa a
 *  linha original (ver ehLinhaBulletComReferencia), senão a normalização apagaria a diferença entre um
 *  espaço ASCII e um NBSP (reabriria o furo do CU-2/extra). */
export function chaveDeComparacao(linha) {
  return String(linha ?? '').replace(/\r$/, '').trim().replace(/\s+/g, ' ');
}

/** FUNÇÃO PURA: <texto> (conteúdo de um CHANGELOG.md) despido de comentário HTML/cerca de código
 *  (achado CU-2 — `despirMarkdown` da lib, dono único), quebrado em linhas (\r residual removido). */
export function linhasDespidas(texto) {
  return despirMarkdown(texto).split('\n').map((l) => l.replace(/\r$/, ''));
}

/** FUNÇÃO PURA (o coração do conserto do CU-1/CU-3): quais linhas de <headLinhas> são GENUINAMENTE
 *  NOVAS — ausentes (por CONTEÚDO normalizado) em <baseLinhas>. MULTISET: uma linha da base só "perdoa"
 *  UMA ocorrência igual do lado novo — reordenar ou repetir uma entrada antiga não abre uma segunda
 *  vaga. Comparamos CONTEÚDO (o arquivo inteiro nos dois lados), nunca a saída do `git diff` — que
 *  reapresenta qualquer linha TOCADA (espaço a mais, reordenada, ou um rename sem `-M` reconhecido) como
 *  "+" mesmo sem mudança real (era exatamente o bypass do CU-1). Linha vazia nunca conta (nos dois
 *  lados) — não polui o multiset nem "sobra" como nova. */
export function linhasGenuinamenteNovas(baseLinhas, headLinhas) {
  const restante = new Map();
  for (const l of (baseLinhas || [])) {
    const k = chaveDeComparacao(l);
    if (!k) continue;
    restante.set(k, (restante.get(k) || 0) + 1);
  }
  const novas = [];
  for (const l of (headLinhas || [])) {
    const k = chaveDeComparacao(l);
    if (!k) continue;
    const n = restante.get(k) || 0;
    if (n > 0) { restante.set(k, n - 1); continue; } // já existia na base — não "empresta" aprovação
    novas.push(l); // linha ORIGINAL (não a chave) — preserva NBSP/etc pra ehLinhaBulletComReferencia
  }
  return novas;
}

/** FUNÇÃO PURA: julga o estado coletado. Só cobra CHANGELOG quando há código (fora de teste) no diff. */
export function julgar({ arquivosCodigo, changelogTocado, linhasNovas } = {}) {
  const codigos = arquivosCodigo || [];
  if (codigos.length === 0) return { ok: true, aplicavel: false, problemas: [] };
  if (!changelogTocado) {
    return {
      ok: false, aplicavel: true,
      problemas: [{
        tipo: 'changelog-ausente',
        detalhe: `código mudou (${codigos.length} arquivo(s): ${codigos.slice(0, 3).join(', ')}`
          + `${codigos.length > 3 ? ', …' : ''}) mas ${CHANGELOG_PATH} não está no diff`,
      }],
    };
  }
  const temRef = (linhasNovas || []).some(ehLinhaBulletComReferencia);
  if (!temRef) {
    return {
      ok: false, aplicavel: true,
      problemas: [{
        tipo: 'entrada-sem-referencia',
        detalhe: `${CHANGELOG_PATH} mudou mas nenhuma linha GENUINAMENTE NOVA (ausente na base) é um bullet`
          + ` ("- "/"* "/"+ "/"1. ") com #N (issue/PR)`,
      }],
    };
  }
  return { ok: true, aplicavel: true, problemas: [] };
}

/** Coleta o estado vs a base (git) e julga. arquivosMudados devolve {path, old} (rename-aware). O
 *  confronto do CHANGELOG é merge-base × ÍNDICE (achado CU-3) via conteúdo (achados CU-1/CU-2), nunca
 *  via `git diff` da linha do arquivo. */
export function medir({ repo, base }) {
  const mudados = arquivosMudados(base, repo);
  const arquivosCodigo = mudados.filter((e) => ehCodigoNaoTeste(e.path)).map((e) => e.path);
  const entradaChangelog = mudados.find((e) => e.path === CHANGELOG_PATH);
  const changelogTocado = Boolean(entradaChangelog);
  let linhasNovas = [];
  if (changelogTocado) {
    const mb = git(['merge-base', base, 'HEAD'], repo);
    // rename-into (ex.: HISTORY.md → CHANGELOG.md): a "base" do confronto é o CAMINHO ANTIGO, senão o
    // conteúdo herdado do arquivo de origem passaria inteiro como "genuinamente novo" (CU-1, A3).
    const baseOrigem = entradaChangelog.old || CHANGELOG_PATH;
    const baseLinhas = linhasDespidas(conteudoNaBase(mb, baseOrigem, repo));
    const headLinhas = linhasDespidas(conteudoNoIndex(CHANGELOG_PATH, repo));
    linhasNovas = linhasGenuinamenteNovas(baseLinhas, headLinhas);
  }
  return { arquivosCodigo, changelogTocado, linhasNovas, julgamento: julgar({ arquivosCodigo, changelogTocado, linhasNovas }) };
}

function main() {
  const argv = process.argv.slice(2);
  const flagBase = (() => { const i = argv.indexOf('--base'); return i >= 0 ? argv[i + 1] : undefined; })();
  const repo = repoRaiz(process.cwd());
  if (!repo) { console.error(`[${NOME}] NÃO MEDIU: não estou num repositório git.`); process.exitCode = 2; return; }
  const base = flagBase || baseDaEsteira(repo);
  if (!base) { console.error(`[${NOME}] NÃO MEDIU: informe --base <ref> (ou rode num projeto com esteira.json).`); process.exitCode = 2; return; }
  if (!temHead(repo)) { console.log(`[${NOME}] NAO_APLICAVEL: repositório ainda sem commit (primeiro commit).`); process.exitCode = 0; return; }
  if (!refExiste(base, repo)) { console.error(`[${NOME}] NÃO MEDIU: a base "${base}" não existe — git fetch primeiro.`); process.exitCode = 2; return; }
  let resultado;
  try { resultado = medir({ repo, base }); }
  catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; return; }
  const { arquivosCodigo, changelogTocado, julgamento } = resultado;
  if (!julgamento.aplicavel) { console.log(`[${NOME}] NAO_APLICAVEL: diff vs ${base} não toca código fora de teste.`); process.exitCode = 0; return; }
  console.log(
    `[${NOME}] base ${base} · ${arquivosCodigo.length} arquivo(s) de código mudado(s) · ${CHANGELOG_PATH} `
      + `${changelogTocado ? '' : 'NÃO '}tocado no diff`,
  );
  if (julgamento.ok) { console.log(`[${NOME}] ✅ ${CHANGELOG_PATH} documenta a mudança com referência (#N).`); process.exitCode = 0; return; }
  for (const p of julgamento.problemas) console.error(`[${NOME}] FALHA (${p.tipo}): ${CHANGELOG_PATH} — ${p.detalhe}`);
  console.error(
    `[${NOME}] COMO PASSAR: adicione uma entrada NOVA em ${CHANGELOG_PATH} (seção [Unreleased], formato Keep a Changelog)`
      + ` com um bullet ("- ", "* ", "+ " ou "1. ") citando a issue/PR, ex.: "- corrigido X (#123)".`
      + ` Só reordenar/re-tocar uma entrada existente não conta. NUNCA use --no-verify.`,
  );
  console.error(`[${NOME}] POR QUE EXISTE: PR vencido que muda código sem rastro no CHANGELOG não fica mapeado nem documentado — a mudança some do radar.`);
  process.exitCode = 1;
}

/** Roda a suíte de self-test — mora no companheiro (PASSO 3b: guard > 600 linhas visuais). Import
 *  dinâmico relativo: o guard continua sendo a PORTA (`node scripts/guards/changelog-update.mjs
 *  --self-test`), com a mesma saída e o mesmo exit de sempre; só os casos/fixtures moraram pra
 *  scripts/guards/selftest/changelog-update.mjs. */
async function selfTest() {
  const { rodarSelfTest } = await import('./selftest/changelog-update.mjs');
  process.exitCode = rodarSelfTest();
}

if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
