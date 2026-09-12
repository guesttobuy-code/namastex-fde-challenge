#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: a Bússola (a seção "AS 12 LEIS DO DESENVOLVIMENTO" do CLAUDE.md) é a única fonte de
 *   verdade que toda sessão de IA lê antes de trabalhar. Editada, escondida ou movida em silêncio (lei
 *   sumida, ordem trocada, ESCONDIDA atrás de comentário, movida pro local alternativo oficial), cada
 *   sessão nova passa a segui-la errada sem ninguém perceber. Este guard existe pra que isso NUNCA
 *   passe despercebido — e pra que o TEXTO auditado seja o MESMO que realmente chega à IA.
 *
 * O QUE FAZ: procura a Bússola em `<dir>/CLAUDE.md` e `<dir>/.claude/CLAUDE.md` (os 2 locais oficiais
 *   do Claude Code — `--dir`, default cwd; nenhum existe → NÃO SE APLICA). Resolve `@<caminho>` em
 *   QUALQUER posição de linha (fora de comentário HTML/bloco cercado/code span), recursivo até 4
 *   níveis, relativo ao ARQUIVO que importa, absoluto como está, `~/` = homedir — espelha a sintaxe
 *   real do Claude Code. Import que não resolve (menção, typo) fica literal, não quebra sozinho (se
 *   carregava a seção, o sintoma vira `secao-ausente`); import cujo alvo CAI FORA de `--dir` é
 *   bloqueado (`import-fora-do-repo`). No texto final, remove comentário/bloco/span de novo — é o que o
 *   Claude Code NÃO injeta — e SÓ ENTÃO exige a seção `/^##\s+AS 12 LEIS DO DESENVOLVIMENTO/` 1x, com
 *   12 itens de topo (até o próximo "## "), numerados 1..12, nomes CANÔNICOS em negrito, nesta ordem.
 *   Corpo de cada lei livre — só rótulo/número/ordem são vigiados.
 *
 * O QUE NUNCA MAIS PODE PASSAR: (1) lei sumir — `contagem`; (2) ordem/número trocar — `numeracao`/
 *   `nome`; (3) lei renomeada — `nome`; (4) seção sumir do texto final — `secao-ausente` — inclusive
 *   atrás de comentário HTML, dentro de bloco de EXEMPLO, ou por `@import` que não resolveu; (5) seção
 *   2x — `secao-duplicada`; (6) Bússola mudar pra `.claude/CLAUDE.md` (continua ativa no Claude Code) e
 *   o guard ficar cego; (7) import escapar do projeto e ser seguido calado — `import-fora-do-repo`;
 *   (8) `--dir` inexistente virar "sem CLAUDE.md" — vira NÃO MEDIU (exit 2), nunca exit 0.
 *
 * O QUE NUNCA PODE BLOQUEAR: corpo livre da lei; blockquote/item INDENTADO (mesmo com nome canônico
 *   exato) não conta como item de topo; espaço duplo, NFC/NFD, CRLF, BOM inicial (removido de CADA
 *   arquivo lido); texto antes/depois da seção; título citado NO MEIO de frase ou em bloco de exemplo;
 *   as 12 vindas por `@import` (qualquer posição, absoluto, `~/`, até 4 hops) ou por
 *   `.claude/CLAUDE.md`; menção solta tipo `@fulano` quando a seção já está completa sem ela; projeto
 *   sem CLAUDE.md nos 2 locais — NÃO SE APLICA.
 *
 * INCIDENTE DE ORIGEM: preventivo — decisão do dono 2026-09-11 (ADR-0003, #21).
 *
 * O QUE ESTE GUARD **NÃO** VÊ:
 *   - que CLAUDE.md (ou .claude/CLAUDE.md) DEVE existir — ausência dos dois é NAO_APLICAVEL por
 *     desenho; a garantia de EXISTÊNCIA é de outro guard (`DOCS_OBRIGATORIOS`). Medido: HOJE nenhuma
 *     das duas listas (`governance/` ou `templates/governance/DOCS_OBRIGATORIOS.json`) cita
 *     `CLAUDE.md` — a garantia ainda NÃO é real; colocá-lo lá é decisão do coordenador (Rodada 1,
 *     ponto 10, `governance/GUARDS_PARALELO.md` §7) pra fase R4 — fora do meu escopo de edição aqui
 *     (só toco este arquivo e a mina `referencia/minado/leis-integrity/`);
 *   - recursão de `@import` além de 4 hops (por desenho, teto oficial do Claude Code);
 *   - `@import` (ou CLAUDE.md/.claude/CLAUDE.md) resolvendo pra DIRETÓRIO → NÃO MEDIU (exit 2), nunca
 *     tenta adivinhar o conteúdo;
 *   - o CONTEÚDO/qualidade do corpo de cada lei — só rótulo, número e ordem;
 *   - quando os DOIS locais existem: a ordem de concatenação (raiz primeiro) é escolha de desenho, não
 *     garantia documentada — se os dois trouxerem a seção completa, isso é `secao-duplicada`, correto;
 *   - `referencia/limpo/` continuar sem `CLAUDE.md` pro `minefield.mjs` exercitar o caminho de
 *     aprovação (LI-9) — fora do meu escopo de edição; o caminho de aprovação está provado DENTRO do
 *     `--self-test` (fixture `ok12`), a lacuna no `minefield.mjs` em si fica pra R4 do coordenador.
 *
 * MODO DE FALHA JÁ ESCAPADO (auditoria adversarial Rodada 1, 2026-09-11 — ver `_veredito.json`):
 *   LI-1 (ALTA): lei/seção escondida em `<!-- -->` passava exit 0 — Claude Code remove comentário
 *     Markdown antes de injetar contexto; o guard lia o texto cru.
 *   LI-2 (ALTA): mover a Bússola pra `.claude/CLAUDE.md` (local OFICIAL) cegava o guard (só olhava
 *     `<dir>/CLAUDE.md`) enquanto a certidão citava garantia de existência que nenhum guard dava.
 *   LI-3 (MÉDIA): `@import` dentro de bloco cercado era seguido; import pra FORA do projeto, calado.
 *   LI-4 (MÉDIA): sintaxe real de `@import` (posição livre, absoluto, `~/`, 4 hops) só parcial — CLAUDE.md
 *     LEGÍTIMO reprovado (inline numa frase, absoluto, 2 níveis) — "reprova o inocente".
 *   LI-5 (MÉDIA): `--dir` inexistente saía 0 (NÃO SE APLICA) em vez de NÃO MEDIU — incoerente com os
 *     6 scanners irmãos e a Parte 3 da doutrina.
 *   LI-6 (MÉDIA): self-test decorativo — 3 mutantes da regra central sobreviviam sem caso morder.
 *   LI-7 (BAIXA): certidão dizia "nunca falso-negativo" no bloco de código — medido falso: seção real
 *     apagada + EXEMPLO sobrando num bloco cercado → o guard aprovava.
 *   LI-8 (BAIXA): BOM (U+FEFF) no início de arquivo IMPORTADO/raiz com título na linha 1 reprovava
 *     CLAUDE.md correto.
 *   LI-9 (BAIXA): "passa no limpo" do `minefield.mjs` só exercitava NÃO SE APLICA — aprovação nunca
 *     provada por ele.
 *
 * BANCA — as 10 classes: VAZIO-TRATADA (0 bytes → secao-ausente); STRING/COMENTÁRIO-TRATADA (LI-1/7:
 *   `despirMarkdown` remove comentário/bloco/span antes de tudo); BASELINE-NÃO SE APLICA (sem config
 *   pra inflar); IMPORT-TRATADA ampliada (LI-3/4: sintaxe real, não resolvido não quebra sozinho,
 *   ignora comentário/bloco); PATH-TRATADA (LI-3/C2: fora de `--dir` é bloqueado); NULO-TRATADA
 *   (null/undefined/'' → secao-ausente); RENOMEAR-PARCIAL (LI-2: `.claude/CLAUDE.md` já não cega;
 *   ausência dupla continua NÃO SE APLICA, garantia de existência é de outro guard); INVISÍVEL-TRATADA
 *   ampliada (LI-8: BOM de CADA arquivo lido; U+200B ainda reprova, lado seguro); SUBSTITUIR-NÃO SE
 *   APLICA (funções reais, PORTA roda o processo real); TRUNCADO-TRATADA (menos de 12 itens → contagem).
 *
 * CONTRA-PROVA: node scripts/guards/leis-integrity.mjs --self-test
 *   (suíte em scripts/guards/selftest/leis-integrity.mjs)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, isAbsolute, relative } from 'node:path';
