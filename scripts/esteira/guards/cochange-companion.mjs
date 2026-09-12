#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: a dor do dono — "mudou a fonte, mexeu no teste" é inegociável. Quando um arquivo de
 *   código MUDA e ele já TEM um teste-companheiro (achado por nome/convenção, não por conteúdo), o
 *   comportamento mudou mas o teste que provava aquele comportamento pode ter ficado intacto — verde
 *   mentindo. O companion-red-green prova que o teste TOCADO fica vermelho×verde; este guard prova algo
 *   anterior: que o teste foi TOCADO no mesmo diff, quando já existe um pra tocar.
 *
 * O QUE FAZ: pega os arquivos MUDADOS vs a base (git, rename-aware, `arquivosMudados` devolve
 *   {path, old}), restritos aos que já EXISTIAM na base (fonte NOVA não é julgada — decisão do
 *   coordenador, CC-09: "não ser nova" é literal agora, não só a intenção da certidão). Pra cada FONTE
 *   (código, não-teste: não casa `*.test.*`, `*.spec.*`, nem caminho sob `tests/`/`__tests__/`) procura o
 *   companheiro por NOME — candidatos, na ordem: (1) mesmo diretório, `<base>.test.<ext>` /
 *   `<base>.spec.<ext>` (extensão da própria fonte primeiro, depois o resto da família de código);
 *   (2) `tests/<caminho relativo sem o 1º segmento "src">/<base>.test.<ext>`; (3) `<mesmo
 *   diretório>/__tests__/<base>.test.<ext>`. NÃO há candidato "tests/<base>.test na raiz" — removido por
 *   decisão do coordenador (CC-01): colidia com qualquer basename de qualquer diretório/extensão,
 *   reprovando o inocente (`scripts/index.mjs` exigindo o teste de OUTRO módulo). Um candidato "existe"
 *   se está no ÍNDICE do git (`git ls-files` — o que vai ser commitado, não o disco: decisão do
 *   coordenador, CC-05/CC-06) OU, faltando isso, se existia na BASE (CC-08: um companheiro que foi
 *   RENOMEADO/removido pra fora da convenção no mesmo diff, sem acompanhar a fonte, ainda conta como
 *   "tinha companheiro" — e como o caminho antigo não aparece como mudado no diff, isso reprova). Se o
 *   companheiro existe (índice ou base) e NÃO está no conjunto de caminhos mudados do diff (rename
 *   incluso — `arquivosMudados` já resolve o caminho NOVO de um rename) → FALHA `companheiro-nao-mudou`.
 *   Fonte sem nenhum candidato (índice ou base) → não é deste guard. Opt-out `cochange-de-proposito`: só
 *   isenta se foi ACRESCENTADO neste diff (`marcadorAdicionadoNoDiff` da lib — presente no índice e
 *   AUSENTE na base; um marcador HERDADO de commits antigos não isenta — decisão do coordenador, CC-02).
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. uma fonte que já existia na base mudar, tendo um companheiro que existe (índice OU base) por
 *      convenção de nome, sem esse companheiro aparecer no mesmo diff — nem por rename — e sem o
 *      opt-out TER SIDO ACRESCENTADO neste diff.
 *
 * INCIDENTE DE ORIGEM: preventivo — decisão do dono 2026-09-11 (ADR-0003, #21)
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) se o teste companheiro FOI atualizado corretamente/mede o que devia —
 *   só vê que ele apareceu no diff (qualidade é do companion-red-green e do auditor); (b) companheiro fora
 *   da convenção de nome dos 3 candidatos (projeto com layout de teste exótico) — falso-negativo
 *   declarado, este guard resolve companheiro só por NOME; (c) rename da FONTE cujo companheiro NÃO
 *   acompanha o nome novo (ex.: renomeou `soma.mjs`→`soma2.mjs` mas o teste continua `soma.test.mjs`) —
 *   os candidatos calculados pro nome NOVO (`soma2.test.mjs`) não casam com o nome antigo, vira "fonte
 *   sem companheiro" e não flagra (o guard não busca o companheiro pelo nome ANTIGO da fonte — limite
 *   aceito, diferente de CC-08: lá é o COMPANHEIRO que se move mantendo a fonte com o MESMO nome); (d) só
 *   resolve o PRIMEIRO candidato existente na ordem — fonte com MAIS de um teste legítimo (unit +
 *   integração) só exige o primeiro por convenção; (e) opt-out não é auditado por honestidade aqui — é o
 *   auditor humano que lê o motivo no diff (mesmo modelo dos guards irmãos); (f) não segue import/resolve
 *   de módulo — resolve companheiro só por caminho de arquivo; (g) CÓDIGO PYTHON (R6, 2026-09-11) — este
 *   guard só reconhece extensão JS/TS na convenção de nome; num projeto com "stack": "python" em
 *   esteira.json ele sai NAO_APLICAVEL (exit 0), ANTES de qualquer diff. Cochange fonte×teste em Python
 *   NÃO é medido ainda — pendência declarada (ver CHANGELOG), não um "está limpo" fabricado.
 *
 * MODO DE FALHA JÁ ESCAPADO: 1ª auditoria adversarial (Núcleo de Saúde v1, Rodada 1, 2026-09-11) achou 9
 *   furos (2 ALTA, 5 MEDIA, 2 BAIXA), todos consertados nesta versão:
 *   CC-01 (ALTA) — candidato "tests/<base>.test" na raiz colidia com qualquer basename/dir/extensão do
 *     repo inteiro, reprovando o inocente (`scripts/index.mjs` exigia o teste de outro módulo,
 *     `src/index.mjs`). Candidato removido por decisão do coordenador.
 *   CC-02 (ALTA) — opt-out herdado da base (comentário de um refactor antigo, nunca tocado neste diff)
 *     isentava toda mudança de comportamento futura naquela fonte, pra sempre. Agora só isenta se
 *     ACRESCENTADO neste diff (`marcadorAdicionadoNoDiff`).
 *   CC-03 (MEDIA) — caminho com acento sumia do diff (o git citava como escape octal sem
 *     `core.quotePath=false`) — a fonte ficava INVISÍVEL pro guard, falso-negativo silencioso. Resolvido
 *     na fonte (`git-base.mjs`), este guard herda o conserto.
 *   CC-04 (MEDIA) — o `catch` de `medir()` (exit 2, "NÃO MEDIU") e o ramo NAO_APLICAVEL (exit 0) não
 *     tinham contra-prova — um mutante que trocasse o exit code desses ramos passava despercebido pelo
 *     self-test. Agora há um caso PORTA dedicado a cada ramo (branch órfã sem merge-base; repo sem commit).
 *   CC-05 (MEDIA) — a resolução de companheiro por `existsSync` era case-INSENSITIVE no Windows (NTFS) e
 *     case-SENSITIVE no CI Linux — o mesmo commit dava veredito diferente por plataforma. Agora resolve
 *     por comparação exata contra o ÍNDICE do git (mesma fonte de verdade nas duas plataformas).
 *   CC-06 (MEDIA) — fonte e existência do companheiro eram lidas do WORKING TREE (disco), não do que vai
 *     ser commitado — um marcador ou uma deleção fora do stage isentava um commit que não os continha de
 *     verdade. Agora lê só o que está no ÍNDICE.
 *   CC-07 (BAIXA) — a certidão declarava ORDEM/AMBIGUIDADE (dois candidatos existentes) como tratada sem
 *     nenhum caso que provasse; e o filtro "arquivo sob tests/ não é fonte" também era decorativo. Ambos
 *     agora têm caso.
 *   CC-08 (BAIXA) — mover o TESTE pra fora da convenção (rename puro, mesmo conteúdo) junto com uma
 *     mudança de comportamento na fonte escapava: a fonte virava "sem companheiro" porque o candidato só
 *     era checado contra o estado ATUAL. Agora os candidatos também são checados contra a BASE.
 *   CC-09 (BAIXA) — fonte NOVA (não existia na base) era julgada, ao contrário do que a certidão já dizia
 *     ("e não ser nova"); e o log de telemetria contava toda fonte AVALIADA como "com companheiro
 *     resolvido", inflando a impressão de cobertura do dogfood. Ambos corrigidos.
 *
 * BANCA — as 10 classes:
 *   BANCA: STRING/COMENTÁRIO — TRATADA: o opt-out é lido do índice CRU (é um comentário, mesmo idioma do
 *     `catraca-reduz-de-proposito`); um marcador dentro de uma STRING também "isenta" mas fica visível no
 *     diff pro auditor — mesmo modelo de ameaça aceito nos guards irmãos. A decisão fonte×teste em si não
 *     lê conteúdo (é por caminho de arquivo), então não há "padrão em string" a burlar além do opt-out —
 *     e o opt-out só conta se ACRESCENTADO neste diff (CC-02), não herdado.
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: resolve companheiro por CAMINHO/nome de arquivo no diff do git,
 *     não segue import, resolve módulo, nem segue junction/symlink.
 *   BANCA: BASELINE — NÃO SE APLICA: a "base" é o commit-base do git (`--base`), não um arquivo/allowlist
 *     editável no repo.
 *   BANCA: RENOMEAR — TRATADA (com limite declarado): usa `arquivosMudados` rename-aware (`-M`); a fonte
 *     renomeada é vista pelo caminho NOVO, e um companheiro co-renomeado/tocado junto é reconhecido
 *     (self-test). O COMPANHEIRO renomeado pra fora da convenção, mantendo a fonte no mesmo nome, agora
 *     TAMBÉM é pego (CC-08: candidato checado contra a base). Limite que sobra: companheiro que NÃO
 *     acompanha o rename da FONTE — ver "O QUE NÃO VÊ" (c) (declarado, não escondido).
 *   BANCA: INVISÍVEL — NÃO SE APLICA: resolução por comparação exata de caminho (Set do índice/base do
 *     git), não por conteúdo textual; caminho acentuado não é mais invisível (CC-03, corrigido na base
 *     git-base.mjs — `core.quotePath=false` em todo `git diff`/`git ls-files`/`git ls-tree` deste arquivo).
 *   BANCA: VAZIO — TRATADA: `mudancas` vazio (nenhuma fonte que já existia na base mudou, ex.: só teste
 *     mudou, ou só fonte NOVA mudou) → julgamento `ok` trivialmente.
 *   BANCA: NULO — TRATADA: `acharCompanheiro` devolve `null` quando nenhum candidato existe (índice nem
 *     base); `julgar` trata `null` explicitamente como "fonte sem companheiro, não flagra" — nunca
 *     confundido com "companheiro existe e não mudou".
 *   BANCA: SUBSTITUIR — TRATADA no self-test: o julgamento "companheiro mudou" vem do diff de um repo git
 *     REAL (fonte e teste editados de verdade, commitados/staged), não de um mock/stub da decisão.
 *   BANCA: TRUNCADO/TAMANHO — NÃO SE APLICA: não mede nem trunca tamanho de arquivo.
 *   BANCA: ORDEM/AMBIGUIDADE (múltiplos candidatos existentes) — TRATADA, com caso (CC-07): quando mais
 *     de um candidato existe (ex.: `<base>.test.mjs` no mesmo dir E `tests/.../<base>.test.mjs` ao mesmo
 *     tempo), a resolução é DETERMINÍSTICA — sempre o primeiro da ordem declarada (mesmo dir > tests/<rel>
 *     > __tests__/) — provado por caso, não só declarado.
 *
 * CONTRA-PROVA: node scripts/guards/cochange-companion.mjs --self-test — repo git real: muda só a fonte
 *   com companheiro existente e parado → reprova; muda os dois → ok; fonte sem companheiro → ok; só o
 *   teste muda → ok; rename da fonte com companheiro renomeado+tocado junto → ok; opt-out ACRESCENTADO no
 *   diff → ok; opt-out HERDADO da base → reprova; fonte deletada → ok; fonte NOVA → ok; caminho acentuado
 *   → reprova (não some mais); companheiro renomeado pra fora da convenção → reprova; opt-out/deleção só
 *   no working tree (não staged) → ainda reprova; branch órfã sem merge-base → exit 2; repo sem commit →
 *   exit 0 NAO_APLICAVEL; fora de repo/sem base/base inexistente → exit 2.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
