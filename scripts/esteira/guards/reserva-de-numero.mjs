#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: ADR-0004 — recurso NUMERADO e compartilhado (ADR, migration) colide quando duas
 *   frentes em paralelo escolhem "o próximo número" olhando só a própria árvore. Medido no projeto de
 *   origem: 4 números de ADR duplicados (dois arquivos cada), 8 colisões de migration numa tarde.
 *
 * O QUE FAZ: com `governance/RESERVAS.json` presente, para cada tipo LIGADO (`dir` configurado) varre
 *   `dir` procurando ITENS NUMERADOS (arquivo OU pasta cujo nome casa `^(\d+)[-_]([^.]+)` — Regras
 *   fixadas do ADR-0004) e reprova quando: (1) o item não tem `governance/reservas/<tipo>/<numero>.md`;
 *   (2) o slug da reserva diverge do slug do nome (comparação normalizada); (3) o `numero:` do
 *   frontmatter da reserva diverge do número do próprio nome; (4) dois itens do mesmo tipo têm o MESMO
 *   valor numérico (largura fora — "015" e "0015" contam como duplicata); (5) a largura do número diverge
 *   da configurada (tipos `sequencial`); (6) uma reserva `status: criado` não tem o item numerado
 *   correspondente (órfã — ADR apagado/renomeado). Reprova também quando `governance/adr/` existe sem
 *   nenhum tipo ligado apontando pra ela, ou quando alguma pasta chamada `migrations` existe em qualquer
 *   nível do projeto sem um tipo ligado cobrindo ELA especificamente.
 *
 * NUNCA MAIS PODE PASSAR (cada linha tem 1 caso no self-test, nomeado pelo id):
 *   RN-C1/C2 — separador `_` (padrão Supabase), extensão maiúscula/ausente, e ENTRADA-DIRETÓRIO (Prisma)
 *     invisíveis ao regex antigo (`^(\d+)-` só arquivo com extensão minúscula).
 *   RN-C6/RN-08(guard) — reserva do MOLDE (`criarDoModelo`) cobrada como se fosse ADR: o molde é isento.
 *   RN-01/02 — trava/duplicata por TEXTO formatado: "015" e "0015" não colidiam nem geravam achado.
 *   RN-03/04 — (do CLI, não deste guard — ver certidão de reservar-numero.mjs).
 *   RN-05 — `governance/adr/` com o tipo desligado/removido, `dir` com typo ou absoluto passavam calado.
 *   RN-06 — regra de migrations só olhava 4 caminhos FIXOS na raiz — monorepo/2ª pasta/Prisma escapavam.
 *   RN-07 — BOM, slug entre aspas, `dir` com "./", tipo aninhado (varredura invadia o dir de outro tipo).
 *   RN-09 — (do CLI — timestamp local/sem piso).
 *   RN-10 — fix-hint apontava `npm run adr:nova` quando o script ainda não existia (corrigido pro comando
 *     `node` real nesta versão); o wiring do npm script foi feito na R4 (`package.json`,
 *     `templates/package.scripts.json`) — o fix-hint agora aponta `npm run adr:nova -- "<slug>"` (real)
 *     e o `node` puro como alternativa, nunca promete o que não existe em nenhuma das duas fases.
 *   RN-11 — mutantes G2 (extensão só `.md`), G6 (não descia em subpasta) sobreviviam.
 *   RN-12 — numerado escondido em `referencia/` DENTRO do dir do tipo (PULAR_DIR incluía "referencia");
 *     junction/symlink liam através calado.
 *   RN-13 — relatório cortava caminho com `.slice()` em vez de `path.relative`; `numero:` do frontmatter
 *     nunca era conferido contra o nome.
 *
 * INCIDENTE DE ORIGEM: ADR-0004 (governance/adr/0004-reserva-de-numero-antes-de-criar.md) — os 4
 *   ADRs duplicados e as 8 colisões de migration medidos no projeto de origem, ANTES deste guard nascer;
 *   a 1ª versão deste próprio guard foi FURADA pela auditoria adversarial do coordenador (21 achados,
 *   RN-C1..C8 + RN-01..13) — os achados acima são essa auditoria, consertada aqui.
 *
 * O QUE ESTE GUARD **NÃO** VÊ:
 *   (a) BURACO na numeração histórica (0001, 0002, 0004 sem o 0003) — decisão do ADR-0004: com frentes
 *     em paralelo o tronco recebe números fora de ordem o tempo todo; reprovar isso bloquearia o
 *     inocente. Buraco/duplicata em projeto SEM `governance/RESERVAS.json` continua do guard
 *     `adr-sequence` (dono único nesse caso — LEI 11);
 *   (b) se a reserva foi feita ANTES ou DEPOIS do arquivo nascer — só que ela EXISTE e o slug/número
 *     batem; editar `governance/reservas/<tipo>/<numero>.md` pra bater um slug divergente é POSSÍVEL
 *     (fica no diff do PR, sujeito a revisão humana — não é allowlist oculta, mas também não é impedido
 *     por ESTE guard);
 *   (c) acento/caractere invisível no slug — a normalização de comparação só cobre caixa e `_`↔`-`; um
 *     slug ANTIGO (de antes do CLI normalizar na criação) com acento divergindo só por acentuação escapa;
 *   (d) trava local (`<git-common-dir>/esteira-reservas/`) — não versionada, fora do escopo de um scan
 *     de árvore;
 *   (e) subpasta que é outro checkout git DE VERDADE não é varrida (mesma semântica de `varrerArvore`);
 *   (f) `docs-required`/bootstrap/`adr-sequence` cedendo buraco quando a reserva está ligada — pendente
 *     pra R4 (ver notas da reconciliação, não é âmbito deste guard).
 *
 * MODO DE FALHA JÁ ESCAPADO: a 1ª versão (nascida direto do ADR, sem passar pela banca de burla) foi
 *   FURADA em 21 pontos pela auditoria adversarial do coordenador antes de entrar — ver RN-* acima. Essa
 *   é a razão de este guard já nascer com a certidão, a banca e os casos de bypass desta 2ª versão.
 *
 * BANCA — as 10 classes:
 *   BANCA: VAZIO — RESERVAS.json ausente → NAO_APLICAVEL (exit 0, projeto que não adotou a reserva
 *     ainda); `tipos` vazio/ausente ou JSON inválido → NÃO MEDIU (exit 2, nunca 0, nunca "sem violação").
 *   BANCA: STRING/COMENTÁRIO — NÃO SE APLICA: não varre padrão dentro de código-fonte; olha NOME de
 *     entrada (readdir) e dado ESTRUTURADO (RESERVAS.json + frontmatter da reserva).
 *   BANCA: BASELINE — não há allowlist por-arquivo: todo item numerado no `dir` de um tipo ligado é
 *     cobrado; a única forma de "aprovar" é a reserva EXISTIR com slug/número batendo — e isso fica no
 *     diff (ver "não vê" (b)).
 *   BANCA: IMPORT — NÃO SE APLICA: descoberta é por nome de entrada, não por import/alias/re-export.
 *   BANCA: PATH — junction/symlink DENTRO do dir do tipo vira NÃO MEDIU (nunca "sem violação" — RN-12);
 *     outro checkout git real não é varrido; `dir` absoluto ou fora do repo também NÃO MEDIU (`dir`
 *     relativo que simplesmente ainda não existe — tipo nunca usado — é `itens: []`, NUNCA BLOQUEIA).
 *   BANCA: NULO — reserva sem `slug` ou sem `numero` no frontmatter (ou frontmatter ilegível) nunca
 *     "bate por acaso": ausente vira string vazia / `null`, que só bateria um item cujo slug/numero
 *     TAMBÉM fosse vazio — caso degenerado que a regex do nome já impede.
 *   BANCA: RENOMEAR — mover o item numerado pra fora de `dir` tira do escopo (estrutural); mover só a
 *     RESERVA sem mover o item vira `sem-reserva` (o item continua exigindo a reserva no lugar certo);
 *     mover só o item sem a reserva pode deixar uma reserva ÓRFÃ (status `criado` sem item) — coberto.
 *   BANCA: INVISÍVEL — BOM na reserva é removido antes do parse (RN-07); acento no slug é a fronteira
 *     DECLARADA em "não vê" (c); maiúscula é coberta pela normalização.
 *   BANCA: SUBSTITUIR — NÃO SE APLICA à decisão (`julgar` é função pura, sem I/O); a PORTA é medida com
 *     o processo REAL (spawnSync), nunca com mock no lugar do guard.
 *
 * CONTRA-PROVA: node scripts/guards/reserva-de-numero.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