import { homedir as osHomedir } from 'node:os';
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
import { despirMarkdown } from '../lib/despir-codigo.mjs';

// NOME/ARQUIVO_ALVO/NOMES_CANONICOS exportados: dono único (LEI 11) — o companheiro
// (scripts/guards/selftest/leis-integrity.mjs) importa daqui, nunca duplica.
export const NOME = 'leis-integrity';
export const ARQUIVO_ALVO = 'CLAUDE.md';
const MAX_HOPS = 4; // mesmo teto documentado do Claude Code ("maximum depth of four hops")

// Fonte única dos 12 nomes canônicos, na ordem oficial (mesmos nomes/ordem de templates/CLAUDE.md).
export const NOMES_CANONICOS = [
  'LEI DO PAPEL',
  'LEI DO NÃO-CHUTE',
  'LEI DA FONTE',
  'LEI DA ORDEM',
  'LEI DO EXEMPLO',
  'LEI DO REGISTRO',
  'LEI DA PROVA',
  'LEI DO IRREVERSÍVEL',
  'LEI DO FORMATO',
  'LEI DA FERRAMENTA',
  'LEI DO DONO ÚNICO',
  'LEI DO ROADMAP ATIVO',
];

const RE_SECAO = /^##\s+AS 12 LEIS DO DESENVOLVIMENTO/;
const RE_FIM_SECAO = /^##\s+/;
// Não-indentado, não-blockquote: exige o dígito na posição 0 da linha (sem 'm' na regex — cada `l` já
// é UMA linha, então "^" é o início da própria linha; ">" ou espaço na frente nunca casam aqui).
const RE_ITEM = /^(\d{1,2})\.\s+\*\*(LEI\s+D[OA]\s+[^*]+?)\*\*/;