import { git, existeNaBase, marcadorAdicionadoNoDiff, arquivosMudados, baseDaEsteira, temHead, refExiste, repoRaiz } from '../lib/git-base.mjs';
import { stackDoProjeto } from '../lib/stack.mjs';

export const NOME = 'cochange-companion';
const EXTS_CANONICAS = ['mjs', 'cjs', 'js', 'jsx', 'ts', 'tsx', 'mts', 'cts'];
const RE_CODIGO = new RegExp(`\\.(?:${EXTS_CANONICAS.join('|')})$`, 'i');
// Fonte NÃO é arquivo de teste: nem sufixo *.test.<ext>/*.spec.<ext>, nem caminho sob tests/ ou __tests__/.
const RE_SUFIXO_TESTE = new RegExp(`(?:^|/)[^/]*\\.(?:test|spec)\\.(?:${EXTS_CANONICAS.join('|')})$`, 'i');
const RE_DIR_TESTE = /(?:^|\/)(?:tests|__tests__)\//i;
// Opt-out por-fonte (mesmo idioma do `catraca-reduz-de-proposito`/`divida-de-proposito`): refactor puro
// sem mudança de comportamento isenta AQUELA fonte de exigir o companheiro no mesmo diff — mas só se o
// marcador foi ACRESCENTADO neste diff (decisão do coordenador, CC-02); herdado da base não isenta.
export const MARCADOR_OPTOUT = 'cochange-de-proposito';

