#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: a LEI DA FONTE diz que regra de negócio só existe se estiver ESCRITA (CONTRACT/ADR/
 *   doc) — mas essa lei não se aplica sozinha. Sem um guard, "README existe" e "todo módulo tem
 *   CONTRACT.md" são promessas de honra: o projeto some sem elas e ninguém percebe até alguém perguntar
 *   "onde está a regra disso?" e a resposta ser silêncio. Este guard torna a AUSÊNCIA de documentação/
 *   governança obrigatória um vermelho objetivo, não um lembrete que se esquece.
 *
 * INCIDENTE DE ORIGEM: preventivo — decisão do dono 2026-09-11 (ADR-0003, #21).
 *
 * O QUE FAZ: lê `<dir>/governance/DOCS_OBRIGATORIOS.json` (--dir, ou cwd). Sem o arquivo → NÃO SE APLICA
 *   (exit 0) — EXCETO se `<dir>/esteira.json` existir: aí a ausência do config é reprovação (DR-01, exit
 *   1). Com o arquivo (validado: só chaves _doc/raiz/porModulo, tipos certos, ≥1 exigência real — senão
 *   NÃO MEDIU, DR-02): (1) cada entrada de "raiz" terminada em "/" é PASTA (≥1 arquivo com conteúdo REAL
 *   — ≥1 letra/dígito — em qualquer profundidade, ignorando .gitkeep/.keep, DR-05); senão é ARQUIVO (tem
 *   que existir com conteúdo REAL, não só espaço/BOM/invisível/NUL — DR-04); (2) se "porModulo" tem
 *   entradas e `.arch-layers.json` tem `modulos.raiz`, cada subpasta — direta OU por junction/symlink
 *   (DR-07), exceto a que o `.arch-layers.json` manda ignorar (DR-09) — é módulo e precisa ter, com
 *   conteúdo real, cada arquivo de "porModulo" (ex. CONTRACT.md); sem `.arch-layers.json`/`modulos.raiz`,
 *   só "raiz" vale.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. um caminho obrigatório de "raiz" (arquivo OU pasta) simplesmente não existir;
 *   2. um arquivo/pasta obrigatório existir mas estar VAZIO — pasta sem arquivo com conteúdo REAL dentro
 *      (recursivamente — DR-05), arquivo de 0 bytes, ou só espaço/BOM/invisível/NUL (DR-04);
 *   3. um módulo (direto OU por junction/symlink, DR-07) não ter um dos arquivos de "porModulo";
 *   4. um projeto da ESTEIRA (`esteira.json`) não ter `governance/DOCS_OBRIGATORIOS.json` — a ausência do
 *      PRÓPRIO config virar "nada a checar" (DR-01);
 *   5. o config EXISTIR mas não exigir NADA de verdade — chave desconhecida, `{}`, ou "raiz"+"porModulo"
 *      ambos vazios — e mesmo assim reportar ✅ (DR-02);
 *   6. falha REAL ao listar `modulos.raiz` (ENOTDIR, EACCES) virar silenciosamente "0 módulos" (DR-08).
 *
 * O QUE NUNCA PODE BLOQUEAR (família de falsos-positivos):
 *   - projeto SEM `esteira.json` e sem `governance/DOCS_OBRIGATORIOS.json` (NÃO SE APLICA; só reprova
 *     quando o projeto É da esteira, DR-01);
 *   - "porModulo" declarado mas sem `.arch-layers.json`/`modulos.raiz` — só "raiz" é cobrada;
 *   - `modulos.raiz` declarado mas a pasta ainda não existe (ENOENT — projeto novo, DR-08);
 *   - pasta/módulo que o `.arch-layers.json` manda ignorar (ex. `__tests__`) não é cobrado (DR-09);
 *   - pasta obrigatória com o conteúdo real numa SUBPASTA (ex. `governance/adr/aceitos/`) (DR-05);
 *   - todo caminho de "raiz" presente e não-vazio, e todo módulo com todo "porModulo" presente e não-vazio.
 *
 * O QUE ESTE GUARD **NÃO** VÊ:
 *   (a) a QUALIDADE/veracidade do conteúdo — mede presença + "tem ≥1 letra/dígito", não sentido; um
 *       CONTRACT.md de uma linha "TODO" passa;
 *   (b) módulos ANINHADOS — só a subpasta DIRETA de `modulos.raiz` conta como módulo (por desenho, casa
 *       com `moduloDe` de `importes.mjs`);
 *   (c) link simbólico/junction do ARQUIVO/PASTA individual exigido (não do módulo em si) que aponte pra
 *       fora do projeto — `statSync` segue por comportamento padrão do SO (o MÓDULO em si já é tratado
 *       explicitamente: DR-07);
 *   (d) ENCOLHER o próprio `governance/DOCS_OBRIGATORIOS.json` — tirar uma entrada de "raiz"/"porModulo"
 *       no MESMO PR que apaga o arquivo correspondente — não é pego: a lista cobrada é sempre a do config
 *       ATUAL, sem baseline com catraca. É mudança de GOVERNANÇA, revisada no diff do PR; catraca
 *       automática (estilo `marcadorAdicionadoNoDiff`) fica PENDENTE — limite DECLARADO pelo coordenador
 *       (DR-03, Rodada 1, 2026-09-11);
 *   (e) caixa do nome de caminho é sensível ao SO (Windows tolera "readme.md" casando com "README.md" no
 *       disco; Linux/CI não) — não confere a caixa exata contra o disco (DR-10, opcional pro auditor).
 *
 * MODO DE FALHA JÁ ESCAPADO: auditoria adversarial 2026-09-11 (Rodada 1) achou 10 furos, todos
 *   consertados/declarados aqui: DR-01 config ausente virava NÃO SE APLICA mesmo em projeto da esteira;
 *   DR-02 chave desconhecida/`{}` dava ✅ sem medir nada; DR-03 lista encolhia sem trava e "../"/"./"
 *   escapavam da raiz checada; DR-04 conteúdo só invisível/NUL passava como "não-vazio"; DR-05 doc em
 *   subpasta virava falso "vazia" e só-.gitkeep virava falso "ok"; DR-06 self-test raso (8/14 mutantes
 *   sobreviviam, 2 com falso-negativo real); DR-07 módulo por junction/symlink nunca era cobrado; DR-08
 *   ENOTDIR/EACCES virava "0 módulos" silencioso, igual a projeto novo; DR-09 pasta que o .arch-layers
 *   manda ignorar (ex. __tests__) virava "módulo sem doc"; DR-10 barra invertida/tipo trocado dava
 *   mensagem enganosa "não existe", variando por SO. DR-06 (R3, auditoria da reconciliação, 2026-09-11):
 *   3 dos 8 mutantes sobreviventes ainda escapavam do self-test reconciliado (Array.isArray(raiz) e
 *   Array.isArray(porModulo) só eram exercidos por fixtures cujo "." coincidia com o corte de
 *   `entradaValida`; o filtro `temConteudoReal` de `medirPasta` só era testado via `.gitkeep`, já
 *   filtrado antes por `varrerArvore`) — 3 casos adversariais novos (marcados "DR-06 (R3)" na suíte)
 *   fecham os 3; os 8/8 mutantes reconstruídos mordem hoje (ver CONTRA-PROVA).
 *
 * BANCA — as 10 classes:
 *   BANCA: VAZIO — TRATADA: config ausente é "nada declarado" LEGÍTIMO (exit 0) — EXCETO em projeto da
 *     esteira (`esteira.json`), onde a ausência do PRÓPRIO config é reprovação (DR-01). Com o config
 *     PRESENTE: chave desconhecida, tipo errado, entrada inválida, OU as duas listas vazias de verdade
 *     (incl. `{}`) → NÃO MEDIU (exit 2), nunca ✅ sobre zero itens medidos (DR-02).
 *   BANCA: STRING/COMENTÁRIO — NÃO SE APLICA: mede existência/tamanho/conteúdo-real via `fs`, não texto
 *     de programa; `despirCodigo` não se aplica aqui.
 *   BANCA: IMPORT — NÃO SE APLICA: não segue import/require/alias nenhum (as libs importadas são REUSO
 *     do próprio guard, LEI 11 — não algo que ele "segue" na árvore julgada).
 *   BANCA: PATH — TRATADA (DR-03/DR-10): `entradaValida` recusa caminho absoluto (posix ou drive
 *     Windows), segmento ".." em qualquer posição, normalização pra raiz ("." / "./" / "//"), e barra
 *     invertida. Não defende symlink/junction do arquivo INDIVIDUAL (ver limite (c)).
 *   BANCA: BASELINE — PARCIAL — declarada (DR-03): toda entrada do config ATUAL é cobrada sempre, mas
 *     encolher a PRÓPRIA lista não é pega — ver limite (d), catraca pendente.
 *   BANCA: RENOMEAR — TRATADA: checagem por PRESENÇA no caminho declarado — mover o doc pra fora vira
 *     `doc-ausente` na hora. Módulo "alcançado" por junction/symlink também é cobrado (DR-07).
 *   BANCA: INVISÍVEL — TRATADA: no CAMINHO, caractere invisível não casa com arquivo real → `doc-ausente`.
 *     No CONTEÚDO, `temConteudoReal` exige ≥1 letra/dígito — espaço/BOM/U+200B/NUL não contam (DR-04).
 *   BANCA: SUBSTITUIR — TRATADA: PASTA no lugar de arquivo (ou vice-versa) não conta como presente — e
 *     agora DIZ qual tipo era (`doc-tipo-errado`) em vez de mentir "não existe" (DR-10).
 *   BANCA: NULO — TRATADA: `null`/string vazia em "raiz"/"porModulo" nunca vira "sem violação" — é
 *     CONFIG INVÁLIDA, NÃO MEDIU (exit 2), igual a JSON malformado.
 *
 * CONTRA-PROVA: node scripts/guards/docs-required.mjs --self-test (suíte em
 *   scripts/guards/selftest/docs-required.mjs — este arquivo continua sendo a PORTA)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
import { lerArchLayers, ignoradoPelaArch } from '../lib/importes.mjs';
import { varrerArvore } from '../lib/varredura.mjs';

const NOME = 'docs-required';
const CHAVES_PERMITIDAS = new Set(['_doc', 'raiz', 'porModulo']);

/**
 * FUNÇÃO PURA: `x` é uma entrada válida de "raiz"/"porModulo"? String não-vazia, sem barra invertida
 * (DR-10), sem caminho absoluto (posix ou drive Windows) e sem segmento ".." nem normalização pra raiz
 * ("." / "./" / "//") — DR-03: o caminho declarado nunca escapa nem se resolve pra fora da checagem.
 */
export function entradaValida(x) {
  if (typeof x !== 'string') return false;
  if (x.trim() === '') return false;
  if (x.includes('\\')) return false; // DR-10: caminho declarado é sempre "/", nunca "\"
  if (x.startsWith('/')) return false; // DR-03: absoluto (posix)
  if (/^[a-zA-Z]:/.test(x)) return false; // DR-03: absoluto (drive Windows, ex. "C:/x")
  const semBarraFinal = x.endsWith('/') ? x.slice(0, -1) : x;
  const segmentos = semBarraFinal.split('/').filter((s) => s !== '');
  if (segmentos.length === 0) return false; // DR-03: normaliza pra vazio/raiz ("/", "//")
  if (segmentos.every((s) => s === '.')) return false; // DR-03: "." / "./" normaliza pra raiz
  if (segmentos.some((s) => s === '..')) return false; // DR-03: sobe da raiz do projeto (A11)
  return true;
}

/** FUNÇÃO PURA: `texto` tem pelo menos 1 caractere de letra/dígito? DR-04: espaço em branco, BOM,
 *  caractere invisível (U+200B, U+2060...) e bytes NUL não contam como conteúdo — só `trim()` não pegava
 *  isso; exigir `\p{L}`/`\p{N}` pega qualquer disfarce de vazio, não só os catalogados. */
export function temConteudoReal(texto) {
  return /[\p{L}\p{N}]/u.test(String(texto ?? ''));
}

/**
 * FUNÇÃO PURA: julga UMA entrada de "raiz" a partir dos FATOS já medidos (sem fs aqui).
 * `caminho` decide PASTA (termina "/") vs ARQUIVO. `fatos`:
 *   arquivo → { existe, tamanho, soEspaco, tipoErrado? } · pasta → { existe, qtdArquivos, tipoErrado? }
 * Devolve null (ok) ou { tipo: 'doc-ausente' | 'doc-vazio' | 'doc-tipo-errado', caminho, ... }.
 * DR-10: quando o nó EXISTE só que com o tipo contrário (pasta declarada como arquivo, ou vice-versa),
 * o achado é `doc-tipo-errado` — não a mentira "não existe" de antes.
 */
export function julgarEntradaRaiz(caminho, fatos) {
  const ehPasta = String(caminho ?? '').endsWith('/');
  if (!fatos?.existe) {
    if (fatos?.tipoErrado) return { tipo: 'doc-tipo-errado', caminho, tipoReal: fatos.tipoErrado, tipoEsperado: ehPasta ? 'pasta' : 'arquivo' };
    return { tipo: 'doc-ausente', caminho };
  }
  if (ehPasta) return (Number(fatos.qtdArquivos) || 0) > 0 ? null : { tipo: 'doc-vazio', caminho };
  if (!(Number(fatos.tamanho) > 0) || fatos.soEspaco) return { tipo: 'doc-vazio', caminho };
  return null;
}

/**
 * FUNÇÃO PURA: julga UM arquivo obrigatório de "porModulo" dentro de UM módulo.
 * `fatos` = { existe, tamanho, soEspaco } (o mesmo shape de arquivo de julgarEntradaRaiz).
 * Devolve null (ok) ou { tipo: 'modulo-sem-doc', caminho: '<modulo>/<arquivo>' }.
 */
export function julgarArquivoModulo(modulo, arquivo, fatos) {
  const caminho = `${modulo}/${arquivo}`;
  if (!fatos?.existe || !(Number(fatos.tamanho) > 0) || fatos.soEspaco) return { tipo: 'modulo-sem-doc', caminho };
  return null;
}

/** Mede um ARQUIVO no disco → fatos para julgarEntradaRaiz/julgarArquivoModulo. SUBSTITUIR: pasta no
 *  lugar do arquivo não conta como presente (confere isFile) — e agora diz QUE tipo era (DR-10), em vez
 *  de fingir "não existe" quando na verdade existe com o tipo errado. Exportada para o self-test poder
 *  exercer o mecanismo real (DR-06: "caso puro" em vez de decoração). */
export function medirArquivo(abs) {
  let st;
  try { st = statSync(abs); } catch { return { existe: false }; }
  if (!st.isFile()) return { existe: false, tipoErrado: st.isDirectory() ? 'pasta' : 'outro' };
  let buf;
  try { buf = readFileSync(abs); } catch { return { existe: false }; }
  const tamanho = buf.length;
  const soEspaco = tamanho > 0 && !temConteudoReal(buf.toString('utf8')); // DR-04
  return { existe: true, tamanho, soEspaco };
}

/** Mede uma PASTA no disco → fatos para julgarEntradaRaiz. SUBSTITUIR: arquivo no lugar da pasta não
 *  conta como presente (confere isDirectory), com o mesmo `tipoErrado` de medirArquivo (DR-10). DR-05:
 *  conta RECURSIVAMENTE — reusa `varrerArvore` (DONO ÚNICO do walker, lib/varredura.mjs — LEI 11), em vez
 *  de reimplementar um segundo walker — ignorando `.gitkeep`/`.keep`, e só considera "com conteúdo" o
 *  arquivo com ≥1 letra/dígito (mesma régua de medirArquivo — DR-04). */
export function medirPasta(abs) {
  let st;
  try { st = statSync(abs); } catch { return { existe: false }; }
  if (!st.isDirectory()) return { existe: false, tipoErrado: st.isFile() ? 'arquivo' : 'outro' };
  const { arquivos } = varrerArvore(abs, { aceitar: (nome) => nome !== '.gitkeep' && nome !== '.keep' });
  const qtdArquivos = arquivos.filter((a) => temConteudoReal(typeof a.conteudo === 'string' ? a.conteudo : a.conteudo.toString('utf8'))).length;
  return { existe: true, qtdArquivos };
}

/**
 * Lê e valida o shape de `governance/DOCS_OBRIGATORIOS.json` → { raiz: string[], porModulo: string[] }.
 * JSON malformado, config que não é objeto, chave desconhecida (DR-02), "raiz"/"porModulo" de tipo
 * errado, entrada inválida (NULO/vazia/absoluta/".."/barra-invertida — DR-03/DR-10), OU as duas listas
 * dando vazio de verdade — config que não exige NADA, incl. `{}` (DR-02) — LANÇA (o rodapé de main() vira
 * NÃO MEDIU, exit 2 — nunca 0 silencioso).
 */
function lerConfigValidado(cfgPath) {
  const bruto = JSON.parse(readFileSync(cfgPath, 'utf8'));
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new Error(`${cfgPath}: config inválida — não é um objeto JSON.`);
  }
  for (const chave of Object.keys(bruto)) {
    if (!CHAVES_PERMITIDAS.has(chave)) throw new Error(`${cfgPath}: chave desconhecida "${chave}" (permitidas: _doc, raiz, porModulo) — DR-02.`);
  }
  const raiz = bruto.raiz === undefined ? [] : bruto.raiz;
  const porModulo = bruto.porModulo === undefined ? [] : bruto.porModulo;
  if (!Array.isArray(raiz)) throw new Error(`${cfgPath}: "raiz" não é uma lista.`);
  if (!Array.isArray(porModulo)) throw new Error(`${cfgPath}: "porModulo" não é uma lista.`);
  for (const c of raiz) if (!entradaValida(c)) throw new Error(`${cfgPath}: entrada inválida em "raiz" (${JSON.stringify(c)}).`);
  for (const a of porModulo) if (!entradaValida(a)) throw new Error(`${cfgPath}: entrada inválida em "porModulo" (${JSON.stringify(a)}).`);
  if (raiz.length === 0 && porModulo.length === 0) {
    throw new Error(`${cfgPath}: config presente mas não exige NADA de verdade ("raiz" e "porModulo" vazios) — DR-02.`);
  }
  return { raiz, porModulo };
}