const normalizar = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const NOMES_CANONICOS_NORM = NOMES_CANONICOS.map(normalizar);

/**
 * FUNÇÃO PURA: audita o texto (já com imports resolvidos, já despido de comentário/bloco/span) contra a
 * Bússola. Sem fs, sem exit. Estrutural — não decide o que "conta" como texto real (isso é
 * `despirMarkdown`, chamado por `auditarBussola`).
 * @param {string} texto
 * @returns {{ok: boolean, problemas: string[]}}
 */
export function auditarLeis(texto) {
  const linhas = String(texto ?? '').split('\n');

  const idxSecoes = [];
  linhas.forEach((l, i) => { if (RE_SECAO.test(l)) idxSecoes.push(i); });

  if (idxSecoes.length === 0) {
    return { ok: false, problemas: ['secao-ausente — não achei a seção "## AS 12 LEIS DO DESENVOLVIMENTO".'] };
  }
  if (idxSecoes.length > 1) {
    return { ok: false, problemas: [`secao-duplicada — a seção aparece ${idxSecoes.length}x (esperado 1x).`] };
  }

  const inicio = idxSecoes[0] + 1;
  let fim = linhas.length;
  for (let i = inicio; i < linhas.length; i++) { if (RE_FIM_SECAO.test(linhas[i])) { fim = i; break; } }

  const itens = [];
  for (const l of linhas.slice(inicio, fim)) {
    const m = l.match(RE_ITEM);
    if (m) itens.push({ numero: Number(m[1]), nome: normalizar(m[2]) });
  }

  const problemas = [];
  if (itens.length !== 12) {
    problemas.push(`contagem — achou ${itens.length} leis numeradas de topo (esperado 12).`);
  }

  const n = Math.min(itens.length, NOMES_CANONICOS_NORM.length);
  for (let i = 0; i < n; i++) {
    const posicao = i + 1;
    if (itens[i].numero !== posicao) {
      problemas.push(`numeracao — posição ${posicao} tem número ${itens[i].numero} (esperado ${posicao}).`);
    }
    if (itens[i].nome !== NOMES_CANONICOS_NORM[i]) {
      problemas.push(`nome — posição ${posicao}: esperado "${NOMES_CANONICOS[i]}", achou "${itens[i].nome}".`);
    }
  }

  return { ok: problemas.length === 0, problemas };
}

/**
 * FUNÇÃO PURA: auditarLeis, mas primeiro remove comentário HTML/bloco de código cercado/code span
 * (`despirMarkdown`) — é isso que o Claude Code NÃO injeta no contexto (LI-1, LI-7). Esta é a função
 * usada por `principal()`; `auditarLeis` continua exportada e testada isoladamente (o núcleo estrutural).
 * @param {string} textoBruto
 * @returns {{ok: boolean, problemas: string[]}}
 */
export function auditarBussola(textoBruto) {
  return auditarLeis(despirMarkdown(textoBruto));
}

/**
 * FUNÇÃO PURA: acha toda ocorrência de "@<especificador>" no texto, em QUALQUER posição da linha (não
 * só sozinha numa linha — LI-4/B1), IGNORANDO ocorrências dentro de comentário HTML, bloco de código
 * cercado ou code span (via `despirMarkdown` — mesmo comprimento, os índices batem com o ORIGINAL, já
 * que fora dessas regiões o texto "limpo" é idêntico ao bruto). Sem fs, sem exit.
 * @param {string} texto
 * @returns {{especificador: string, indice: number, comprimento: number}[]} na ordem em que aparecem
 */