/** FUNÇÃO PURA: é arquivo de teste (não precisa de companheiro, não conta como fonte)? */
export function ehArquivoDeTeste(caminho) {
  const p = String(caminho ?? '').replaceAll('\\', '/');
  return RE_SUFIXO_TESTE.test(p) || RE_DIR_TESTE.test(p);
}

function partesCaminho(caminho) {
  const norm = String(caminho ?? '').replaceAll('\\', '/');
  const i = norm.lastIndexOf('/');
  const dir = i === -1 ? '' : norm.slice(0, i);
  const nome = i === -1 ? norm : norm.slice(i + 1);
  const j = nome.lastIndexOf('.');
  const base = j === -1 ? nome : nome.slice(0, j);
  const ext = j === -1 ? '' : nome.slice(j + 1).toLowerCase();
  return { dir, base, ext };
}

function extsPriorizadas(extAtual) {
  const outras = EXTS_CANONICAS.filter((e) => e !== extAtual);
  return extAtual && EXTS_CANONICAS.includes(extAtual) ? [extAtual, ...outras] : EXTS_CANONICAS;
}

/**
 * FUNÇÃO PURA: candidatos de companheiro por NOME, na ordem de prioridade (ver certidão "O QUE FAZ").
 * Não toca fs/git — devolve só os caminhos a testar; quem existe é responsabilidade do chamador.
 * Decisão do coordenador (CC-01): SEM candidato "tests/<base>.test.<ext>" na raiz — colidia com
 * qualquer basename de qualquer diretório/extensão do repo (removido, não restringido).
 */
