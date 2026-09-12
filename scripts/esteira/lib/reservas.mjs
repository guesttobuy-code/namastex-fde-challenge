/**
 * reservas.mjs — DONO ÚNICO (LEI 11) das funções PURAS da reserva de número (ADR-0004): o CLI
 * (`scripts/reservar-numero.mjs`) e o guard (`scripts/guards/reserva-de-numero.mjs`) importam DAQUI —
 * nunca um do outro (RN-C3 da auditoria: guard importando de `scripts/` é a camada errada, LEI 11 sem
 * dono único). Tudo aqui é função pura ou dado — sem fs/git/process.exit (I/O fica em cada chamador).
 *
 * O QUE FAZ: padrão do nome numerado (arquivo OU pasta, `-`/`_`, extensão livre — Regras fixadas do
 *   ADR-0004); extrair número/slug; valor CANÔNICO de um número (largura não conta pra identidade —
 *   RN-01/02); normalizar/slugificar slug; parsear frontmatter de reserva sem BOM e sem aspas (RN-07);
 *   formatar sequencial/timestamp em UTC com PISO no maior existente (RN-09); calcular o PRÓXIMO número
 *   livre (com trava injetável); listar itens numerados de uma árvore (RN-06/12: não pula subpasta por
 *   nome, pasta numerada é FOLHA — não desce dentro dela, junction/symlink vira NÃO MEDIU); buscar pastas
 *   por nome em qualquer nível (RN-05/06: cobertura de `migrations`); checar caminho contido numa pasta
 *   base (RN-04: `--liberar` não sai da pasta de reserva/trava).
 *
 * O QUE NÃO FAZ: não decide o que é FALHA (isso é do guard, `julgar` fica lá — Parte 2 de
 *   COMO-CRIAR-GUARD.md); não toca fs além de LER (readdirSync) pra listar/buscar — abrir trava, escrever
 *   reserva/arquivo e o `git` continuam nos chamadores.
 */
import { readdirSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

/** nome numerado (Regras fixadas do ADR-0004): dígitos, separador `-` OU `_` (formato Supabase), slug =
 *  o trecho até o primeiro ponto — "0001_init.up.sql" e "0001_init.down.sql" são o MESMO item; sem
 *  extensão nenhuma (pasta do Prisma) também casa, porque `[^.]+` vai até o fim quando não há ponto. */
export const RE_NOME_NUMERADO = /^(\d+)[-_]([^.]+)/;

/** nome de arquivo de reserva versionada: "0005.md" → grupo 1 = "0005". */
export const RE_RESERVA_ARQUIVO = /^(\d+)\.md$/;

// ─── slug ──────────────────────────────────────────────────────────────────────

/** slug pra CRIAR (RN-C6): sem acento, minúsculas, qualquer corrida de não-[a-z0-9] vira "-", sem "-" nas
 *  pontas. "" (ou só símbolos) devolve "" — o chamador decide se isso é `exit 2`. */
export function slugificar(s) {
  const semAcento = String(s ?? '').normalize('NFD').replace(new RegExp('[\u0300-\u036f]', 'g'), '');
  return semAcento.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** slug pra COMPARAR arquivo × reserva (dono único do guard): minúsculas e `_`→`-`. NÃO normaliza
 *  acento — fronteira DECLARADA na certidão do guard (slug antigo, de antes do RN-C6, pode ter acento). */
export function normalizarSlug(s) {
  return String(s ?? '').trim().toLowerCase().replaceAll('_', '-');
}

/** slug → título legível ("reserva-de-numero" → "Reserva de numero"). */
export function slugLegivel(slug) {
  const s = String(slug ?? '').trim().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── número: formato, canônico, timestamp UTC ──────────────────────────────────

/** "0005" a partir de 5 com largura 4. */
export function formatarSequencial(n, largura = 4) {
  return String(n).padStart(Math.max(1, Number(largura) || 4), '0');
}

/** o VALOR do número, largura fora (RN-01/02: "015" e "0015" são o MESMO número — trava e duplicata
 *  comparam por AQUI, nunca pelo texto formatado). */
export function valorCanonico(numeroOuTexto) {
  return String(Number(numeroOuTexto));
}

/** "AAAAMMDDhhmmss" a partir de uma Date, em UTC (RN-09: hora local já causou timestamp errado). */
export function timestampAtual(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}`
    + `${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** "AAAAMMDDhhmmss" → Date em UTC (o inverso de `timestampAtual`, pro PISO do RN-09). */
export function dataDoTimestamp(numeroOuTexto) {
  const s = String(numeroOuTexto ?? '').padStart(14, '0').slice(-14);
  const n = (i, j) => Number(s.slice(i, j));
  return new Date(Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(8, 10), n(10, 12), n(12, 14)));
}

/** nomes de arquivo → Set<number> dos que casam `regex` (grupo 1 = número) — pras fontes FLAT (trava,
 *  reserva versionada): essas pastas nunca têm subpasta de propósito, então não precisam do walker. */
export function extrairNumeros(nomes, regex) {
  const out = new Set();
  for (const nome of nomes || []) {
    const m = regex.exec(String(nome));
    if (m) out.add(Number(m[1]));
  }
  return out;
}

/** maior número entre as três fontes (0 se todas vazias — o próximo vira 1). */
export function maiorNumero(sets) {
  const todos = [...(sets.dirNums || []), ...(sets.reservaNums || []), ...(sets.lockNums || [])];
  return todos.length ? Math.max(...todos) : 0;
}

/** o número já existe em QUALQUER uma das três fontes? */
export function numeroExiste(n, sets) {
  const alvo = Number(n);
  return (sets.dirNums || new Set()).has(alvo)
    || (sets.reservaNums || new Set()).has(alvo)
    || (sets.lockNums || new Set()).has(alvo);
}

/** timestamp livre: PISO no maior número existente + 1s (RN-09 — nunca menor que isso, mesmo se "agora"
 *  for anterior a um timestamp futuro já reservado), depois avança 1s enquanto `numeroExiste` ocupado. */
export function proximoNumeroTimestamp(sets, agora = new Date()) {
  const maior = maiorNumero(sets);
  let d = agora;
  if (maior > 0) {
    const piso = new Date(dataDoTimestamp(maior).getTime() + 1000);
    if (piso.getTime() > d.getTime()) d = piso;
  }
  let cand = timestampAtual(d);
  let guarda = 0;
  while (numeroExiste(Number(cand), sets) && guarda < 3600) {
    d = new Date(d.getTime() + 1000);
    cand = timestampAtual(d);
    guarda++;
  }
  return cand;
}

/**
 * O NÚCLEO da trava: calcula um candidato (a partir de `coletar()`) e tenta `travar(candidato)`; se
 * falhar (EEXIST — outro processo venceu a corrida), recalcula e tenta o PRÓXIMO, até `maxTentativas`.
 * `coletar`/`travar` são INJETÁVEIS — o self-test bombardeia isto sem precisar de dois processos
 * concorrentes de verdade. `travar` recebe o candidato JÁ FORMATADO (quem trava decide travar pelo VALOR
 * canônico — RN-01 é do chamador, não daqui).
 */
export function proximoNumeroComTrava({ padrao, largura, coletar, travar, maxTentativas = 20 }) {
  for (let i = 0; i < maxTentativas; i++) {
    const sets = coletar();
    const candidato = padrao === 'timestamp'
      ? proximoNumeroTimestamp(sets)
      : formatarSequencial(maiorNumero(sets) + 1, largura);
    if (travar(candidato)) return candidato;
  }
  return null;
}

// ─── molde e frontmatter ────────────────────────────────────────────────────────

/**
 * preenche o molde do ADR: "ADR-0000" → "ADR-<numero>", o placeholder de título → slug legível, a
 * data-molde "AAAA-MM-DD" → a data real. (Contrato de HOJE: o único molde é 0000-template.md, que usa
 * literalmente esses três marcadores — um molde de outro formato precisaria de outro preenchedor.)
 */
export function preencherModelo(fonteTemplate, { numeroFormatado, slug, data }) {
  const placeholderTitulo = '<título curto da decisão, no imperativo>';
  return String(fonteTemplate ?? '')
    .replaceAll('ADR-0000', `ADR-${numeroFormatado}`)
    .replace(placeholderTitulo, slugLegivel(slug))
    .replaceAll('AAAA-MM-DD', data);
}

export function frontmatterReserva({ numero, slug, branch, data, status }) {
  return `---\nnumero: ${numero}\nslug: ${slug}\nbranch: ${branch}\ndata: ${data}\nstatus: ${status}\n---\n`;
}

/** parseia o frontmatter de uma reserva: aceita BOM (editor Windows — RN-07) e valor entre aspas simples
 *  ou duplas (YAML válido — RN-07); null se não achar o bloco `---...---`. */
export function parseFrontmatterReserva(texto) {
  const semBom = String(texto ?? '').replace(new RegExp('^\uFEFF'), '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(semBom);
  if (!m) return null;
  const obj = {};
  for (const linhaBruta of m[1].split('\n')) {
    const linha = linhaBruta.replace(/\r$/, '');
    const i = linha.indexOf(':');
    if (i < 0) continue;
    const chave = linha.slice(0, i).trim();
    let valor = linha.slice(i + 1).trim();
    const aspas = /^"([\s\S]*)"$/.exec(valor) || /^'([\s\S]*)'$/.exec(valor);
    if (aspas) valor = aspas[1];
    obj[chave] = valor;
  }
  return obj;
}

// ─── caminho: contido numa pasta base, normalizado com barra ──────────────────

/** `caminhoAbs` fica DENTRO de `pastaBaseAbs` (sem escapar por "..")? RN-04: `--liberar` só toca caminho
 *  resolvido dentro das pastas de reserva/trava — defesa em profundidade além da validação de dígitos. */
export function dentroDe(caminhoAbs, pastaBaseAbs) {
  const rel = relative(resolve(pastaBaseAbs), resolve(caminhoAbs));
  return rel !== '' && rel !== '.' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** caminho com "/" (nunca "\\") — pra relatório e comparação entre plataformas. */
export function normalizarBarra(p) {
  return String(p ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
}

// ─── walkers: itens numerados dentro do dir de um tipo; pastas por nome em qualquer nível ─────────────

/**
 * Lista os ITENS NUMERADOS (arquivo OU pasta — Regras fixadas do ADR-0004) dentro de `dirAbs`, em
 * QUALQUER profundidade (RN-12: não pula subpasta por nome — um numerado escondido em `referencia/`
 * DENTRO do dir do tipo tem que aparecer). Uma pasta numerada é FOLHA: casou o padrão, vira item, NÃO
 * desce dentro dela (é assim que uma pasta de migration do Prisma — que tem `migration.sql` dentro — não
 * gera itens fantasma). `pularCaminhos` (Set de caminhos ABSOLUTOS resolvidos) pula uma entrada inteira
 * SEM virar item e sem descer nela — usado pra isentar o MOLDE (RN-C6: "o molde não é ADR") e o `dir` de
 * OUTRO tipo aninhado (RN-07: varredura não pode invadir o dir de outro tipo). Uma entrada JUNCTION/
 * SYMLINK não é seguida e vira `naoMedidos` (ADR-0004: "junction/symlink = NÃO MEDIU", nunca "sem
 * violação"). Raiz ilegível LANÇA (mesma semântica de `varrerArvore`); subpasta ilegível no meio é pulada.
 */
export function listarItensNumerados(dirAbs, { pularCaminhos = new Set(), ehOutroCheckout = () => false } = {}) {
  const itens = [];
  const naoMedidos = [];
  const pilha = [dirAbs];
  while (pilha.length) {
    const atual = pilha.pop();
    let entradas;
    try {
      entradas = readdirSync(atual, { withFileTypes: true });
    } catch (e) {
      if (atual === dirAbs) throw e;
      continue; // subpasta que sumiu no meio da varredura: pulada em silêncio, como sempre
    }
    for (const ent of entradas) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const p = join(atual, ent.name);
      if (pularCaminhos.has(resolve(p))) continue;
      if (ent.isSymbolicLink()) { naoMedidos.push({ caminho: p, motivo: 'junction/symlink' }); continue; }
      const m = RE_NOME_NUMERADO.exec(ent.name);
      if (m) { itens.push({ caminhoAbs: p, nome: ent.name, numero: m[1], slug: m[2], isDir: ent.isDirectory() }); continue; }
      if (ent.isDirectory() && !ehOutroCheckout(p)) pilha.push(p);
    }
  }
  return { itens, naoMedidos };
}

/**
 * Busca pastas cujo NOME é exatamente `nomeAlvo`, em qualquer profundidade a partir de `rootAbs` — fora
 * de `node_modules`, `.git`, `referencia/` e outro checkout git DE VERDADE (RN-05/06: "toda pasta
 * `migrations` achada em qualquer nível"). Uma pasta achada é FOLHA (não desce dentro pra achar outra
 * com o mesmo nome aninhada — caso degenerado, não é o que os achados pedem). Symlink/junction não é
 * seguido (evita ciclo; a mina de junction é do walker de item numerado, não deste). Raiz ilegível LANÇA.
 */
export function buscarPastasComNome(rootAbs, nomeAlvo, { ehOutroCheckout = () => false } = {}) {
  const PULAR = new Set(['node_modules', '.git', 'referencia', '.venv', 'venv', '.uv', '__pycache__', 'site-packages']);
  const achadas = [];
  const pilha = [rootAbs];
  while (pilha.length) {
    const atual = pilha.pop();
    let entradas;
    try {
      entradas = readdirSync(atual, { withFileTypes: true });
    } catch (e) {
      if (atual === rootAbs) throw e;
      continue;
    }
    for (const ent of entradas) {
      if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
      if (PULAR.has(ent.name)) continue;
      const p = join(atual, ent.name);
      if (ehOutroCheckout(p)) continue;
      if (ent.name === nomeAlvo) { achadas.push(p); continue; }
      pilha.push(p);
    }
  }
  return achadas;
}