export function acharImportsEmTexto(texto) {
  const bruto = String(texto ?? '');
  const limpo = despirMarkdown(bruto);
  const resultados = [];
  const RE = /@(\S+)/g;
  let m;
  while ((m = RE.exec(limpo)) !== null) {
    resultados.push({ especificador: m[1], indice: m.index, comprimento: m[0].length });
  }
  return resultados;
}

/** BOM (U+FEFF) inicial removido — não é `\n`, não desloca a contagem de linha (LI-8). */
function removerBOM(s) {
  const t = String(s ?? '');
  return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t;
}

/**
 * Resolve `@imports` RECURSIVAMENTE (até MAX_HOPS), em qualquer posição da linha, fora de
 * comentário/bloco cercado/code span. Espelha a sintaxe real do Claude Code: caminho ABSOLUTO é usado
 * como está; `~/` vira homedir; caminho RELATIVO resolve a partir do ARQUIVO que importa (não sempre da
 * raiz — LI-4/B6). Import que não existe (typo, menção tipo "@fulano") NÃO quebra sozinho: fica literal
 * no texto — o efeito real, se ele carregava a seção, aparece como `secao-ausente` na auditoria final,
 * igual ao Claude Code de verdade ("the imports stay disabled") — LI-4/B5. Import cujo alvo resolvido
 * CAI FORA de `dirRaiz` é bloqueado — devolvido em `foraDoRepo`, curto-circuitando a recursão (LI-3/C2).
 * `existe`/`ler`/`homedir` injetáveis (Parte 3 da doutrina) — o self-test roda a maior parte disto
 * OFFLINE, sem tocar o disco real.
 * @param {string} texto
 * @param {string} dirRaiz
 * @param {{existe?: (p:string)=>boolean, ler?: (p:string)=>string, homedir?: () => string}} [deps]
 * @returns {{texto: string|null, foraDoRepo: {especificador:string, alvo:string}|null, naoResolvidos: string[]}}
 */
export function resolverImportsRecursivo(texto, dirRaiz, deps = {}) {
  const existe = deps.existe || existsSync;
  const ler = deps.ler || ((p) => readFileSync(p, 'utf8'));
  const pegarHomedir = deps.homedir || osHomedir;
  const naoResolvidos = [];

  function expandir(txt, baseDir, hop, visitados) {
    const imports = acharImportsEmTexto(txt);
    if (imports.length === 0) return { texto: txt, foraDoRepo: null };
    let out = txt;
    // da direita pra esquerda: substituir não bagunça o índice dos imports ainda não processados
    for (let k = imports.length - 1; k >= 0; k--) {
      const { especificador, indice, comprimento } = imports[k];
      let alvo;
      if (especificador.startsWith('~/')) alvo = join(pegarHomedir(), especificador.slice(2));
      else if (isAbsolute(especificador)) alvo = especificador;
      else alvo = join(baseDir, especificador);

      const rel = relative(dirRaiz, alvo);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        return { texto: null, foraDoRepo: { especificador, alvo } };
      }
      if (hop > MAX_HOPS || visitados.has(alvo) || !existe(alvo)) {
        naoResolvidos.push(especificador); // não expande: fica literal — não quebra sozinho (LI-4/B5)
        continue;
      }
      const conteudo = removerBOM(ler(alvo));
      const sub = expandir(conteudo, dirname(alvo), hop + 1, new Set(visitados).add(alvo));
      if (sub.foraDoRepo) return sub;
      // Import no MEIO de uma linha (LI-4/B1: "As leis estão em @leis.md — leia..."): colar o conteúdo
      // importado char-a-char quebraria o "^##" do título dele (deixaria de estar no INÍCIO da linha).
      // Envolve o bloco importado em quebra de linha própria quando ele não já começa/termina numa —
      // o texto que vem antes/depois na MESMA linha vira sua própria linha, o importado vira as dele.
      const antes = out.slice(0, indice);
      const depois = out.slice(indice + comprimento);
      const precisaQuebraAntes = antes.length > 0 && !antes.endsWith('\n');
      const precisaQuebraDepois = depois.length > 0 && !depois.startsWith('\n');
      const bloco = (precisaQuebraAntes ? '\n' : '') + sub.texto + (precisaQuebraDepois ? '\n' : '');
      out = antes + bloco + depois;
    }
    return { texto: out, foraDoRepo: null };
  }

  const resultado = expandir(String(texto ?? ''), dirRaiz, 1, new Set());
  return { ...resultado, naoResolvidos };
}