export function acharCandidatosCompanheiro(caminhoFonte) {
  const { dir, base, ext } = partesCaminho(caminhoFonte);
  const exts = extsPriorizadas(ext);
  const candidatos = [];
  // 1. mesmo diretório: <base>.test.<ext> / <base>.spec.<ext>
  for (const sufixo of ['test', 'spec']) {
    for (const e of exts) candidatos.push(dir ? `${dir}/${base}.${sufixo}.${e}` : `${base}.${sufixo}.${e}`);
  }
  // 2. tests/<caminho relativo sem o 1º segmento "src">/<base>.test.<ext>
  let relDir = dir;
  if (relDir === 'src') relDir = '';
  else if (relDir.startsWith('src/')) relDir = relDir.slice(4);
  const dirTests = relDir ? `tests/${relDir}` : 'tests';
  for (const e of exts) candidatos.push(`${dirTests}/${base}.test.${e}`);
  // 3. __tests__/<base>.test.<ext> no mesmo diretório
  const dirDunder = dir ? `${dir}/__tests__` : '__tests__';
  for (const e of exts) candidatos.push(`${dirDunder}/${base}.test.${e}`);
  return candidatos;
}

/**
 * FUNÇÃO PURA: primeiro candidato que EXISTE (ordem = prioridade); null se nenhum.
 * `existeAtualFn` checa o ÍNDICE (o que vai ser commitado); `existeBaseFn` (opcional, default sempre
 * falso) checa a BASE — usado só pra achar um companheiro que existia lá e sumiu da convenção no diff
 * (renomeado/apagado — CC-08). Prioriza o ÍNDICE: só cai pra BASE se nenhum candidato existir no índice.
 */
