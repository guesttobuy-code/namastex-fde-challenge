#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: mudar a SUPERFÍCIE PÚBLICA de um módulo (o barrel `index.*`, ou um arquivo que ele
 * RE-EXPORTA) parece local mas quebra quem depende dela sem que ninguém rode o teste que pegaria a quebra. A
 * catraca: superfície de A mudou no diff (medida na BASE **e** no HEAD) → todo módulo B que depende de A
 * precisa de um TESTE de B no MESMO diff.
 *
 * INCIDENTE DE ORIGEM: preventivo — decisão do dono 2026-09-11 (ADR-0003, #21).
 *
 * O QUE FAZ: lê `.arch-layers.json` (`lerArchLayers`, importes.mjs). Sem `modulos.raiz` (config ausente)
 * → NAO_APLICAVEL. Com `modulos.raiz` configurado, DOIS estados que a 2ª rodada da issue #21 separou
 * (antes colapsados num só): a PASTA não existe no repo → NÃO MEDIU (exit 2, nunca ✅ mudo — F4: é
 * config errada/typo, não dá pra confiar em "zero módulos"); a PASTA EXISTE mas ainda não tem NENHUMA
 * subpasta (vazia, ou só arquivo solto tipo `.gitkeep`) → NAO_APLICAVEL (exit 0: "projeto ainda sem
 * módulos em `<raiz>` — nada a medir até o primeiro módulo" — é o estado normal de um projeto recém-
 * bootstrapado, não um sintoma de config quebrada). Só com ≥1 subpasta real sob `modulos.raiz` o guard
 * mede de fato. Módulos IMPACTADOS = união de (a) barrel entre os `arquivosMudados` (caminho ATUAL OU ANTERIOR a um rename, sem
 * diferenciar caixa — F1/F7; opt-out `impacto-de-proposito` só isenta se ACRESCENTADO NESTE diff via
 * `marcadorAdicionadoNoDiff` — herdado da base NÃO isenta, F3); e (b) módulos cujo barrel RE-EXPORTA (`export
 * … from`/`export * from`, direto ou em cascata) um arquivo que mudou — a superfície real, não só o texto do
 * barrel (F5). O GRAFO entre módulos é a UNIÃO das arestas medidas no HEAD e na árvore da BASE (merge-base) —
 * um dependente só visível numa das duas (barrel deletado ou renomeado pra extensão que o import antigo não
 * resolve) continua cobrado (F1). Exige, por dependente B, um teste (`*.test.*`/`*.spec.*`, extensão de
 * código) sob `<modulos.raiz>/<B>/`, PRESENTE no índice (não deletado — F2/F9), entre os arquivos mudados.
 *
 * O QUE NUNCA MAIS PODE PASSAR: 1. superfície de A muda (barrel mudado/deletado/renomeado, ou arquivo por ele
 * re-exportado muda) e NENHUM módulo B que depende de A tem teste no diff; 2. teste DELETADO, sem extensão de
 * código, ou teste que mora na pasta do módulo IMPACTADO (não do dependente) contarem como "prova"; 3. opt-out
 * HERDADO da base (não acrescentado NESTE diff) isentar uma mudança real.
 *
 * O QUE NUNCA PODE BLOQUEAR: 1. arquivo INTERNO que não é o barrel e que o barrel NÃO re-exporta (só import
 * comum, nunca `export … from`); 2. módulo impactado SEM dependentes; 3. teste de cada dependente no MESMO
 * diff; 4. opt-out ACRESCENTADO nesta mudança (marcador que já estava lá antes NÃO conta); 5. projeto sem
 * `.arch-layers.json`/`modulos.raiz` — NAO_APLICAVEL; 6. `modulos.raiz` que EXISTE mas ainda não tem
 * nenhum módulo (projeto node recém-bootstrapado, pasta plantada vazia) — NAO_APLICAVEL, não NÃO MEDIU
 * (2ª rodada da issue #21: travar o pre-commit de todo projeto novo nesse estado é bloquear o inocente).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) import por ALIAS/path mapeado de TS — `resolverImport` só resolve
 * `./`/`../` (limite do dono, importes.mjs); (b) especificador dinâmico não-literal (`import(x+'/y')`), mesmo
 * limite herdado; (c) se o TESTE do dependente REALMENTE exercita a quebra — só exige que EXISTA (isso é
 * `companion-red-green`/auditor humano); (d) `.arch-layers.json` mudar NO MESMO diff pra se auto-isentar — sem
 * trava anti-auto-isenção da própria config; (e) fecho de re-export só reconhece a forma de UMA LINHA
 * (`export`+`from` na mesma linha do despido) — multi-linha SUBESTIMA o grafo, nunca superestima uma aprovação
 * por cima de violação real; (f) dependência TRANSITIVA entre módulos (B depende de C que depende de A) — só a
 * aresta DIRETA conta (evita falso-positivo quando C já é dono do teste); (g) CONSUMIDOR fora de
 * `modulos.raiz` (app/rotas/composição) nunca entra no grafo — limite DECLARADO (decisão do coordenador, F8 da
 * rodada 1 de auditoria). (h) CÓDIGO PYTHON (R6, 2026-09-11) — este guard só lê JS/TS; num projeto com
 * "stack": "python" em esteira.json ele sai NAO_APLICAVEL (exit 0), ANTES até de checar `.arch-layers.json`.
 *
 * MODO DE FALHA JÁ ESCAPADO (rodada 1 de auditoria adversarial, 2026-09-11 — `_veredito.json`):
 *   F1  grafo só via a árvore PÓS-mudança: deletar/renomear (até só a EXTENSÃO, `.mjs`→`.ts`) o barrel escondia o dependente do grafo e o guard dava ✅.
 *   F2  teste DELETADO, arquivo `.md` com ".test." no nome, e teste na pasta do módulo IMPACTADO contavam como prova de que o dependente sobrevive.
 *   F3  opt-out commitado há tempos isentava PRA SEMPRE toda mudança seguinte do barrel.
 *   F4  `modulos.raiz` com erro de digitação (ou "./" na frente) dava ✅ mudo em vez de NÃO MEDIU.
 *   F5  renomear/remover um export dentro de arquivo RE-EXPORTADO pelo barrel quebrava o dependente com o TEXTO do barrel intocado — o guard não via.
 *   F6  `index.*` numa SUBPASTA interna do módulo reprovava como se fosse o barrel.
 *   F7  rename do barrel só de CAIXA (`index.mjs`→`Index.mjs`, que em FS case-insensitive resolve o MESMO import do dependente) escapava da detecção.
 *   F8  consumidor fora de `modulos.raiz` nunca cobrado — não estava declarado em "O QUE NÃO VÊ".
 *   F9  no pre-commit, conteúdo/opt-out lidos do DISCO (não do ÍNDICE) — podiam divergir do commit real.
 *   F10 certidão sem a linha "INCIDENTE DE ORIGEM" exigida pelo COMO-CRIAR-GUARD.
 *   F11 nasceu sem cabeamento (fora de `GUARDS_ESPERADOS`/`package.json`) — modo nº 1.
 *   F12 (2ª rodada, medição de 2026-09-11 — issue #21) `raizTemModulo` colapsava "pasta ausente" (config
 *       errada/typo) e "pasta existe mas vazia" (projeto novo, sem módulo ainda) no MESMO NÃO MEDIU. Com o
 *       bootstrap passando a plantar `<modulos.raiz>/.gitkeep`, todo projeto node recém-criado nascia
 *       travado no NÃO MEDIU do 1º commit — o F4 original mirava config quebrada, não projeto legítimo sem
 *       módulos ainda. Corrigido: `raizExiste` (config errada) separado de `raizTemModulo` (sem módulo
 *       ainda, agora NAO_APLICAVEL).
 *
 * BANCA — as 10 classes: STRING/COMENTÁRIO TRATADA (imports via `acharImports` sobre código DESPIDO; opt-out
 * via `marcadorAdicionadoNoDiff`, textual de propósito, mesmo idioma dos ratchets-irmãos); IMPORT/PATH PARCIAL
 * (limite (a)/(b); junction/symlink NÃO SE APLICA — `moduloDe` é textual sobre o caminho relativo à raiz);
 * BASELINE NÃO SE APLICA-PARCIAL (só `.arch-layers.json`, arquitetura declarada do projeto — limite (d));
 * RENOMEAR TRATADA (F1/F7: `ehBarrelDoModulo` checado no caminho ATUAL e no ANTERIOR, sem diferenciar caixa,
 * grafo BASE∪HEAD); INVISÍVEL TRATADA (`.includes()` de um marcador exato — falha FECHADO, caso no self-test
 * com repo real); VAZIO TRATADA (sem mudança → ok; barrel DELETADO ainda impacta — mede o CAMINHO, não o
 * conteúdo); NULO TRATADA (`moduloDe`/`resolverImport` null → fora da análise, nunca "sem violação" indevida);
 * SUBSTITUIR TRATADA (PORTA roda `--self-test` como processo separado, `spawnSync`, contra repo git real);
 * TRUNCADO/TAMANHO NÃO SE APLICA (`readFileSync` lê o arquivo inteiro; falha de leitura subestima o grafo,
 * nunca infla).
 *
 * CONTRA-PROVA: node scripts/guards/cross-module-impact.mjs --self-test (suíte em
 * scripts/guards/selftest/cross-module-impact.mjs)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
import { git, arquivosMudados, baseDaEsteira, temHead, refExiste, repoRaiz, conteudoNaBase, marcadorAdicionadoNoDiff } from '../lib/git-base.mjs';
import { listarCodigo, acharImports, resolverImport, lerArchLayers, moduloDe, ehBarrelDoModulo, RE_EXT_CODIGO, casaGlob } from '../lib/importes.mjs';
import { despirCodigo } from '../lib/despir-codigo.mjs';
import { stackDoProjeto } from '../lib/stack.mjs';

// NOME/MARCADOR_OPTOUT exportados: dono único (LEI 11) — o companheiro de self-test
// (scripts/guards/selftest/cross-module-impact.mjs) importa os dois em vez de duplicar os literais.
export const NOME = 'cross-module-impact';
export const MARCADOR_OPTOUT = 'impacto-de-proposito'; // opt-out por-módulo, NO BARREL (idioma divida-de-proposito)
// Teste: ".test."/".spec." + extensão de CÓDIGO (reusa RE_EXT_CODIGO, dono importes.mjs — F2: ".test.md" não roda).
const RE_TESTE = new RegExp(`(?:^|/)[^/]+\\.(?:test|spec)${RE_EXT_CODIGO.source}`, 'i');

// Normaliza `modulos.raiz`: "\\"→"/", tira "./" da frente e "/" do fim (F4: "./src/modules" tinha que
// casar igual a "src/modules" — caminhos do git nunca têm "./"). Local: mudar importes.mjs (o dono) está
// fora do escopo desta reconciliação — ver notas.
function normalizarRaiz(raiz) {
  return String(raiz ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

// `<repo>/<raiz>` existe (pasta ou arquivo, tanto faz — só "existe alguma coisa nesse caminho")? Raiz
// AUSENTE é config errada/typo (F4 original) — continua NÃO MEDIU. Issue #21 (2ª rodada, decisão do
// coordenador): distinto de "existe mas ainda não tem módulo", que deixou de ser NÃO MEDIU — ver
// `raizTemModulo` logo abaixo.
function raizExiste(repo, raiz) {
  if (!raiz) return false;
  return existsSync(join(repo, raiz));
}

// `<repo>/<raiz>` (que já existe — chamar só depois de `raizExiste`) tem ≥1 subpasta (um módulo real)?
// Raiz existente mas SEM subpasta (vazia, ou só arquivos soltos como `.gitkeep`) é projeto novo
// LEGÍTIMO — não é mais NÃO MEDIU (era, antes da 2ª rodada da issue #21: travava o pre-commit de todo
// projeto node recém-bootstrapado, que nasce com `src/modules/.gitkeep` e nenhum módulo ainda). Quem
// chama trata `false` aqui como NAO_APLICAVEL, não como erro de config — isso já foi filtrado por
// `raizExiste`.
function raizTemModulo(repo, raiz) {
  try { return readdirSync(join(repo, raiz), { withFileTypes: true }).some((d) => d.isDirectory()); }
  catch { return false; }
}

// `caminho` está NO ÍNDICE (staged)? Reimplementação LOCAL do `existeNoIndex` privado de git-base.mjs (o
// dono não exporta; exportar está fora do escopo — ver notas). Usa o `git()` já com quotePath/env corretos.
function existeNoIndiceLocal(caminho, repo) {
  try { git(['cat-file', '-e', `:${caminho}`], repo); return true; } catch { return false; }
}

// Local (F7): mesma forma de `ehBarrelDoModulo` (dono, exatamente <raiz>/<modulo>/<barrel>), mas SEM
// diferenciar caixa — em FS case-insensitive um rename só de CAIXA ainda resolve o mesmo import. Tenta o
// dono primeiro; só cai no fallback pra cobrir a caixa. Mudar o dono está fora do escopo — ver notas.
function ehBarrelDoModuloCI(caminho, cfg) {
  if (ehBarrelDoModulo(caminho, cfg)) return true;
  const raizMod = cfg?.modulos?.raiz;
  if (!raizMod) return false;
  const pref = `${raizMod.replace(/\/+$/, '')}/`;
  if (!caminho.startsWith(pref)) return false;
  const resto = caminho.slice(pref.length).split('/');
  if (resto.length !== 2) return false;
  const b = cfg?.modulos?.barrel ?? ['index.mjs', 'index.js', 'index.ts', 'index.tsx', 'index.jsx'];
  const nomes = (Array.isArray(b) ? b : [b]).map((n) => String(n).toLowerCase());
  return nomes.includes(resto[1].toLowerCase());
}

// FUNÇÃO PURA: módulos cujo BARREL (caminho ATUAL `m.arquivo` OU ANTERIOR `m.old`, sem caixa — F7) está
// entre `mudancas` [{arquivo, old?, optoutAdicionado}]; `optoutAdicionado` já vem resolvido por quem
// chama (via `marcadorAdicionadoNoDiff`, que precisa de git — por isso fora, função sem I/O).
export function acharModulosImpactados(mudancas, cfg) {
  const impactados = new Set();
  for (const m of mudancas) {
    const viaAtual = ehBarrelDoModuloCI(m.arquivo, cfg);
    const viaAntigo = m.old ? ehBarrelDoModuloCI(m.old, cfg) : false;
    if (!viaAtual && !viaAntigo) continue;
    const modulo = moduloDe(viaAtual ? m.arquivo : m.old, cfg);
    if (!modulo) continue;
    if (m.optoutAdicionado) continue; // opt-out ACRESCENTADO neste diff (F3) — herdado da base não isenta
    impactados.add(modulo);
  }
  return impactados;
}

// FUNÇÃO PURA: `caminho` é TESTE de `modulo`? Só sob a pasta OFICIAL (`<raizModulos>/<modulo>/`) — F2
// fechou os 2 atalhos que havia ("/<modulo>/" em qualquer ponto, nome-prefixo em qualquer pasta).
export function ehTesteDoModulo(caminho, modulo, raizModulos) {
  const c = String(caminho ?? '');
  if (!RE_TESTE.test(c)) return false;
  if (!raizModulos) return false;
  const pref = `${String(raizModulos).replace(/\/+$/, '')}/${modulo}/`;
  return c.startsWith(pref);
}

// FUNÇÃO PURA: julga. Todo dependente B de um A impactado precisa de teste de B no diff, EXISTENTE no
// índice (F2/F9: `m.existe !== false` — hand-built sem o campo conta como existente).
export function julgar({ modulosImpactados, grafo, mudancas, cfg }) {
  const raizModulos = cfg?.modulos?.raiz;
  const testesNoDiff = mudancas.filter((m) => m.existe !== false && RE_TESTE.test(m.arquivo)).map((m) => m.arquivo);
  const problemas = [];
  for (const moduloA of modulosImpactados) {
    for (const [moduloB, deps] of grafo instanceof Map ? grafo : []) {
      if (moduloB === moduloA || !deps.has(moduloA)) continue;
      const provado = testesNoDiff.some((t) => ehTesteDoModulo(t, moduloB, raizModulos));
      if (!provado) {
        problemas.push({
          tipo: 'dependente-nao-provado',
          moduloImpactado: moduloA,
          moduloDependente: moduloB,
          detalhe: `barrel/superfície de "${moduloA}" mudou; módulo "${moduloB}" depende de "${moduloA}" e nenhum teste de "${moduloB}" está no diff`,
        });
      }
    }
  }
  return { ok: problemas.length === 0, problemas };
}

// Grafo de dependência ENTRE MÓDULOS a partir da árvore de `repo` (real, ou a BASE materializada — ver
// `materializarArvoreBase`): B → Set(módulos dos quais B importa).
export function construirGrafoModulos(repo, cfg) {
  const grafo = new Map();
  const arquivos = listarCodigo(repo, { ignorar: cfg?.ignorar });
  for (const arquivo of arquivos) {
    const moduloB = moduloDe(arquivo, cfg);
    if (!moduloB) continue;
    let fonte;
    try { fonte = readFileSync(join(repo, arquivo), 'utf8'); } catch { continue; } // ignora-de-proposito: arquivo sumiu entre listar e ler
    for (const imp of acharImports(fonte)) {
      const resolvido = resolverImport(imp.especificador, arquivo, repo);
      if (!resolvido) continue;
      const moduloA = moduloDe(resolvido, cfg);
      if (!moduloA || moduloA === moduloB) continue;
      if (!grafo.has(moduloB)) grafo.set(moduloB, new Set());
      grafo.get(moduloB).add(moduloA);
    }
  }
  return grafo;
}

// FUNÇÃO PURA: une 2 grafos — a aresta entra se existia em QUALQUER um (F1: BASE ou HEAD). null/não-Map
// é ignorado (BANCA NULO), não lança.
export function unirGrafos(a, b) {
  const grafo = new Map();
  const adicionar = (m) => {
    if (!(m instanceof Map)) return;
    for (const [k, deps] of m) {
      if (!grafo.has(k)) grafo.set(k, new Set());
      for (const d of deps) grafo.get(k).add(d);
    }
  };
  adicionar(a); adicionar(b);
  return grafo;
}

// Especificadores que `fonte` RE-EXPORTA (linha começa com `export`, no despido, forma `from`). Um
// `import { a } from 'x'` comum (interno) fica de fora — é a distinção que separa "interno, nunca
// bloqueia" de "superfície pública" (F5). Limite (e): só a forma de UMA linha (export+from juntos).
function especificadoresReexport(fonte) {
  const desp = despirCodigo(fonte);
  const linhasDesp = desp.split('\n');
  const out = [];
  for (const imp of acharImports(fonte)) {
    if (imp.forma !== 'from') continue;
    const textoLinha = linhasDesp[imp.linha - 1] || '';
    if (/^\s*export\b/.test(textoLinha)) out.push(imp.especificador);
  }
  return out;
}

// Fecho de arquivos que `barrelPath` re-exporta, direta/transitivamente (F5) — a superfície pública real,
// não só o texto do barrel. Inclui o próprio `barrelPath`.
function fechoSuperficiePublica(barrelPath, repo) {
  const vistos = new Set([barrelPath]);
  const fila = [barrelPath];
  while (fila.length) {
    const atual = fila.shift();
    let fonte;
    try { fonte = readFileSync(join(repo, atual), 'utf8'); } catch { continue; } // ignora-de-proposito: arquivo sumiu
    for (const esp of especificadoresReexport(fonte)) {
      const resolvido = resolverImport(esp, atual, repo);
      if (resolvido && !vistos.has(resolvido)) { vistos.add(resolvido); fila.push(resolvido); }
    }
  }
  return vistos;
}

// Caminho do barrel de `modulo` sob `raizMod` no HEAD (1º nome de `cfg.modulos.barrel` que existir), ou
// null se o módulo ainda não tem barrel.
function acharBarrelDoModulo(repo, raizMod, modulo, cfg) {
  const b = cfg?.modulos?.barrel ?? ['index.mjs', 'index.js', 'index.ts', 'index.tsx', 'index.jsx'];
  for (const nome of (Array.isArray(b) ? b : [b])) {
    const rel = `${raizMod}/${modulo}/${nome}`;
    if (existsSync(join(repo, rel))) return rel;
  }
  return null;
}

// Módulos cujo barrel NÃO mudou, mas cuja SUPERFÍCIE (fecho de re-export) contém um arquivo em `mudancas`
// (F5). Lê disco — não é pura como `acharModulosImpactados`, é orquestração chamada por `medir`.
export function modulosImpactadosPorReexport(mudancas, cfg, repo) {
  const raizMod = cfg?.modulos?.raiz;
  const impactados = new Set();
  if (!raizMod) return impactados;
  const caminhosMudados = new Set(mudancas.flatMap((m) => [m.arquivo, m.old].filter(Boolean)));
  let entradas;
  try { entradas = readdirSync(join(repo, raizMod), { withFileTypes: true }); } catch { return impactados; }
  for (const d of entradas) {
    if (!d.isDirectory()) continue;
    const modulo = d.name;
    const barrel = acharBarrelDoModulo(repo, raizMod, modulo, cfg);
    if (!barrel) continue;
    const fecho = fechoSuperficiePublica(barrel, repo);
    fecho.delete(barrel); // o barrel em si já é coberto por acharModulosImpactados
    if ([...fecho].some((f) => caminhosMudados.has(f))) impactados.add(modulo);
  }
  return impactados;
}

// Arquivos de código sob `ref` (git ls-tree, não o disco), mesma peneira de `listarCodigo` (extensão +
// `cfg.ignorar`) contra uma árvore git.
function listarCodigoNaRef(ref, repo, cfg) {
  const ignorar = cfg?.ignorar || [];
  const saida = git(['ls-tree', '-r', '--name-only', ref], repo);
  return saida.split('\n').filter(Boolean).filter((p) => RE_EXT_CODIGO.test(p) && !ignorar.some((g) => casaGlob(p, g)));
}

// Materializa a árvore de `ref` num dir temp (mesma estrutura relativa), pra `construirGrafoModulos`
// (`resolverImport` precisa de arquivos DE VERDADE no disco) medir a BASE sem tocar o worktree real (F1:
// sem checkout/worktree add — só leitura via `conteudoNaBase`). Quem chama faz `rmSync`.
function materializarArvoreBase(ref, repo, cfg) {
  const dir = mkdtempSync(join(tmpdir(), 'cmi-base-'));
  for (const arq of listarCodigoNaRef(ref, repo, cfg)) {
    const destino = join(dir, arq);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, conteudoNaBase(ref, arq, repo));
  }
  return dir;
}

// Junta tudo: cfg, mudanças, módulos impactados, grafo (união BASE∪HEAD), julgamento. naoAplicavel: sem
// cfg/modulos.raiz. naoMediu: modulos.raiz configurado mas sem pasta real (F4) — nunca "mede zero e ok".
export function medir({ repo, base }) {
  const cfg = lerArchLayers(repo); // JSON inválido LANÇA — main() trata como NÃO MEDIU
  if (!cfg || !cfg?.modulos?.raiz) return { naoAplicavel: true };
  const raizOriginal = cfg.modulos.raiz;
  const raiz = normalizarRaiz(raizOriginal);
  cfg.modulos.raiz = raiz;
  if (!raizExiste(repo, raiz)) {
    return { naoMediu: true, motivo: `modulos.raiz="${raizOriginal}" (normalizado: "${raiz}") não casa com nenhuma pasta sob o repo` };
  }
  if (!raizTemModulo(repo, raiz)) {
    return { naoAplicavel: true, motivo: `projeto ainda sem módulos em "${raiz}" — nada a medir até o primeiro módulo` };
  }
  const mudadosRaw = arquivosMudados(base, repo);
  const mudancas = mudadosRaw.map((e) => ({
    arquivo: e.path,
    old: e.old,
    existe: existeNoIndiceLocal(e.path, repo),
    optoutAdicionado: marcadorAdicionadoNoDiff({ base, path: e.path, old: e.old, marcador: MARCADOR_OPTOUT, repo }),
  }));
  const modulosImpactados = new Set([
    ...acharModulosImpactados(mudancas, cfg),
    ...modulosImpactadosPorReexport(mudancas, cfg, repo),
  ]);
  let grafo = new Map();
  if (modulosImpactados.size > 0) {
    const grafoHead = construirGrafoModulos(repo, cfg);
    let tmpBase;
    try {
      const mb = git(['merge-base', base, 'HEAD'], repo);
      tmpBase = materializarArvoreBase(mb, repo, cfg);
      grafo = unirGrafos(grafoHead, construirGrafoModulos(tmpBase, cfg));
    } finally {
      if (tmpBase) { try { rmSync(tmpBase, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ } }
    }
  }
  const julgamento = julgar({ modulosImpactados, grafo, mudancas, cfg });
  return { naoAplicavel: false, mudancas, modulosImpactados, grafo, julgamento };
}

function main() {
  const argv = process.argv.slice(2);
  const flagBase = (() => { const i = argv.indexOf('--base'); return i >= 0 ? argv[i + 1] : undefined; })();
  const repo = repoRaiz(process.cwd());
  if (!repo) { console.error(`[${NOME}] NÃO MEDIU: não estou num repositório git.`); process.exitCode = 2; return; }
  // R6 (2026-09-11): projeto declarado "stack":"python" não tem JS/TS pra este guard medir — NAO_APLICAVEL
  // exit 0, ANTES de qualquer outra regra (inclusive a de "sem .arch-layers.json" abaixo).
  let stack;
  try { stack = stackDoProjeto(repo); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; return; }
  if (stack === 'python') { console.log(`[${NOME}] NAO_APLICAVEL: projeto declarado python no esteira.json — este guard só mede JS/TS.`); process.exitCode = 0; return; }
  const base = flagBase || baseDaEsteira(repo);
  if (!base) { console.error(`[${NOME}] NÃO MEDIU: informe --base <ref> (ou rode num projeto com esteira.json).`); process.exitCode = 2; return; }
  if (!temHead(repo)) { console.log(`[${NOME}] NAO_APLICAVEL: repositório ainda sem commit (primeiro commit).`); process.exitCode = 0; return; }
  if (!refExiste(base, repo)) { console.error(`[${NOME}] NÃO MEDIU: a base "${base}" não existe — git fetch primeiro.`); process.exitCode = 2; return; }
  let resultado;
  try { resultado = medir({ repo, base }); }
  catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; return; }
  if (resultado.naoAplicavel) {
    console.log(`[${NOME}] NAO_APLICAVEL: ${resultado.motivo || 'sem .arch-layers.json (ou sem modulos.raiz) — este projeto não declarou cápsulas.'}`);
    process.exitCode = 0;
    return;
  }
  if (resultado.naoMediu) { console.error(`[${NOME}] NÃO MEDIU: ${resultado.motivo}`); process.exitCode = 2; return; }
  const { modulosImpactados, julgamento } = resultado;
  console.log(`[${NOME}] base ${base} · ${modulosImpactados.size} módulo(s) com superfície pública mudada no diff`);
  if (julgamento.ok) {
    console.log(`[${NOME}] ✅ todo dependente de módulo impactado tem teste no diff (ou não há dependente/impactado).`);
    process.exitCode = 0;
    return;
  }
  for (const p of julgamento.problemas) {
    console.error(`[${NOME}] FALHA (${p.tipo}): módulo "${p.moduloImpactado}" → dependente "${p.moduloDependente}" — ${p.detalhe}`);
  }
  console.error(
    `[${NOME}] COMO PASSAR: inclua no diff um teste do módulo dependente (ex.:` +
    ` <modulos.raiz>/<dependente>/<dependente>.test.mjs) provando que ele sobrevive à mudança; ou, se a` +
    ` mudança do barrel é SÓ tipo/doc sem efeito em runtime, comente no barrel "// ${MARCADOR_OPTOUT}:` +
    ` <motivo>" pra isentar o módulo. NUNCA use --no-verify.`,
  );
  console.error(
    `[${NOME}] POR QUE EXISTE: mudar a superfície pública de um módulo sem provar quem depende dele deixa` +
    ` quebra silenciosa pra quem importa esse módulo.`,
  );
  process.exitCode = 1;
}

// ─── entrypoint: --self-test importa a suíte de scripts/guards/selftest/ (PASSO 3b da reconciliação) ──
// SEM top-level await de propósito: a suíte importa este mesmo arquivo por caminho relativo
// ('../cross-module-impact.mjs') — um `await import(...)` aqui em cima trava o ciclo (módulo ainda
// "evaluating" quando a suíte tenta linká-lo de volta; Node sai com "unsettled top-level await", exit
// 13). Com `.then()` a avaliação síncrona deste arquivo termina primeiro; o import dinâmico só roda
// depois, sem ciclo pendente — mesma saída/exit code de antes, só sem o top-level await.
if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) {
    import('./selftest/cross-module-impact.mjs')
      .then(({ selfTest }) => selfTest())
      .catch((e) => {
        console.error(`[${NOME}] NÃO MEDIU: falha ao carregar a suíte de self-test: ${e?.message || e}`);
        process.exitCode = 2;
      });
  } else {
    main();
  }
}
