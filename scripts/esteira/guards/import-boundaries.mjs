#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: `.arch-layers.json` é a arquitetura-alvo DESENHADA (Clean Architecture em camadas +
 *   cápsulas de módulo) — mas sem um guard que a LEIA e trave, ela é só um documento que ninguém obedece.
 *   Um import de conveniência atravessa camada ("só essa vez, é rápido"), o domínio importa `fs` ou
 *   `express` direto, um módulo espia o arquivo interno de outro por fora do índice — e em seis meses a
 *   fronteira desenhada não existe mais no código, só no papel. Este é o MOTOR que faz `.arch-layers.json`
 *   valer de verdade: sem ele, todo outro guard de arquitetura (cross-module-impact, dead-code por camada)
 *   está julgando um mapa que o território já abandonou.
 *
 * O QUE FAZ: lê `<dir>/.arch-layers.json` (via `lerArchLayers` da lib `importes.mjs`); para cada arquivo de
 *   código sob `--dir` (ou cwd), listado por `listarCodigo` (que já respeita `cfg.ignorar`), acha os imports
 *   (`acharImports`, que opera no código DESPIDO — comentário/string não contam) e resolve os relativos a um
 *   arquivo real (`resolverImport`; só `./`/`../` resolvem — pacote/`node:`/alias é EXTERNO). Julga cada
 *   import contra 4 regras (abaixo) e reporta `arquivo:linha` + o import ofensor.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. camada-proibida: arquivo na camada A importa arquivo na camada B, e B não está em A.podeImportar
 *      (a própria camada é sempre permitida; `podeImportar: ['*']` libera tudo).
 *   2. domain-impuro: arquivo em camada com `puro:true` importa QUALQUER coisa fora da própria camada —
 *      outra camada OU pacote externo (`node:fs`, `express`, `react`…). Import relativo dentro da própria
 *      camada é ok.
 *   3. capsula-violada: arquivo de QUALQUER origem fora do módulo — outro módulo, OU fora de `modulos.raiz`
 *      inteiramente (`src/interfaces/…`, `scripts/…`) — importa arquivo de um módulo que NÃO é o barrel
 *      EXATO (`<modulos.raiz>/<módulo>/<barrel>`, `ehBarrelDoModulo` — um `index.*` de SUBPASTA interna do
 *      módulo não conta). EXCEÇÃO: a origem está numa camada com `podeImportar: ['*']` (composição/main) —
 *      decisão do coordenador, GUARDS_PARALELO.md §7.4 (IB-6). Dentro do mesmo módulo, tudo pode. Só mede
 *      se `cfg.modulos` existir; é INDEPENDENTE de a origem estar ou não numa camada nomeada.
 *   4. fora-de-camada (opcional): SÓ se a config tiver `"exigirCamadaEm": [globs]`; arquivo que casa um
 *      desses globs e não cai em nenhuma camada nasceu no lugar errado. Sem a chave, nunca dispara.
 *
 * INCIDENTE DE ORIGEM: preventivo — decisão do dono 2026-09-11 (ADR-0003, #21).
 *
 * O QUE NUNCA PODE BLOQUEAR (família de falsos-positivos):
 *   - import dentro da própria camada (sempre permitido, mesmo sem aparecer em `podeImportar`);
 *   - import de uma camada listada em `podeImportar` (inclusive `'*'`, que libera todas);
 *   - módulo que importa outro módulo PELO BARREL EXATO (`<raiz>/<módulo>/<barrel>`) — um `index.*` de
 *     SUBPASTA interna do módulo NÃO é o barrel (`ehBarrelDoModulo`) — só o interno não-barrel é
 *     capsula-violada;
 *   - import de arquivo INTERNO de outro módulo feito por uma camada com `podeImportar: ['*']`
 *     (composição/main) — decisão do coordenador (IB-6);
 *   - import de pacote externo por camada que NÃO é `puro:true`;
 *   - import relativo que NÃO resolve a um arquivo real (arquivo inexistente) — não é violação deste guard,
 *     é do dead-code/build (mas é CONTADO e IMPRESSO, nunca descartado em silêncio — IB-1);
 *   - projeto sem `.arch-layers.json` — NAO_APLICAVEL, exit 0, não NÃO MEDIU;
 *   - arquivo fora de qualquer camada quando a config NÃO tem `exigirCamadaEm` — simplesmente não é medido;
 *   - o opt-out `fronteira-de-proposito: <motivo>` — com motivo não-vazio, DENTRO de um comentário, em
 *     qualquer linha do próprio statement de import/export (inclusive multi-linha) até a linha do
 *     especificador — nunca um marcador sem motivo, dentro de string, ou num statement vizinho (decisão do
 *     coordenador #2; IB-7/IB-8).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) especificador de import que NÃO é string literal (`import(x + '/y')`,
 *   template com `${}`) — ignorado, limite da lib `importes.mjs`; (b) alias de path (`@/x`, paths do
 *   tsconfig) e pacotes (`express`, `node:fs`) são tratados como EXTERNOS — só entram na conta via
 *   domain-impuro, nunca via camada-proibida/cápsula (não têm camada/módulo pra checar); (c) import CIRCULAR
 *   dentro da mesma camada/permissão — não é o escopo (isto mede FRONTEIRA entre camadas/módulos, não ciclo);
 *   (d) a qualidade do DESENHO em `.arch-layers.json` (se os globs fazem sentido, se `puro:true` está no
 *   lugar certo) é decisão humana revisada por PR — o guard só faz cumprir o que está escrito; (e)
 *   caractere invisível (`U+200B`, etc.) no especificador quebra a RESOLUÇÃO real — não dá pra usar pra
 *   disfarçar uma violação que de fato funcionaria em runtime; MAIÚSCULA trocada e junction/symlink de
 *   diretório NÃO são mais um limite — `resolverImport` segue `realpathSync.native` (IB-3, corrigido na
 *   lib em R1); (f) `node_modules` nunca é escaneado (fora do escopo de código do projeto, já excluído por
 *   `listarCodigo`); (g) chamada de `require` feita através de um identificador criado por
 *   `createRequire(import.meta.url)` (ex.: `const r = createRequire(...); r('../x')`) foge do padrão — só
 *   `require(`/`import(` literais são lidos; o próprio auditor ofereceu "declarar" como alternativa a
 *   consertar (IB-5b) — nenhuma decisão do coordenador substituiu essa escolha; (h) um "módulo-agregador"
 *   informal fora do barrel (um arquivo qualquer do módulo que reexporta a API do módulo pra fora) não é
 *   medido — só a IMPORTAÇÃO por fora do barrel é julgada (regra 3), não a criação de um agregador paralelo
 *   (item listado no motor em GUARDS_PARALELO.md; IB-9). (i) CÓDIGO PYTHON (R6, 2026-09-11) — este guard só
 *   lê JS/TS; num projeto com "stack": "python" em esteira.json ele sai NAO_APLICAVEL (exit 0), ANTES até
 *   de checar `.arch-layers.json` (que, em python, o bootstrap nem copia).
 *
 * MODO DE FALHA JÁ ESCAPADO: auditoria adversarial de 2026-09-11 (Rodada 1 do Núcleo de Saúde v1) achou 9
 *   furos, todos reconciliados nesta versão:
 *   IB-1 (ALTA): projeto TS/NodeNext — import `.js` de um arquivo real `.ts` descartava-se calado (null) e
 *     100% dos imports relativos sumiam, dando ✅ com camada violada. Fixo: `resolverImport` (lib) sonda o
 *     gêmeo TS; o guard também CONTA e IMPRIME import relativo não resolvido, nunca descarta em silêncio.
 *   IB-2 (ALTA): `ehBarrel` só olhava o NOME do arquivo — um `index.*` em QUALQUER subpasta de outro módulo
 *     contava como barrel e abria a cápsula de graça. Fixo: `ehBarrelDoModulo` exige a posição exata.
 *   IB-3 (ALTA): sem `realpath`, maiúscula trocada no caminho e junction/symlink de diretório burlavam
 *     camada-proibida e capsula-violada (o Node carregava o arquivo real; o guard via um caminho fictício
 *     fora de qualquer camada/módulo). Fixo: `resolverImport` (lib) segue `realpathSync.native`.
 *   IB-4 (ALTA): config sem forma válida (chave errada, `{}`, `[]`, `null`, glob com `\`) dava ✅ (verde com
 *     ferramenta morta) em vez de NÃO MEDIU. Fixo: `validarFormaConfig` (local, decisão do coordenador #1).
 *   IB-5 (MÉDIA): `import()` dinâmico com comentário mágico (webpack/vite) antes da aspa e `require` com `\`
 *     (Windows/CJS) escapavam da detecção; `createRequire` aliasado também escapa (declarado, não corrigido
 *     — item (g) acima). Fixo: comentário mágico na lib; `\` normalizado localmente no guard.
 *   IB-6 (MÉDIA): a cápsula só valia quando a ORIGEM também estava dentro de `modulos.raiz` — mover o
 *     importador pra fora (`src/interfaces/…`) zerava a regra. Fixo: cápsula vale pra toda origem fora do
 *     módulo, exceto camada com `podeImportar: ['*']` (decisão do coordenador #4, GUARDS_PARALELO.md §7.4).
 *   IB-7 (MÉDIA): self-test não mordia mutações que contradiziam a própria certidão (opt-out virando
 *     POR-ARQUIVO; cápsula passando a exigir camada). Fixo: casos que travam as duas invariantes.
 *   IB-8 (BAIXA): opt-out só lia a linha do `from` — import multi-linha (o caso mais comum com vários
 *     nomes) não tinha onde comentar; marcador sem motivo ou dentro de string era aceito. Fixo: opt-out
 *     aceito em qualquer linha do statement (até a do especificador), exige `: motivo` não-vazio DENTRO de
 *     um comentário — decisão do coordenador #2.
 *   IB-9 (BAIXA): nasce morto até ser cabeado (fora de `package.json`/`GUARDS_ESPERADOS`/CI); certidão sem
 *     `INCIDENTE DE ORIGEM`. Fixo aqui: `INCIDENTE DE ORIGEM` (acima) e limites declarados; o cabeamento em
 *     si é a fase R4 (coordenador) — `ciJob`/`readmeLinha` entregues nesta reconciliação para essa fase.
 *
 * BANCA — as 10 classes:
 *   BANCA: VAZIO — TRATADA: fonte vazia/undefined vira 0 achados; projeto sem nenhum import sai limpo;
 *     `.arch-layers.json` sem `camadas` válidas (`{}`, `[]`, chave errada tipo "camada", glob com `\`) é
 *     NÃO MEDIU (exit 2), NUNCA ✅ — decisão do coordenador (IB-4, GUARDS_PARALELO.md §7.1).
 *   BANCA: STRING/COMENTÁRIO — TRATADA: `acharImports` (lib `importes.mjs`) já opera sobre `despirCodigo` —
 *     um `import` citado em comentário/string não é lido como import real; o opt-out, ao contrário, só é
 *     válido DENTRO de um comentário — dentro de uma string ele NÃO suprime nada (IB-8).
 *   BANCA: BASELINE — NÃO SE APLICA: sem allowlist/baseline interno; todo import no escopo de `listarCodigo`
 *     é julgado contra `.arch-layers.json` — a única "lista" é essa config, versionada e revisada por PR
 *     (abrir a fronteira é uma mudança visível no diff, não um baseline oculto).
 *   BANCA: IMPORT — TRATADA: `from`, `export … from` (reexport), `import(` dinâmico (inclusive com
 *     comentário mágico ANTES da aspa, tipo webpack/vite) e `require(` (inclusive com `\` trocado por `/`,
 *     padrão Windows/CJS) são julgados igual; alias/pacote não-relativo é EXTERNO por definição. NÃO VÊ:
 *     `require` chamado por um identificador criado via `createRequire(...)` — declarado em "O QUE NÃO VÊ"
 *     (g), IB-5b.
 *   BANCA: PATH — TRATADA: a resolução usa `existsSync`/`statSync` reais a partir de `--dir` E segue
 *     `realpathSync.native` (lib `importes.mjs`) — caixa trocada (Windows/NTFS) e junction/symlink de
 *     diretório resolvem ao alvo REAL antes de julgar camada/módulo (IB-3, corrigido em R1).
 *   BANCA: NULO — TRATADA: import relativo que NÃO resolve (arquivo inexistente) é ignorado por desenho —
 *     não é responsabilidade deste guard — mas é CONTADO e IMPRESSO, nunca descartado calado (IB-1); fonte
 *     vazia/undefined não quebra a função pura; `.arch-layers.json` com conteúdo JSON `null` é NÃO MEDIU
 *     (exit 2), distinto de "arquivo não existe" (NAO_APLICAVEL, exit 0) — IB-4.
 *   BANCA: RENOMEAR — NÃO SE APLICA: mover um arquivo pra fora do `--dir`/escopo só o tira da varredura;
 *     mede o disco no instante da chamada, não há estado incremental entre rodadas.
 *   BANCA: INVISÍVEL — declarada em "O QUE ESTE GUARD NÃO VÊ" (e): caractere invisível quebra a resolução
 *     real, não pode disfarçar uma violação que de fato funcionaria em runtime.
 *   BANCA: SUBSTITUIR — NÃO SE APLICA: julga o conteúdo real do arquivo lido do disco; a única injeção é o
 *     `resolver` da função pura `julgarArquivo`, usada só pelo self-test — o `--dir` de produção sempre usa
 *     `resolverImport` real (sem mock no caminho de produção).
 *
 * CONTRA-PROVA: node scripts/guards/import-boundaries.mjs --self-test (suíte em
 *   scripts/guards/selftest/import-boundaries.mjs)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
import { despirCodigo } from '../lib/despir-codigo.mjs';
import { acharImports, ehRelativo, resolverImport, casaGlob, listarCodigo, lerArchLayers, camadaDe, moduloDe, ehBarrelDoModulo } from '../lib/importes.mjs';
import { stackDoProjeto } from '../lib/stack.mjs';

export const NOME = 'import-boundaries';
const MARCADOR_OPTOUT = 'fronteira-de-proposito';
const MAX_RETROCESSO_STATEMENT = 20; // linhas pra trás procurando o início de um `import {...} from` multi-linha (IB-8)

/** Acha a linha (1-based) onde COMEÇA o statement de import que contém `linhaAlvo` — só usado pro opt-out
 *  multi-linha (IB-8): volta a partir de `linhaAlvo` até achar, no texto DESPIDO (sem string/comentário),
 *  uma linha que comece com `import`/`export`. Não achou dentro da janela → devolve a própria `linhaAlvo`
 *  (span de 1 linha, o comportamento de antes). Puro: só olha `linhasDesp`, não lê fs. */
function inicioDoStatement(linhasDesp, linhaAlvo) {
  for (let l = linhaAlvo; l >= Math.max(1, linhaAlvo - MAX_RETROCESSO_STATEMENT); l--) {
    if (/^\s*(?:import|export)\b/.test(linhasDesp[l - 1] || '')) return l;
  }
  return linhaAlvo;
}

/** O opt-out é válido no `trecho` (texto ORIGINAL, 1+ linhas)? Extrai só o que está DENTRO de comentário
 *  (`//…` até o fim da linha, `/*…*\/` mesmo cruzando linha dentro do trecho) e exige
 *  `fronteira-de-proposito: <motivo não-vazio>` ali dentro — marcador em string ou sem `: motivo` não conta
 *  (decisão do coordenador #2; IB-7 marcador-fora-do-trecho, IB-8 motivo/comentário). */
function optOutValido(trecho) {
  const partes = [];
  const re = /\/\/(.*)$|\/\*([\s\S]*?)\*\//gm;
  let m;
  while ((m = re.exec(trecho))) partes.push(m[1] ?? m[2] ?? '');
  const comentario = partes.join('\n');
  const mm = comentario.match(new RegExp(`${MARCADOR_OPTOUT}\\s*:\\s*(\\S.*)`));
  return Boolean(mm && mm[1] && mm[1].trim().length > 0);
}

/**
 * FUNÇÃO PURA: julga os imports de UM arquivo contra `cfg` (`.arch-layers.json` já parseado). `resolver`
 * é INJETÁVEL: `(especificador, deCaminho) => caminhoResolvido|null` — em produção é `resolverImport`
 * ligado à raiz (fs); no self-test é um mapa em memória (sem fs nenhum). Sem fs/exit aqui dentro.
 * Devolve `[{ tipo, linha, ofensor, ...contexto }]` — nunca lança.
 */
export function julgarArquivo({ caminho, fonte, cfg, resolver }) {
  const texto = String(fonte ?? '');
  const achados = [];
  const camadaOrigem = camadaDe(caminho, cfg);
  const moduloOrigem = cfg?.modulos ? moduloDe(caminho, cfg) : null;
  const linhas = texto.split('\n');
  const linhasDesp = despirCodigo(texto).split('\n');

  for (const imp of acharImports(texto)) {
    // opt-out: pro `from` (a forma que pode ser multi-linha), o trecho vai do início do statement até a
    // linha do especificador; pras outras formas (side-effect/dinamico/require, tipicamente 1 linha), o
    // trecho é só a própria linha — não contamina statement vizinho (IB-7).
    const linhaInicio = imp.forma === 'from' ? inicioDoStatement(linhasDesp, imp.linha) : imp.linha;
    const trecho = linhas.slice(linhaInicio - 1, imp.linha).join('\n');
    if (optOutValido(trecho)) continue; // opt-out explícito, com motivo, dentro de comentário, no statement

    // Windows/CJS: '..\x' também é relativo — normaliza ANTES de checar/resolver (IB-5c). O `ofensor`
    // reportado fica com o especificador ORIGINAL (fidelidade à mensagem), só a resolução usa o normalizado.
    const espNorm = imp.especificador.replace(/\\/g, '/');
    const relativo = ehRelativo(espNorm);
    let alvo = null;
    if (relativo) {
      alvo = resolver(espNorm, caminho);
      if (!alvo) continue; // não resolveu a arquivo real → não é violação DESTE guard (dead-code/build)
    }
    const camadaAlvo = relativo ? camadaDe(alvo, cfg) : null; // externo nunca tem camada

    // Regra 2 — domain-impuro: camada pura só pode importar relativo dentro de si mesma.
    if (camadaOrigem && cfg.camadas?.[camadaOrigem]?.puro) {
      const foraDaPropriaCamada = !relativo || camadaAlvo !== camadaOrigem;
      if (foraDaPropriaCamada) {
        achados.push({ tipo: 'domain-impuro', linha: imp.linha, ofensor: imp.especificador, camadaOrigem, externo: !relativo });
      }
    }

    // Regra 1 — camada-proibida: só quando origem E alvo têm camada nomeada e ela difere.
    if (relativo && camadaOrigem && camadaAlvo && camadaAlvo !== camadaOrigem) {
      const podeImportar = cfg.camadas?.[camadaOrigem]?.podeImportar || [];
      const permitido = podeImportar.includes('*') || podeImportar.includes(camadaAlvo);
      if (!permitido) {
        achados.push({ tipo: 'camada-proibida', linha: imp.linha, ofensor: imp.especificador, camadaOrigem, camadaAlvo });
      }
    }

    // Regra 3 — capsula-violada: dispara quando o ALVO está dentro de um módulo, não é o barrel exato, e a
    // ORIGEM não é esse mesmo módulo — seja porque está em OUTRO módulo, seja porque está FORA de
    // modulos.raiz inteiramente (moduloOrigem null) — EXCETO quando a camada de origem tem
    // podeImportar:['*'] (composição/main, decisão do coordenador IB-6). Independente de camadaOrigem.
    if (relativo && cfg?.modulos) {
      const moduloAlvo = moduloDe(alvo, cfg);
      const origemLivre = Boolean(camadaOrigem && (cfg.camadas?.[camadaOrigem]?.podeImportar || []).includes('*'));
      if (moduloAlvo && moduloAlvo !== moduloOrigem && !origemLivre && !ehBarrelDoModulo(alvo, cfg)) {
        achados.push({ tipo: 'capsula-violada', linha: imp.linha, ofensor: imp.especificador, moduloOrigem, moduloAlvo });
      }
    }
  }
  return achados;
}

/** FUNÇÃO PURA: arquivo casa `cfg.exigirCamadaEm` mas não cai em NENHUMA camada declarada? Regra 4. */
export function arquivoForaDeCamada(caminho, cfg) {
  if (!Array.isArray(cfg?.exigirCamadaEm)) return false;
  if (!cfg.exigirCamadaEm.some((g) => casaGlob(caminho, g))) return false;
  return camadaDe(caminho, cfg) === null;
}

/** FUNÇÃO PURA (IB-4): a FORMA de `.arch-layers.json` dá pra medir alguma coisa? Não julga o CONTEÚDO
 *  (se os globs fazem sentido é decisão humana, item (d) de "O QUE NÃO VÊ") — só a FORMA: chave errada,
 *  `{}`, `[]`, `null`, camada sem `globs` (array de string não-vazio), ou glob com `\` (Windows: nunca casa
 *  um caminho relativo, que sempre usa "/"). Devolve o MOTIVO (string) se inválida, `null` se válida —
 *  decisão do coordenador: config que não mede nada é NÃO MEDIU, nunca ✅ (GUARDS_PARALELO.md §7.1). */
export function validarFormaConfig(cfg) {
  if (cfg === null) return 'o arquivo existe mas o conteúdo é JSON "null" — sem config, não há o que medir';
  if (typeof cfg !== 'object' || Array.isArray(cfg)) return '.arch-layers.json não é um objeto JSON';
  const camadas = cfg.camadas;
  if (typeof camadas !== 'object' || camadas === null || Array.isArray(camadas) || Object.keys(camadas).length === 0) {
    return 'chave "camadas" ausente, vazia ou com nome errado (confira: é "camadas", não "camada"?)';
  }
  for (const [nome, c] of Object.entries(camadas)) {
    if (typeof c !== 'object' || c === null) return `camada "${nome}" não é um objeto`;
    if (!Array.isArray(c.globs) || c.globs.length === 0 || !c.globs.every((g) => typeof g === 'string' && g.length > 0)) {
      return `camada "${nome}".globs precisa ser um array de string(s) não-vazio`;
    }
    const comBarra = c.globs.find((g) => g.includes('\\'));
    if (comBarra) return `camada "${nome}" tem glob com "\\" (use "/"): "${comBarra}" nunca casa um caminho real`;
    if (c.podeImportar !== undefined && !Array.isArray(c.podeImportar)) return `camada "${nome}".podeImportar precisa ser um array`;
  }
  return null;
}

function explicacao(a) {
  if (a.tipo === 'camada-proibida') {
    return `camada "${a.camadaOrigem}" não pode importar a camada "${a.camadaAlvo}" (${a.ofensor}) — acrescente`
      + ` "${a.camadaAlvo}" ao podeImportar de "${a.camadaOrigem}" se for decisão nova, ou remova o import`;
  }
  if (a.tipo === 'domain-impuro') {
    const oQueImportou = a.externo ? 'um pacote externo' : 'algo fora da própria camada';
    return `camada "${a.camadaOrigem}" é pura (puro:true) e importou ${oQueImportou} (${a.ofensor}) — domínio`
      + ` puro só importa relativo dentro de si mesmo`;
  }
  if (a.tipo === 'capsula-violada') {
    const origem = a.moduloOrigem ? `módulo "${a.moduloOrigem}"` : 'um arquivo fora de qualquer módulo';
    return `${origem} importou um arquivo INTERNO do módulo "${a.moduloAlvo}" (${a.ofensor}) que não é o`
      + ` barrel — de fora só se entra pelo index`;
  }
  return 'casa um padrão de "exigirCamadaEm" mas não cai em nenhuma camada declarada em .arch-layers.json';
}

/** Lê os arquivos de `dir` e devolve `{ achados, naoResolvidos }` (fs; não é a função pura — a função pura
 *  é julgarArquivo). `naoResolvidos` são os imports relativos que não bateram em arquivo real — não é
 *  achado (BANCA: NULO), mas é CONTADO e reportado: nunca descartado em silêncio (IB-1). */
function escanear(dir, cfg) {
  const achados = [];
  const naoResolvidos = [];
  const resolver = (esp, de) => resolverImport(esp, de, dir);
  for (const caminho of listarCodigo(dir, { ignorar: cfg.ignorar || [] })) {
    let fonte;
    try { fonte = readFileSync(join(dir, caminho), 'utf8'); } catch { continue; }
    for (const a of julgarArquivo({ caminho, fonte, cfg, resolver })) achados.push({ arquivo: caminho, ...a });
    if (arquivoForaDeCamada(caminho, cfg)) achados.push({ arquivo: caminho, tipo: 'fora-de-camada', linha: 1 });
    for (const imp of acharImports(fonte)) {
      const espNorm = imp.especificador.replace(/\\/g, '/');
      if (ehRelativo(espNorm) && !resolver(espNorm, caminho)) naoResolvidos.push(`${caminho}:${imp.linha}:${imp.especificador}`);
    }
  }
  return { achados, naoResolvidos };
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  if (i >= 0 && !argv[i + 1]) { console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`); return 2; }
  const dir = i >= 0 ? argv[i + 1] : cwd;
  // R6 (2026-09-11): projeto declarado "stack":"python" não tem JS/TS pra este guard medir — NAO_APLICAVEL
  // exit 0, ANTES de qualquer outra regra (inclusive a checagem de .arch-layers.json abaixo).
  const stack = stackDoProjeto(dir); // esteira.json sintaticamente inválido LANÇA → rodapé pega → exit 2
  if (stack === 'python') { console.log(`[${NOME}] NAO_APLICAVEL: projeto declarado python no esteira.json — este guard só mede JS/TS.`); return 0; }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) { console.error(`[${NOME}] NÃO MEDIU: --dir não existe ou não é diretório: ${dir}`); return 2; }
  const arquivoConfig = join(dir, '.arch-layers.json');
  const arquivoExiste = existsSync(arquivoConfig);
  const cfg = lerArchLayers(dir); // JSON sintaticamente inválido LANÇA → rodapé pega → exit 2
  if (!arquivoExiste) { console.log(`[${NOME}] NÃO SE APLICA: ${dir} não tem .arch-layers.json — nada pra medir.`); return 0; }
  const motivoInvalido = validarFormaConfig(cfg);
  if (motivoInvalido) { console.error(`[${NOME}] NÃO MEDIU: ${arquivoConfig} inválido — ${motivoInvalido}.`); return 2; }
  const { achados, naoResolvidos } = escanear(dir, cfg);
  const aviso = naoResolvidos.length
    ? ` ${naoResolvidos.length} import(s) relativo(s) não resolvido(s) a arquivo real (não é violação deste`
      + ` guard — dead-code/build): ${naoResolvidos.join(', ')}`
    : '';
  if (achados.length === 0) {
    console.log(`[${NOME}] ✅ nenhuma fronteira de arquitetura violada em ${dir} (.arch-layers.json).${aviso}`);
    return 0;
  }
  for (const a of achados) console.error(`[${NOME}] FALHA (${a.tipo}): ${a.arquivo}:${a.linha} — ${explicacao(a)}`);
  if (aviso) console.error(`[${NOME}] AVISO:${aviso}`);
  console.error(
    `[${NOME}] COMO PASSAR: respeite o podeImportar da camada (ou o puro:true do domínio) em`
      + ` .arch-layers.json, ou entre em outro módulo só pelo barrel (index.*); se for uma exceção pontual`
      + ` e consciente, comente "${MARCADOR_OPTOUT}: <motivo>" em qualquer linha do próprio import/export`
      + ` (inclusive multi-linha), sempre dentro de um comentário.`
  );
  console.error(
    `[${NOME}] POR QUE EXISTE: sem isto .arch-layers.json é só um documento — camada/domínio/cápsula`
      + ` apodrecem em silêncio até o dia que tudo depende de tudo.`
  );
  return 1;
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) {
    // sem `await` de propósito: o guard e o companheiro se importam um ao outro (guard importa o
    // companheiro aqui embaixo; companheiro importa as funções puras do guard lá em cima) — um
    // `await` aqui deixaria a avaliação do MÓDULO guard pendente bem no meio desse ciclo, e o Node
    // detecta isso como "unsettled top-level await" (deadlock). Sem `await`, o corpo do guard termina
    // de avaliar (exports prontos) ANTES do companheiro ser carregado — o ciclo se resolve sem travar.
    import('./selftest/import-boundaries.mjs').then(({ selfTest }) => selfTest());
  } else {
    try { process.exitCode = principal(); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; }
  }
}