import { ehOutroCheckout } from '../lib/git-base.mjs';
import {
  normalizarSlug, parseFrontmatterReserva, listarItensNumerados, buscarPastasComNome,
  dentroDe, normalizarBarra, RE_RESERVA_ARQUIVO,
} from '../lib/reservas.mjs';

const NOME = 'reserva-de-numero';
const NOME_PASTA_MIGRATIONS = 'migrations';
const DIR_ADR_CONHECIDO = 'governance/adr';

class ErroMedicao extends Error {}

function ehDiretorio(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

/** valida o `dir` de um tipo LIGADO: relativo e dentro do repo — senão NÃO MEDIU (ADR-0004: "dir
 *  absoluto ou fora do repo = NÃO MEDIU"). NÃO exige que exista: um tipo ligado cuja pasta ainda não foi
 *  criada (nenhuma reserva usada ainda) é medido como `itens: []` — lenient, nunca NÃO MEDIU — para não
 *  bloquear o projeto que só usa um dos tipos configurados (a pasta `governance/adr`/`migrations`
 *  "conhecida" continua cobrada separadamente, pelo CAMINHO configurado, não pela existência). */
function dirAbsValidado(dirRepoAbs, tipo, def) {
  if (isAbsolute(def.dir)) throw new ErroMedicao(`tipo "${tipo}": "dir" é um caminho absoluto ("${def.dir}").`);
  const dirAbs = resolve(dirRepoAbs, def.dir);
  if (!dentroDe(dirAbs, dirRepoAbs)) throw new ErroMedicao(`tipo "${tipo}": "dir" ("${def.dir}") sai da árvore do projeto.`);
  return dirAbs;
}

/**
 * COLETA (I/O): lê RESERVAS.json e o disco, devolve DADOS PUROS — nenhuma decisão aqui (Parte 2 de
 * COMO-CRIAR-GUARD: julgamento fica isolado em `julgar`, sem fs/git/exit).
 */
export function medir(dir) {
  if (!existsSync(dir)) throw new ErroMedicao(`diretório "${dir}" não existe.`);
  const configPath = join(dir, 'governance', 'RESERVAS.json');
  if (!existsSync(configPath)) return { aplicavel: false };

  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); }
  catch (e) { throw new ErroMedicao(`governance/RESERVAS.json não é JSON válido (${e?.message || e}).`); }
  const semTipos = !config || typeof config.tipos !== 'object' || config.tipos === null
    || Object.keys(config.tipos).length === 0;
  if (semTipos) throw new ErroMedicao('governance/RESERVAS.json sem "tipos" configurado.');

  const dirRepoAbs = resolve(dir);
  const entradasTipos = Object.entries(config.tipos);
  const dirsLigadosAbs = new Map();
  for (const [tipo, def] of entradasTipos) {
    if (!def?.dir) continue;
    dirsLigadosAbs.set(tipo, dirAbsValidado(dirRepoAbs, tipo, def));
  }

  const tipos = entradasTipos.map(([tipo, def]) => {
    if (!def || !def.dir) return { tipo, ligado: false, dir: def?.dir ?? null, itens: [], reservas: [] };
    const dirAbs = dirsLigadosAbs.get(tipo);
    const reservasDirAbs = join(dirRepoAbs, 'governance', 'reservas', tipo);
    let itens = [];
    if (existsSync(dirAbs)) { // pasta ainda não criada (tipo nunca usado) → itens:[], nunca NÃO MEDIU
      const pularCaminhos = new Set();
      if (def.criarDoModelo) pularCaminhos.add(resolve(dirRepoAbs, def.criarDoModelo)); // RN-C6: molde isento
      for (const [outroTipo, outroDirAbs] of dirsLigadosAbs) { // RN-07: não invadir dir de outro tipo aninhado
        if (outroTipo !== tipo) pularCaminhos.add(outroDirAbs);
      }
      const { itens: brutos, naoMedidos } = listarItensNumerados(dirAbs, { pularCaminhos, ehOutroCheckout });
      if (naoMedidos.length) {
        throw new ErroMedicao(`tipo "${tipo}": ${naoMedidos.map((n) => `${n.motivo} em ${normalizarBarra(relative(dirRepoAbs, n.caminho))}`).join('; ')}.`);
      }
      itens = brutos.map((it) => {
        const reservaPath = join(reservasDirAbs, `${it.numero}.md`);
        const reservaExiste = existsSync(reservaPath);
        const fm = reservaExiste ? (parseFrontmatterReserva(readFileSync(reservaPath, 'utf8')) || {}) : null;
        return {
          caminho: normalizarBarra(relative(dirRepoAbs, it.caminhoAbs)), // RN-13: path.relative, não slice
          numero: it.numero,
          slugArquivo: it.slug,
          reservaExiste,
          slugReserva: fm ? (fm.slug ?? '') : null,
          numeroFrontmatter: fm ? (fm.numero ?? null) : null,
        };
      });
    }
    const reservasNomes = existsSync(reservasDirAbs) ? readdirSync(reservasDirAbs) : [];
    const reservas = reservasNomes.filter((n) => RE_RESERVA_ARQUIVO.test(n)).map((n) => {
      const fm = parseFrontmatterReserva(readFileSync(join(reservasDirAbs, n), 'utf8')) || {};
      return { arquivo: n, numero: RE_RESERVA_ARQUIVO.exec(n)[1], status: fm.status ?? null };
    });
    return { tipo, ligado: true, dir: def.dir, largura: def.largura, padrao: def.padrao, itens, reservas };
  });

  // RN-05: governance/adr/ existente sem NENHUM tipo ligado apontando exatamente pra ela = reprova.
  const adrDirAbs = join(dirRepoAbs, ...DIR_ADR_CONHECIDO.split('/'));
  const adrExiste = ehDiretorio(adrDirAbs);
  const adrCoberta = [...dirsLigadosAbs.values()].some((p) => resolve(p) === resolve(adrDirAbs));

  // RN-06: toda pasta "migrations" achada em QUALQUER nível (fora de node_modules/.git/checkout/
  // referencia/) tem que ser o dir de algum tipo ligado — não só os 4 caminhos fixos na raiz.
  const migrationsAchadas = buscarPastasComNome(dirRepoAbs, NOME_PASTA_MIGRATIONS, { ehOutroCheckout });
  const dirsLigadosAbsSet = new Set([...dirsLigadosAbs.values()].map((p) => resolve(p)));
  const migrationsSemCobertura = migrationsAchadas
    .filter((p) => !dirsLigadosAbsSet.has(resolve(p)))
    .map((p) => normalizarBarra(relative(dirRepoAbs, p)));

  return { aplicavel: true, tipos, adr: { existe: adrExiste, coberta: adrCoberta }, migrationsSemCobertura };
}