export function acharCompanheiro(caminhoFonte, existeAtualFn, existeBaseFn = () => false) {
  const candidatos = acharCandidatosCompanheiro(caminhoFonte);
  for (const c of candidatos) if (existeAtualFn(c)) return c;
  for (const c of candidatos) if (existeBaseFn(c)) return c;
  return null;
}

/**
 * FUNÇÃO PURA: julga cada mudança {arquivo, companheiro, companheiroMudou, optOutAdicionado}.
 * companheiro === null → fonte sem companheiro, não flagra. optOutAdicionado (marcador ACRESCENTADO
 * neste diff, não herdado — CC-02) isenta.
 */
export function julgar(mudancas) {
  const problemas = [];
  for (const m of mudancas) {
    if (!m.companheiro) continue; // sem candidato (índice ou base) — não é deste guard
    if (m.optOutAdicionado) continue; // isenção declarada NESTE diff (não herdada) e auditável
    if (!m.companheiroMudou) {
      problemas.push({
        tipo: 'companheiro-nao-mudou',
        arquivo: m.arquivo,
        detalhe: `fonte mudou, mas o companheiro ${m.companheiro} não mudou no mesmo diff (nem por rename)`,
      });
    }
  }
  return { ok: problemas.length === 0, problemas };
}

/**
 * Coleta as fontes mudadas vs a base (git) que JÁ EXISTIAM na base (CC-09) e resolve o companheiro de
 * cada uma contra o ÍNDICE do git, com fallback pra BASE (CC-08). Lê SÓ o que vai ser commitado — índice,
 * nunca o disco (CC-05/CC-06): `git ls-files` (índice atual) e `git ls-tree -r --name-only <base>` (o
 * que existia na base), cada um UMA vez por chamada (não por candidato/fonte).
 */
export function medir({ repo, base }) {
  const mudados = arquivosMudados(base, repo); // [{path, old}]
  const mudadosSet = new Set(mudados.map((e) => e.path));
  const indice = new Set(git(['ls-files'], repo).split('\n').filter(Boolean));
  const naBase = new Set(git(['ls-tree', '-r', '--name-only', base], repo).split('\n').filter(Boolean));
  const fontes = mudados.filter((e) =>
    RE_CODIGO.test(e.path) &&
    !ehArquivoDeTeste(e.path) &&
    indice.has(e.path) && // não está no índice (deletada de verdade) → não exige companheiro (NUNCA BLOQUEIA #5)
    existeNaBase(base, e.old || e.path, repo) // CC-09: só fonte que já existia na base (pelo nome antigo, se rename) é julgada
  );
  const mudancas = [];
  for (const e of fontes) {
    const companheiro = acharCompanheiro(e.path, (c) => indice.has(c), (c) => naBase.has(c));
    const companheiroMudou = companheiro ? mudadosSet.has(companheiro) : false;
    const optOutAdicionado = companheiro
      ? marcadorAdicionadoNoDiff({ base, path: e.path, old: e.old, marcador: MARCADOR_OPTOUT, repo })
      : false;
    mudancas.push({ arquivo: e.path, companheiro, companheiroMudou, optOutAdicionado });
  }
  return { mudancas, julgamento: julgar(mudancas) };
}