/**
 * Localiza a Bússola nos dois locais oficiais do Claude Code (LI-2): `<dir>/CLAUDE.md` e
 * `<dir>/.claude/CLAUDE.md`. Nenhum → `caminhos: []`. Um só → esse. Os dois → concatenados (raiz
 * primeiro) — se os dois trouxerem a seção completa, isso é `secao-duplicada`, corretamente. BOM
 * removido de CADA arquivo (LI-8).
 */
function localizarBussola(dir) {
  const caminhoRaiz = join(dir, ARQUIVO_ALVO);
  const caminhoOculto = join(dir, '.claude', ARQUIVO_ALVO);
  const temRaiz = existsSync(caminhoRaiz);
  const temOculto = existsSync(caminhoOculto);
  const caminhos = [];
  const partes = [];
  if (temRaiz) { partes.push(removerBOM(readFileSync(caminhoRaiz, 'utf8'))); caminhos.push(caminhoRaiz); }
  if (temOculto) { partes.push(removerBOM(readFileSync(caminhoOculto, 'utf8'))); caminhos.push(caminhoOculto); }
  return { caminhos, bruto: caminhos.length ? partes.join('\n') : null };
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  if (i >= 0 && !argv[i + 1]) { console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`); return 2; }
  const dir = i >= 0 ? argv[i + 1] : cwd;

  // LI-5: --dir apontando pra pasta que NÃO EXISTE (ou não é pasta) é entrada errada, não "sem CLAUDE.md".
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`[${NOME}] NÃO MEDIU: --dir "${dir}" não existe (ou não é uma pasta) — confira o caminho (typo, cwd errado no CI, template movido).`);
    return 2;
  }

  const { caminhos, bruto } = localizarBussola(dir);
  if (caminhos.length === 0) {
    console.log(`[${NOME}] ✅ NÃO SE APLICA: ${dir} não tem ${ARQUIVO_ALVO} (nem em .claude/${ARQUIVO_ALVO}).`);
    return 0;
  }

  const { texto, foraDoRepo, naoResolvidos } = resolverImportsRecursivo(bruto, dir);
  if (foraDoRepo) {
    console.error(`[${NOME}] FALHA: import-fora-do-repo — "@${foraDoRepo.especificador}" resolve para ${foraDoRepo.alvo}, fora de ${dir}.`);
    console.error(
      `[${NOME}] COMO PASSAR: a Bússola não pode depender de um arquivo fora do projeto — traga o ` +
      `conteúdo pra dentro de ${dir} ou remova o import.`,
    );
    console.error(
      `[${NOME}] POR QUE EXISTE: um import externo pode não estar disponível (aprovação recusada, ` +
      `caminho de outra máquina) — a bússola não pode depender de algo fora do repo.`,
    );
    return 1;
  }

  const veredito = auditarLeis(despirMarkdown(texto));
  if (veredito.ok) {
    console.log(`[${NOME}] ✅ as 12 leis estão íntegras em ${caminhos.join(' + ')}.`);
    return 0;
  }
  for (const p of veredito.problemas) console.error(`[${NOME}] FALHA: ${p}`);
  if (naoResolvidos.length) {
    console.error(`[${NOME}] NOTA: também não resolvi estas referências "@..." (podem ser menções, não imports): ${[...new Set(naoResolvidos)].join(', ')}`);
  }
  console.error(
    `[${NOME}] COMO PASSAR: restaure a seção "## AS 12 LEIS DO DESENVOLVIMENTO" com as 12 leis ` +
    `canônicas, na ordem 1..12, com o nome em negrito exatamente igual ao de templates/CLAUDE.md — ` +
    `fora de comentário HTML, bloco de código cercado ou code span.`,
  );
  console.error(
    `[${NOME}] POR QUE EXISTE: a Bússola é a única fonte de verdade do método — se o texto for ` +
    `editado em silêncio (lei sumida/trocada/renomeada/escondida em comentário), toda sessão nova ` +
    `passa a segui-la errada sem ninguém perceber.`,
  );
  return 1;
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) {
    // SEM `await` no topo do módulo de propósito: o companheiro importa este arquivo de volta
    // (`../leis-integrity.mjs`, ciclo estático) — `await` aqui deixaria ESTE módulo "evaluating-async"
    // enquanto o companheiro tenta reimportá-lo, um deadlock real do linker de ESM. Sem `await`, este
    // módulo termina de avaliar (síncrono) antes do import() assentar — quebra o ciclo, mesmo
    // comportamento (Node segura o processo vivo até a Promise resolver).
    import('./selftest/leis-integrity.mjs').then(({ selfTest }) => {
      process.exitCode = selfTest();
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