/**
 * FUNÇÃO PURA: julga os DADOS de `medir` (nunca toca fs/git; não faz `process.exit`).
 * @returns {{estado:'NAO_APLICAVEL'|'OK'|'FALHA', falhas:object[]}}
 */
export function julgar(dados) {
  if (!dados || dados.aplicavel !== true) return { estado: 'NAO_APLICAVEL', falhas: [] };
  const falhas = [];

  for (const t of dados.tipos || []) {
    if (!t.ligado) continue;
    const porValor = new Map();
    for (const item of t.itens || []) {
      const valor = Number(item.numero);
      if (!porValor.has(valor)) porValor.set(valor, []);
      porValor.get(valor).push(item);

      if (!item.reservaExiste) {
        falhas.push({ tipo: 'sem-reserva', arquivo: item.caminho, detalhe: `numero ${item.numero} sem governance/reservas/${t.tipo}/${item.numero}.md` });
        continue;
      }
      const a = normalizarSlug(item.slugArquivo);
      const b = normalizarSlug(item.slugReserva ?? '');
      if (a !== b) {
        falhas.push({
          tipo: 'reserva-diverge', arquivo: item.caminho,
          detalhe: `slug do arquivo "${item.slugArquivo}" != slug da reserva "${item.slugReserva ?? ''}"`,
        });
      }
      // RN-13: numero: do frontmatter tem que bater com o número do próprio nome.
      if (item.numeroFrontmatter != null && Number(item.numeroFrontmatter) !== valor) {
        falhas.push({
          tipo: 'numero-diverge', arquivo: item.caminho,
          detalhe: `numero do frontmatter "${item.numeroFrontmatter}" != numero do nome "${item.numero}"`,
        });
      }
    }
    // RN-02: mesmo VALOR numérico usado por mais de um item (largura fora da identidade).
    for (const [valor, grupo] of porValor) {
      if (grupo.length > 1) {
        falhas.push({
          tipo: 'numero-duplicado', arquivo: grupo.map((g) => g.caminho).join(', '),
          detalhe: `numero ${valor} usado por ${grupo.length} entradas`,
        });
      }
    }
    // RN-02: largura divergente da config (só faz sentido pra padrão sequencial — timestamp é sempre 14).
    if (t.padrao !== 'timestamp') {
      const larguraEsperada = Number.isFinite(t.largura) ? t.largura : 4;
      for (const item of t.itens || []) {
        if (item.numero.length !== larguraEsperada) {
          falhas.push({
            tipo: 'largura-diverge', arquivo: item.caminho,
            detalhe: `numero "${item.numero}" tem ${item.numero.length} dígito(s), config exige largura ${larguraEsperada}`,
          });
        }
      }
    }
    // RN-C8: reserva "criado" sem item correspondente = órfã (ADR apagado/renomeado). "reservado" sem
    // item é trabalho em voo — NUNCA BLOQUEIA.
    for (const r of t.reservas || []) {
      if (r.status !== 'criado') continue;
      const existe = (t.itens || []).some((it) => Number(it.numero) === Number(r.numero));
      if (!existe) {
        falhas.push({
          tipo: 'reserva-orfa', arquivo: `governance/reservas/${t.tipo}/${r.arquivo}`,
          detalhe: `status "criado" sem item numerado correspondente em ${t.dir}`,
        });
      }
    }
  }

  if (dados.adr?.existe && !dados.adr?.coberta) {
    falhas.push({ tipo: 'adr-dir-sem-tipo', arquivo: DIR_ADR_CONHECIDO, detalhe: 'pasta existe mas nenhum tipo ligado em RESERVAS.json aponta pra ela.' });
  }
  for (const p of dados.migrationsSemCobertura || []) {
    falhas.push({ tipo: 'migrations-sem-reserva', arquivo: p, detalhe: 'pasta de migrations existe mas nenhum tipo ligado aponta pra ela.' });
  }

  return { estado: falhas.length ? 'FALHA' : 'OK', falhas };
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  if (i >= 0 && !argv[i + 1]) { console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`); return 2; }
  const dir = i >= 0 ? argv[i + 1] : cwd;

  const dados = medir(dir); // dir ilegível / RESERVAS.json inválido / dir de tipo ruim → lança → exit 2
  const r = julgar(dados);
  if (r.estado === 'NAO_APLICAVEL') {
    console.log(`[${NOME}] NAO_APLICAVEL: ${dir} não tem governance/RESERVAS.json (projeto sem reserva de número).`);
    return 0;
  }
  if (r.estado === 'OK') {
    console.log(`[${NOME}] ✅ toda numeração ligada em ${dir} tem reserva com slug/número batendo.`);
    return 0;
  }
  for (const f of r.falhas) console.error(`[${NOME}] FALHA (${f.tipo}): ${f.detalhe} — ${f.arquivo}`);
  console.error(`[${NOME}] COMO PASSAR: rode "npm run adr:nova -- \\"<slug>\\"" (ou "npm run migration:nova -- \\"<slug>\\""`);
  console.error(`[${NOME}]   para migration; "node scripts/reservar-numero.mjs <tipo> \\"<slug>\\"" funciona igual, sem o npm) —`);
  console.error(`[${NOME}]   nunca crie o arquivo/pasta numerado à mão; se o tipo migration existe mas a`);
  console.error(`[${NOME}]   pasta real é outra, corrija "dir" em governance/RESERVAS.json.`);
  console.error(`[${NOME}] POR QUE EXISTE: ADR-0004 — número reservado antes de criar evita colisão entre`);
  console.error(`[${NOME}]   frentes paralelas (1 chat = 1 branch = 1 worktree).`);
  return 1;
}

// self-test mora em ./selftest/reserva-de-numero.mjs (companion) — regra do coordenador: ≤ 600 linhas
// visuais por arquivo. Import dinâmico SEM await no topo (evita "unsettled top-level await" — o
// companion importa `julgar`/`medir` de volta DESTE arquivo, e um `await` aqui criaria um ciclo com
// top-level await que o Node recusa a resolver). A suíte seta process.exitCode ao ser importada.
if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) {
    import('./selftest/reserva-de-numero.mjs').catch((e) => {
      console.error(`[${NOME}] NÃO MEDIU: self-test não rodou: ${e?.message || e}`);
      process.exitCode = 2;
    });
  } else {
    try { process.exitCode = principal(); } catch (e) {
      console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`);
      process.exitCode = 2;
    }
  }
}