function main() {
  const argv = process.argv.slice(2);
  const flagBase = (() => { const i = argv.indexOf('--base'); return i >= 0 ? argv[i + 1] : undefined; })();
  const repo = repoRaiz(process.cwd());
  if (!repo) { console.error(`[${NOME}] NÃO MEDIU: não estou num repositório git.`); process.exitCode = 2; return; }
  // R6 (2026-09-11): projeto declarado "stack":"python" não tem convenção JS/TS pra este guard medir —
  // NAO_APLICAVEL exit 0, ANTES de qualquer outra regra.
  let stack;
  try { stack = stackDoProjeto(repo); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; return; }
  if (stack === 'python') { console.log(`[${NOME}] NAO_APLICAVEL: projeto declarado python no esteira.json — este guard só mede convenção de teste JS/TS.`); process.exitCode = 0; return; }
  const base = flagBase || baseDaEsteira(repo);
  if (!base) { console.error(`[${NOME}] NÃO MEDIU: informe --base <ref> (ou rode num projeto com esteira.json).`); process.exitCode = 2; return; }
  if (!temHead(repo)) { console.log(`[${NOME}] NAO_APLICAVEL: repositório ainda sem commit (primeiro commit).`); process.exitCode = 0; return; }
  if (!refExiste(base, repo)) { console.error(`[${NOME}] NÃO MEDIU: a base "${base}" não existe — git fetch primeiro.`); process.exitCode = 2; return; }
  let resultado;
  try { resultado = medir({ repo, base }); }
  catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; return; }
  const { mudancas, julgamento } = resultado;
  const comCompanheiro = mudancas.filter((m) => m.companheiro).length;
  console.log(`[${NOME}] base ${base} · ${mudancas.length} fonte(s) avaliada(s) (já existiam na base) · ${comCompanheiro} com companheiro resolvido no diff`);
  if (julgamento.ok) { console.log(`[${NOME}] ✅ nenhuma fonte mudou sem o companheiro mudar junto.`); process.exitCode = 0; return; }
  for (const p of julgamento.problemas) console.error(`[${NOME}] FALHA (${p.tipo}): ${p.arquivo} — ${p.detalhe}`);
  console.error(
    `[${NOME}] COMO PASSAR: toque o(s) companheiro(s) listado(s) acima no mesmo commit/diff (mesmo que só ` +
    `pra confirmar que o comportamento continua coberto), ou — se for MESMO refactor puro sem mudança de ` +
    `comportamento — ACRESCENTE (neste diff) o comentário \`// ${MARCADOR_OPTOUT}: <motivo>\` na fonte (um ` +
    `marcador HERDADO de commits antigos não isenta). NUNCA use --no-verify.`,
  );
  console.error(`[${NOME}] POR QUE EXISTE: mudou a fonte, mexeu no teste — companheiro parado é comportamento novo sem re-prova.`);
  process.exitCode = 1;
}

// ─── entrypoint: --self-test importa a suíte de scripts/guards/selftest/ (R6, 2026-09-11 — reconciliação
// que tirou este guard de cima do teto de 600 linhas visuais) ──────────────────────────────────────────
// SEM top-level await de propósito: a suíte importa este mesmo arquivo por caminho relativo
// ('../cochange-companion.mjs') — um `await import(...)` aqui em cima trava o ciclo (módulo ainda
// "evaluating" quando a suíte tenta linká-lo de volta; Node sai com "unsettled top-level await", exit
// 13). Com `.then()` a avaliação síncrona deste arquivo termina primeiro; o import dinâmico só roda
// depois, sem ciclo pendente — mesma saída/exit code de antes.
if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) {
    import('./selftest/cochange-companion.mjs')
      .then(({ selfTest }) => selfTest())
      .catch((e) => {
        console.error(`[${NOME}] NÃO MEDIU: falha ao carregar a suíte de self-test: ${e?.message || e}`);
        process.exitCode = 2;
      });
  } else {
    main();
  }
}