/**
 * Escaneia `dir`. `dir` ilegível → LANÇA (NÃO MEDIU). Sem `governance/DOCS_OBRIGATORIOS.json`:
 * projeto da esteira (`<dir>/esteira.json` existe) → achado `config-ausente` (reprovação, DR-01);
 * senão → { naoAplicavel: true }. Com config válido → { naoAplicavel: false, achados, modulosMedidos }.
 */
function escanear(dir) {
  let stDir;
  try { stDir = statSync(dir); } catch { throw new Error(`--dir ilegível: ${dir}`); }
  if (!stDir.isDirectory()) throw new Error(`--dir não é uma pasta: ${dir}`);

  const cfgPath = join(dir, 'governance', 'DOCS_OBRIGATORIOS.json');
  if (!existsSync(cfgPath)) {
    // DR-01: o kit e todo projeto nascido de templates/ trazem esteira.json + o config JUNTOS; se o
    // config sumiu num projeto da esteira, é perda de governança (reprovação), não "nunca declarou nada".
    if (existsSync(join(dir, 'esteira.json'))) {
      return {
        naoAplicavel: false,
        achados: [{ tipo: 'config-ausente', caminho: 'governance/DOCS_OBRIGATORIOS.json' }],
        modulosMedidos: null,
        raizModRel: null,
      };
    }
    return { naoAplicavel: true, achados: [], modulosMedidos: null, raizModRel: null };
  }

  const { raiz, porModulo } = lerConfigValidado(cfgPath); // JSON/shape/chave/vazio-de-verdade inválidos → lança → NÃO MEDIU
  const achados = [];

  for (const caminho of raiz) {
    const abs = join(dir, caminho);
    const fatos = caminho.endsWith('/') ? medirPasta(abs) : medirArquivo(abs);
    const a = julgarEntradaRaiz(caminho, fatos);
    if (a) achados.push(a);
  }

  let modulosMedidos = null;
  let raizModRel = null;
  if (porModulo.length > 0) {
    const archCfg = lerArchLayers(dir); // DONO ÚNICO de ler .arch-layers.json (scripts/lib/importes.mjs); null se ausente
    const raizMod = archCfg?.modulos?.raiz;
    if (raizMod) {
      raizModRel = raizMod;
      const raizModAbs = join(dir, raizMod);
      let entradas;
      try {
        entradas = readdirSync(raizModAbs, { withFileTypes: true });
      } catch (e) {
        // DR-08: só ENOENT (pasta de módulos ainda não existe — projeto novo) é "0 módulos" legítimo;
        // qualquer outro erro (ENOTDIR: é um arquivo; EACCES; etc.) é "não consegui medir" — ERRA ALTO,
        // nunca engolido calado no mesmo balde de "projeto sem módulos".
        if (e?.code === 'ENOENT') entradas = [];
        else throw e;
      }
      const modDirs = entradas
        // DR-07: módulo alcançável só por JUNCTION/SYMLINK não fica invisível — Dirent.isDirectory() não
        // segue link; statSync (que segue, comportamento padrão do SO) decide se o alvo é mesmo uma pasta.
        .filter((e) => {
          if (e.isDirectory()) return true;
          if (!e.isSymbolicLink()) return false;
          try { return statSync(join(raizModAbs, e.name)).isDirectory(); } catch { return false; }
        })
        .map((e) => e.name)
        // DR-09: a própria arquitetura pode mandar ignorar certas pastas (ex. **/__tests__/**) — reusa o
        // DONO ÚNICO (`ignoradoPelaArch`, importes.mjs) em vez de reinventar a checagem (LEI 11).
        .filter((nome) => !ignoradoPelaArch(`${raizMod}/${nome}/x`, archCfg));
      modulosMedidos = modDirs.length;
      for (const modulo of modDirs) {
        for (const arquivo of porModulo) {
          const a = julgarArquivoModulo(modulo, arquivo, medirArquivo(join(raizModAbs, modulo, arquivo)));
          if (a) achados.push(a);
        }
      }
    }
    // sem .arch-layers.json ou sem modulos.raiz: NUNCA BLOQUEIA — só "raiz" vale (NÃO é NÃO MEDIU).
  }

  return { naoAplicavel: false, achados, modulosMedidos, raizModRel };
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  if (i >= 0 && !argv[i + 1]) {
    console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`);
    return 2;
  }
  const dir = i >= 0 ? argv[i + 1] : cwd;

  // dir ilegível/config inválida → escanear() lança → cai no catch do rodapé (entrypoint) → exit 2
  const { naoAplicavel, achados, modulosMedidos, raizModRel } = escanear(dir);
  if (naoAplicavel) {
    console.log(`[${NOME}] NÃO SE APLICA: ${dir} não tem governance/DOCS_OBRIGATORIOS.json — nada declarado obrigatório.`);
    return 0;
  }
  if (achados.length === 0) {
    // DR-08: regressão de módulos medidos pra 0 fica visível na própria saída verde, não só no exit.
    const sufixo = modulosMedidos != null ? ` (${modulosMedidos} módulo(s) medido(s) em ${raizModRel})` : '';
    console.log(`[${NOME}] ✅ toda a documentação/governança obrigatória está presente e não-vazia em ${dir}${sufixo}.`);
    return 0;
  }

  let temConfigAusente = false;
  for (const a of achados) {
    if (a.tipo === 'config-ausente') {
      temConfigAusente = true;
      console.error(
        `[${NOME}] FALHA (config-ausente): ${dir} é um projeto da esteira (tem esteira.json) mas não tem ` +
        `"${a.caminho}" — o config obrigatório de governança sumiu.`,
      );
    } else if (a.tipo === 'doc-tipo-errado') {
      const real = a.tipoReal === 'pasta' ? 'PASTA' : 'ARQUIVO';
      const esperado = a.tipoEsperado === 'pasta' ? 'uma PASTA (declare terminando em "/")' : 'um ARQUIVO (declare sem "/" no final)';
      console.error(
        `[${NOME}] FALHA (doc-tipo-errado): ${a.caminho} existe em ${dir}, mas como ${real} — ` +
        `governance/DOCS_OBRIGATORIOS.json exige ${esperado}.`,
      );
    } else if (a.tipo === 'doc-ausente') {
      console.error(`[${NOME}] FALHA (doc-ausente): ${a.caminho} não existe em ${dir}.`);
    } else if (a.tipo === 'doc-vazio') {
      console.error(`[${NOME}] FALHA (doc-vazio): ${a.caminho} existe mas está vazio (ou só espaço/caractere invisível) em ${dir}.`);
    } else {
      const modulo = a.caminho.split('/')[0];
      const arquivo = a.caminho.split('/').slice(1).join('/');
      console.error(
        `[${NOME}] FALHA (modulo-sem-doc): o módulo ${modulo} não tem "${arquivo}" ` +
        `(ausente ou vazio) — caminho: ${a.caminho}.`,
      );
    }
  }
  const prefixoConfig = temConfigAusente
    ? 'crie governance/DOCS_OBRIGATORIOS.json (copie o modelo de templates/governance/) — ' +
      'todo projeto da esteira precisa declarar o mínimo obrigatório; '
    : '';
  console.error(
    `[${NOME}] COMO PASSAR: ${prefixoConfig}crie/preencha o(s) arquivo(s)/pasta(s) listados acima — cada entrada ` +
    `de "raiz" em governance/DOCS_OBRIGATORIOS.json (arquivo com conteúdo real — ≥1 letra/dígito —, ou pasta com ` +
    `≥1 arquivo com conteúdo real em qualquer profundidade), e, por módulo, cada arquivo de "porModulo" (ex.: ` +
    `CONTRACT.md) em toda subpasta de modulos.raiz do .arch-layers.json (pastas que o próprio .arch-layers.json ` +
    `manda "ignorar" não contam como módulo).`,
  );
  console.error(
    `[${NOME}] POR QUE EXISTE: regra de negócio só existe se estiver ESCRITA (LEI DA FONTE) — doc/governança ` +
    `obrigatória ausente ou vazia é a fonte que devia existir e não existe; ninguém percebe até perguntar.`,
  );
  return 1;
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) {
    // suíte movida pro companheiro (DR-06/R3 — guard passava de 600 linhas visuais com a suíte
    // embutida); import dinâmico relativo, calculado pelo próprio companheiro a partir do seu
    // import.meta.url — mesma saída e mesmo exit de antes da divisão. SEM top-level await: o
    // companheiro importa ESTE arquivo de volta (pega as funções puras) e um `await` aqui prende
    // os dois num ciclo de avaliação ESM que nunca assenta (Node sai com "unsettled top-level
    // await", exit 13) — `.then()` deixa este módulo terminar de avaliar antes do companheiro
    // reimportá-lo, o que desfaz o ciclo.
    import('./selftest/docs-required.mjs')
      .then(({ selfTest }) => {
        process.exitCode = selfTest();
      })
      .catch((e) => {
        console.error(`[${NOME}] NÃO MEDIU: falha ao carregar a suíte (selftest/docs-required.mjs): ${e?.message || e}`);
        process.exitCode = 2;
      });
  } else {
    try {
      process.exitCode = principal();
    } catch (e) {
      console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`);
      process.exitCode = 2;
    }
  }
}
