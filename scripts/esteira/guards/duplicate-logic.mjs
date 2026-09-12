#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: o vício nº 1 da IA — reimplementar em vez de reusar. Mesma lógica em dois lugares
 *   ganha DOIS donos (LEI 11); quando um é corrigido e o outro não, o bug volta pela porta que
 *   ninguém olhou. Este guard caça CLONES de corpo de função (exato, ou estrutural com identificadores
 *   renomeados) entre arquivos e dentro do mesmo arquivo.
 *
 * INCIDENTE DE ORIGEM: preventivo — decisão do dono 2026-09-11 (ADR-0003, #21).
 *
 * O QUE FAZ: sob --dir (ou cwd), acha declarações de função no código DESPIDO (`function nome(`,
 *   arrow com/sem parênteses, function expression, atribuição a propriedade/membro — CJS
 *   `exports.x=`, campo de classe —, `export default function` anônimo, método-shorthand). Extrai o
 *   CORPO por profundidade de chaves e compara em duas variantes: tipo-1 (exato) usa o corpo só com
 *   COMENTÁRIO apagado (string/regex ficam com o conteúdo real — DL-05: só variar o LITERAL não é
 *   clone); tipo-2 (estrutural) troca por "$" só os IDENTIFICADORES REAIS (achados no código
 *   totalmente despido, aplicados por POSIÇÃO no corpo-com-literal — nunca um texto que por acaso
 *   PAREÇA identificador dentro de uma string). Identificador é Unicode (ID_Start/ID_Continue +
 *   ZWNJ/ZWJ) sobre o fonte normalizado NFC (DL-01). Só corpos com ≥40 tokens E ≥5 linhas entram.
 *   Grupo (por assinatura tipo-2) com ≥2 ocorrências NÃO isentas = FALHA, tipo 1 (todas idênticas
 *   modulo espaço) ou tipo 2 (ao menos uma difere só por identificador).
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. duas+ funções com o MESMO corpo (comentário à parte), modulo espaço, em locais diferentes;
 *   2. duas+ funções com o MESMO corpo estrutural com identificadores renomeados — mesmo quando o
 *      rename usa acento/caractere Unicode/invisível (DL-01);
 *   3. arquivo de código acima do teto de tamanho, ou com NUL num comentário, sumir da varredura com
 *      "✅" calado — vira NÃO MEDIU exit 2 (DL-02);
 *   4. opt-out sem motivo, dentro de STRING de código, ou marcando só UMA ponta do par isentar o grupo
 *      (DL-07) — só isenta quando TODAS as ocorrências trazem `duplicado-de-proposito: <motivo>`
 *      dentro de um COMENTÁRIO real;
 *   5. `--dir=x`/flag desconhecida caírem pro cwd calados, ou 0 arquivos medidos virar "✅" — ambos
 *      viram NÃO MEDIU exit 2 (DL-08); `referencia` só é pulada quando é EXATAMENTE `<--dir>/referencia`.
 *
 * O QUE NUNCA PODE BLOQUEAR (família de falsos-positivos):
 *   - corpo abaixo do mínimo (< 40 tokens OU < 5 linhas — o "E" é dos dois, cada metade sozinha não basta);
 *   - export + re-export da MESMA função; arquivo de teste/fixture (`*.test.*`, `*.spec.*`, `tests?/`,
 *     `__tests__/`, `spec/`, `fixtures/`, `__mocks__/`, singular ou plural — DL-05);
 *   - funções que só DIFEREM NO LITERAL — string/regex diferente é lógica DIFERENTE, não clone
 *     (DL-05: `validarEmail`×`validarCpf`, `ehCep`×`ehPlaca`); vale pro tipo-1 e pro tipo-2;
 *   - `identificador(args) : {obj}` dentro de TERNÁRIO não vira "declaração com corpo objeto" (DL-05:
 *     `pularAnotacaoTipo` balanceia `{}` de tipo/objeto antes de procurar o corpo real);
 *   - chamada encadeada (`obj.metodo(x)`), mesmo seguida de bloco solto na linha de baixo (filtro `.`);
 *   - reformatação pura (tabs↔espaços) não quebra a igualdade tipo-1/tipo-2;
 *   - opt-out `duplicado-de-proposito: <motivo>` DENTRO DE COMENTÁRIO na linha da assinatura isenta
 *     AQUELA ocorrência; só isenta o GRUPO quando TODAS as restantes estão marcadas (DL-07).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) só o CORPO entra na comparação — aridade/assinatura diferente ainda
 *   flagra (declarado); (b) clone PARCIAL — só corpo INTEIRO; (c) função anônima como callback direto
 *   (sem nome/alvo) fica fora — EXCETO `export default function(...)`, nome sintético `default`; (d)
 *   propriedade de objeto-literal solta (`{ chave: function(){} }`) fica fora — só
 *   `const/let/var`/`alvo.nome=`/método-shorthand contam; (e) genérico de TS na ASSINATURA
 *   (`foo<T>(`) quebra o casamento; retorno `): number {`/`): {x:number} {` é tolerado; tipo antes do
 *   `=` numa const tolerado SE não tiver `=`/`;`/`{` (tipo objeto na posição de VARIÁVEL é limite
 *   declarado); (f) IIFE anônima, mesmo motivo de (c); (g) literal diferente (string/regex/número) já
 *   quebra a igualdade, inclusive no tipo-2 — só o COMENTÁRIO é ignorado; (h) `.normalize('NFC')`
 *   equaliza NFC×NFD do mesmo acento (declarado; não trata confusáveis Unicode fora disso); (i) LIMITE
 *   DECLARADO (DL-05, replay 2026-09-11, ABERTO): no tipo-2, nome de PROPRIEDADE/método chamado depois
 *   de `.` é tratado como identificador renomeável igual a uma variável — `api.buscar(id)` ×
 *   `banco.remover(id)` (alvo de chamada DIFERENTE) ainda casam estruturalmente. Preservar o nome depois
 *   do `.` (ou o alvo de chamada) muda o que a comparação estrutural considera "a mesma forma" — decisão
 *   de design que este guard NÃO toma sozinho; pendente do coordenador. (j) CÓDIGO PYTHON (R6, 2026-09-11)
 *   — este guard só lê JS/TS; num projeto com "stack": "python" em esteira.json ele sai NAO_APLICAVEL
 *   (exit 0), ANTES de qualquer outra regra (inclusive a DL-08 "0 arquivo de código = NÃO MEDIU", que
 *   continua valendo em projeto node). Duplicação em Python NÃO é medida ainda — pendência declarada
 *   (ver CHANGELOG), não um "está limpo" fabricado.
 *
 * MODO DE FALHA JÁ ESCAPADO (1ª auditoria adversarial, 2026-09-11 — 8 achados; replay da reconciliação
 *   em 2026-09-11: 6 FECHADOS nesta mina, 1 DECLARADO (limite fora de escopo, decisão do coordenador) e
 *   1 parcialmente ABERTO (decisão de design pendente) — detalhe de cada um nos comentários da função
 *   correspondente):
 *   DL-01 (ALTA) identificador acentuado/invisível escapava do tipo-2 (regex ASCII) → Unicode+NFC. FECHADO.
 *   DL-02 (ALTA) arquivo >1MB/NUL em comentário sumia com "✅" calado → NÃO MEDIU exit 2 via `naoMedidos`. FECHADO.
 *   DL-03 (ALTA) reimplementava `fechar`/`ehBinario` da lib → importados (FECHADO); resto (duplicação
 *     ENTRE guards-irmãos: `escanear`/`ehBinario`/`medir` continuam clonados um no outro) é decisão do
 *     coordenador (GUARDS_PARALELO.md §7.7) e edição de OUTROS guards está fora do escopo desta mina —
 *     `node scripts/guards/duplicate-logic.mjs` na raiz do kit ainda sai 1 (DECLARADO, não FECHADO).
 *   DL-04 (MÉDIA) várias formas de declaração escapavam → novas regras de extração (ver acharDeclaracoes()). FECHADO.
 *   DL-05 (MÉDIA) FP em lógica só-diferente-no-literal/ternário/pasta test/ → literal preservado
 *     (FECHADO pra esses 4 casos). ABERTO: nome de PROPRIEDADE/método chamado ainda é tratado como
 *     identificador renomeável no tipo-2 — `api.buscar(id)` × `banco.remover(id)` (alvo de chamada
 *     DIFERENTE, não uma variável renomeada) ainda casam estruturalmente e reprovam; o conserto do
 *     auditor ("manter o nome de propriedade depois do `.`, ou o alvo de chamada") muda o que o tipo-2
 *     compara e não foi decidido — ver item (i) mais abaixo. NÃO é bug: helper interno duplicado junto
 *     com a função externa aparecer como 2 grupos (externo + interno) — são 2 clones REAIS distintos,
 *     não um falso-positivo (replay confirmou: sem decisão pra suprimir, mantido como está).
 *   DL-06 (MÉDIA) self-test não exercitava boa parte das regras → casos novos pra cada uma; replay da
 *     reconciliação (2026-09-11) achou 2 mutantes ainda sobreviventes nos casos originais e acrescentou
 *     "DL-06 (R3)": bloco aninhado logo na abertura de `const y = (x)\n{ {...} }` (mutante M8 — sem a
 *     checagem de "=>", registrava o bloco interno como corpo) e arquivo acima do teto AO LADO de um
 *     arquivo normal (mutante M14 — sem o bloco `naoMedidos.length > 0`, o fallback "medidos === 0"
 *     mascarava a falta e caía no "✅" calado que a DL-02 existe pra proibir). FECHADO.
 *   DL-07 (MÉDIA) opt-out sem motivo/em string/numa só ponta isentava o grupo → motivo+comentário+TODAS. FECHADO.
 *   DL-08 (BAIXA) `--dir=x`/flag desconhecida/0 medidos/`referencia` em qualquer profundidade → NÃO MEDIU.
 *
 * BANCA — as 10 classes:
 *   VAZIO — TRATADA: 0 declarações → 0 achados; 0 arquivos de código no escopo → NÃO MEDIU (DL-08).
 *   STRING/COMENTÁRIO — TRATADA: extração casa no código despido; dentro do corpo, só comentário some
 *     (string/regex ficam — DL-05); opt-out só conta dentro de comentário, não de string (DL-07).
 *   IMPORT/PATH — NÃO SE APLICA: varre conteúdo de arquivo, não segue import/alias/link.
 *   BASELINE — NÃO SE APLICA: sem allowlist; opt-out é por-declaração, exige motivo, só isenta com
 *     TODAS as ocorrências marcadas (DL-07).
 *   RENOMEAR — TRATADA: sair do --dir tira do escopo; renomear função é o ataque tipo-2 que este guard
 *     existe pra pegar; `referencia` só esconde a RAIZ do escopo, aninhada é varrida normal (DL-08).
 *   INVISÍVEL — TRATADA (DL-01): acento/ZWNJ/ZWJ reconhecidos como parte do identificador, NFC antes.
 *   NULO — TRATADA: fonte `null`/`undefined`/vazia → 0 declarações, nunca lança.
 *   SUBSTITUIR — NÃO SE APLICA: sem dependência externa mockável; roda sobre texto puro.
 *   TRUNCADO/TAMANHO — TRATADA (DL-02): acima do teto → NÃO MEDIU; NUL em comentário não some mais.
 *
 * CONTRA-PROVA: node scripts/guards/duplicate-logic.mjs --self-test
 *   (suíte em scripts/guards/selftest/duplicate-logic.mjs — este arquivo passou de 600 linhas visuais
 *   com a suíte embutida; a PORTA fica aqui, o guard importa a suíte por caminho relativo)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { relative, sep } from 'node:path';
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';
import { despirCodigo, fechar } from '../lib/despir-codigo.mjs';
import { varrerArvore } from '../lib/varredura.mjs';
import { RE_EXT_CODIGO } from '../lib/importes.mjs';
import { stackDoProjeto } from '../lib/stack.mjs';

export const NOME = 'duplicate-logic';
export const MAX_BYTES = 1024 * 1024;
export const MARCADOR_OPTOUT = 'duplicado-de-proposito';
// DL-07: o marcador só isenta com um MOTIVO de verdade depois dos dois-pontos (≥1 palavra), e (ver
// `estaEmComentario` abaixo) só quando está DENTRO de um comentário — nunca de uma string de código.
const RE_MARCADOR_COM_MOTIVO = /duplicado-de-proposito:\s*\S.{5,}/;
const MIN_TOKENS = 40;
const MIN_LINHAS = 5;
// Token = uma sequência de [\w$] (identificador/número) OU um char de pontuação isolado.
const RE_TOKEN = /[\w$]+|[^\s\w$]/g;
// Pasta de teste/fixture: fora da varredura (repetição de propósito) — singular e plural (DL-05).
const RE_TESTE_DIR = /(^|\/)(tests?|__tests__|spec|fixtures|__mocks__)(\/|$)/i;
const RE_TESTE_EXT = /\.(test|spec)\.[^/]+$/i;
// Palavras reservadas/literais de JS: NUNCA viram "$" na substituição estrutural (tipo-2) — ficam como
// estão (this/true/null/... não são "uma variável que foi renomeada").
const RESERVADAS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
  'new', 'return', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'let', 'static', 'enum', 'await', 'implements', 'interface', 'package',
  'private', 'protected', 'public', 'null', 'true', 'false', 'undefined', 'of', 'async',
]);
// DL-04: filtro do RE_METHOD — só as palavras de CONTROLE (que legitimamente aparecem como
// `palavra (cond) {`) são recusadas como nome de método. `delete`/`new`/`of`/`in`/... PODEM ser nome
// de método real (`class M { delete(k) { ... } }`) e não devem ser filtradas aqui.
const PALAVRAS_CONTROLE = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'typeof', 'do', 'else',
  'try', 'finally', 'throw', 'void', 'yield', 'await',
]);
// ─── identificador Unicode (DL-01): ID_Start/ID_Continue + $/_ + ZWNJ(U+200C)/ZWJ(U+200D) ──────────
const ID_START = '\\p{ID_Start}$_';
const ID_CONT = '\\p{ID_Continue}$_\\u200c\\u200d';
const ID_SRC = `[${ID_START}][${ID_CONT}]*`;
const RE_ID = new RegExp(ID_SRC, 'gu');
// tipo TS simples antes do "=" (const) ou depois do ")" (retorno): sem "=", ";" nem "{" — objeto-tipo
// complexo na posição de VARIÁVEL fica de fora (declarado no "O QUE NÃO VÊ" (e)).
const TIPO_SIMPLES = '(?::[^=;{]+)?';

// ─── extração de declarações (por profundidade de chaves/parênteses, no DESPIDO) ───────────────────
const RE_FUNC_DECL = new RegExp(`\\b(?:async\\s+)?function\\s*\\*?\\s+(${ID_SRC})\\s*\\(`, 'gu');
const RE_FUNC_DECL_DEFAULT_ANON = /\bexport\s+default\s+(?:async\s+)?function\s*\*?\s*\(/g;
const RE_ARROW = new RegExp(`\\b(?:const|let|var)\\s+(${ID_SRC})\\s*${TIPO_SIMPLES}=\\s*(?:async\\s*)?\\(`, 'gu');
// DL-04: arrow de 1 parâmetro SEM parênteses — `const f = x => { ... }` (só forma com BLOCO conta).
const RE_ARROW_BARE = new RegExp(`\\b(?:const|let|var)\\s+(${ID_SRC})\\s*${TIPO_SIMPLES}=\\s*(?:async\\s*)?(${ID_SRC})\\s*=>`, 'gu');
const RE_FUNC_EXPR = new RegExp(`\\b(?:const|let|var)\\s+(${ID_SRC})\\s*${TIPO_SIMPLES}=\\s*(?:async\\s+)?function\\b\\s*\\*?\\s*(?:${ID_SRC}\\s*)?\\(`, 'gu');
// DL-04: atribuição a MEMBRO (campo de classe sem const/let/var, CJS `exports.x =`, `obj.x =`) — exige
// contexto de início de statement (começo do texto, ou depois de `;{}` /quebra de linha) pra não casar
// no meio de uma expressão qualquer.
const RE_MEMBRO_FUNC = new RegExp(`(?:^|[;{}\\n]\\s*)((?:${ID_SRC}\\.)*${ID_SRC})\\s*=\\s*(?:async\\s+)?function\\b\\s*\\*?\\s*(?:${ID_SRC}\\s*)?\\(`, 'gu');
const RE_MEMBRO_ARROW = new RegExp(`(?:^|[;{}\\n]\\s*)((?:${ID_SRC}\\.)*${ID_SRC})\\s*=\\s*(?:async\\s*)?\\(`, 'gu');
const RE_MEMBRO_ARROW_BARE = new RegExp(`(?:^|[;{}\\n]\\s*)((?:${ID_SRC}\\.)*${ID_SRC})\\s*=\\s*(?:async\\s*)?(${ID_SRC})\\s*=>`, 'gu');
const RE_METHOD = new RegExp(`(${ID_SRC})\\s*\\(`, 'gu');

function pularEspaco(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/** Pula anotação de tipo opcional `: Tipo` a partir de `i`, parando em `{`/`=>`/`;`/`,`. Quando começa
 *  com `{` (tipo objeto-literal, `): { total: number } {`), balanceia o bloco INTEIRO como TIPO antes
 *  de continuar — senão o `{` do tipo viraria corpo da função (e, no ternário `cond ? f(x) : {obj}`, o
 *  objeto do ramo falso viraria corpo de uma declaração que não existe — DL-04/DL-05). */
function pularAnotacaoTipo(s, i) {
  i = pularEspaco(s, i);
  if (s[i] !== ':') return i;
  const inicioTipo = pularEspaco(s, i + 1);
  if (s[inicioTipo] === '{') {
    const fimTipo = fechar(s, inicioTipo, '{', '}');
    if (fimTipo < 0) return inicioTipo;
    return pularEspaco(s, fimTipo + 1);
  }
  let prof = 0, j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if ('([<'.includes(c)) prof++;
    else if (')]>'.includes(c)) { if (prof === 0) return j; prof--; }
    else if (prof === 0 && (c === '{' || c === ';' || c === ',' || (c === '=' && s[j + 1] === '>'))) return j;
    j++;
  }
  return j;
}

/** Extrai o BLOCO `{ ... }` que começa (depois de pular espaço + anotação de tipo opcional) em `apos`.
 *  Devolve {aberturaIdx, fimIdx} ou null se não há bloco ali (ex.: chamada normal, assinatura sem corpo). */
function extrairBloco(despido, apos) {
  const i = pularAnotacaoTipo(despido, apos);
  if (despido[i] !== '{') return null;
  const fim = fechar(despido, i, '{', '}');
  if (fim < 0) return null;
  return { aberturaIdx: i, fimIdx: fim };
}

const linhaDoIndice = (texto, idx) => texto.slice(0, idx).split('\n').length;

/** Como `despirCodigo`, mas só COMENTÁRIOS viram espaço (STRING/REGEX mantêm o literal — DL-05/DL-07).
 *  Deriva o resultado COMPARANDO `despirCodigo(fonte)` (dono único da decisão comentário/string/regex)
 *  com o original — em vez de reimplementar o tokenizer (3º dono — LEI 11) — avançando enquanto
 *  `despido` continuar "em branco" (dentro de um trecho apagado só há espaço/quebra — invariante da
 *  lib). Só BLOCO `/* *­/` e TEMPLATE atravessam `\n` (regra da lib); LINHA/regex param nele, pra uma
 *  construção diferente na linha de baixo não herdar a classificação da anterior. LIMITE: dois trechos
 *  colados sem espaço na MESMA linha (minificado) podem herdar a classificação um do outro — raro. */
function despirComentarios(fonte) {
  const s = String(fonte ?? '');
  const despido = despirCodigo(s);
  const out = new Array(s.length);
  const emBranco = (k) => despido[k] === ' ' || despido[k] === '\n';
  let i = 0;
  while (i < s.length) {
    if (despido[i] === s[i]) { out[i] = s[i]; i++; continue; }
    const c0 = s[i], c1 = s[i + 1];
    const comentarioBloco = c0 === '/' && c1 === '*';
    const comentarioLinha = c0 === '/' && c1 === '/';
    const podeAtravessarLinha = comentarioBloco || c0 === '`'; // bloco /* */ e template `...` podem ser multi-linha
    let j = i;
    for (;;) {
      if (j >= s.length || !emBranco(j)) break;
      if (s[j] === '\n' && !podeAtravessarLinha) { j++; break; } // inclui o \n terminador, mas não atravessa
      j++;
    }
    const manterApagado = comentarioBloco || comentarioLinha;
    for (let k = i; k < j; k++) out[k] = manterApagado ? despido[k] : s[k];
    i = j;
  }
  return out.join('');
}

/** FUNÇÃO PURA: declarações de função de um fonte → [{nome, corpoDespido, corpoLiteral, linha}]. Sem
 *  fs, sem exit. `corpoDespido` (identificadores/estrutura, tudo mais em branco) localiza onde estão
 *  os identificadores REAIS; `corpoLiteral` (só comentário em branco) é o que entra na comparação
 *  (DL-05); ambos vêm do MESMO fonte normalizado NFC (DL-01), por isso têm o mesmo comprimento e os
 *  mesmos índices. `linha` é a linha da ASSINATURA no fonte original. */
export function acharDeclaracoes(fonte) {
  const fonteNFC = String(fonte ?? '').normalize('NFC');
  const despido = despirCodigo(fonteNFC);
  const literal = despirComentarios(fonteNFC);
  const usados = new Set(); // dedupe por índice de abertura do corpo (a mesma declaração não conta 2x)
  const out = [];
  const registrar = (nomeBruto, inicioDecl, bloco) => {
    if (!bloco || usados.has(bloco.aberturaIdx)) return;
    usados.add(bloco.aberturaIdx);
    const nome = nomeBruto.includes('.') ? nomeBruto.slice(nomeBruto.lastIndexOf('.') + 1) : nomeBruto;
    out.push({
      nome: nome || 'default',
      corpoDespido: despido.slice(bloco.aberturaIdx + 1, bloco.fimIdx),
      corpoLiteral: literal.slice(bloco.aberturaIdx + 1, bloco.fimIdx),
      linha: linhaDoIndice(despido, inicioDecl),
      // DL-05 (R4): linha de FECHAMENTO do corpo — só serve pra dedupe de grupo interno/externo em
      // acharDuplicatas (containment por faixa de linha); não muda achado nenhum por si só.
      linhaFim: linhaDoIndice(despido, bloco.fimIdx),
    });
  };
  const viaParen = (m) => {
    const idxParen = m.index + m[0].length - 1;
    const fimParen = fechar(despido, idxParen, '(', ')');
    if (fimParen < 0) return;
    registrar(m[1], m.index, extrairBloco(despido, fimParen + 1));
  };
  for (const m of despido.matchAll(RE_FUNC_DECL)) viaParen(m);
  for (const m of despido.matchAll(RE_FUNC_EXPR)) viaParen(m);
  for (const m of despido.matchAll(RE_MEMBRO_FUNC)) viaParen(m);
  for (const m of despido.matchAll(RE_FUNC_DECL_DEFAULT_ANON)) {
    const idxParen = m.index + m[0].length - 1;
    const fimParen = fechar(despido, idxParen, '(', ')');
    if (fimParen < 0) continue;
    registrar('default', m.index, extrairBloco(despido, fimParen + 1));
  }
  const viaArrowParens = (m) => {
    const idxParen = m.index + m[0].length - 1;
    const fimParen = fechar(despido, idxParen, '(', ')');
    if (fimParen < 0) return;
    const i = pularAnotacaoTipo(despido, fimParen + 1);
    if (despido[i] !== '=' || despido[i + 1] !== '>') return; // expressão-corpo ou não-arrow: fora do escopo
    registrar(m[1], m.index, extrairBloco(despido, i + 2));
  };
  for (const m of despido.matchAll(RE_ARROW)) viaArrowParens(m);
  for (const m of despido.matchAll(RE_MEMBRO_ARROW)) viaArrowParens(m);
  const viaArrowBare = (m) => registrar(m[1], m.index, extrairBloco(despido, m.index + m[0].length));
  for (const m of despido.matchAll(RE_ARROW_BARE)) viaArrowBare(m);
  for (const m of despido.matchAll(RE_MEMBRO_ARROW_BARE)) viaArrowBare(m);
  for (const m of despido.matchAll(RE_METHOD)) {
    const nome = m[1];
    if (PALAVRAS_CONTROLE.has(nome)) continue;
    let antes = m.index - 1;
    while (antes >= 0 && /\s/.test(despido[antes])) antes--;
    if (antes >= 0 && despido[antes] === '.') continue; // acesso a propriedade/chamada encadeada, não declaração
    const idxParen = m.index + m[0].length - 1;
    const fimParen = fechar(despido, idxParen, '(', ')');
    if (fimParen < 0) continue;
    registrar(nome, m.index, extrairBloco(despido, fimParen + 1));
  }

  return out;
}

const semEspacos = (s) => s.replace(/\s+/g, '');
/** DL-05 (R4): identificador logo depois de `.` (ignorando espaço) é nome de PROPRIEDADE/MÉTODO
 *  chamado — SEMÂNTICO, não uma variável renomeável. `api.buscar(id)` × `banco.remover(id)` têm ALVOS
 *  de chamada DIFERENTES (não a mesma forma com nome trocado) e não podem casar estruturalmente só
 *  porque a base (`api`/`banco`) foi tratada como identificador. Só o nome IMEDIATAMENTE depois do
 *  ponto conta como membro; a base antes do primeiro ponto continua normalizável (é ela quem pode ter
 *  sido renomeada de verdade). */
function ehAcessoDeMembro(despido, idx) {
  let j = idx - 1;
  while (j >= 0 && /\s/.test(despido[j])) j--;
  return j >= 0 && despido[j] === '.';
}
/** Troca por "$" só os IDENTIFICADORES REAIS — achados via posição em `corpoDespido` (imune a texto
 *  parecido com identificador dentro de uma string) — e aplica a troca no `corpoLiteral` (que tem o
 *  literal de verdade). Ambos vêm do MESMO corte, mesmo comprimento: a posição de um casa 1:1 com a
 *  do outro. Nome de propriedade/método depois de `.` fica com o texto original (DL-05, `ehAcessoDeMembro`).*/
function substituirIdentificadoresPorPosicao(corpoDespido, corpoLiteral) {
  let out = '';
  let last = 0;
  RE_ID.lastIndex = 0;
  let m;
  while ((m = RE_ID.exec(corpoDespido))) {
    const id = m[0];
    out += corpoLiteral.slice(last, m.index);
    out += (RESERVADAS.has(id) || ehAcessoDeMembro(corpoDespido, m.index)) ? corpoLiteral.slice(m.index, m.index + id.length) : '$';
    last = m.index + id.length;
  }
  out += corpoLiteral.slice(last);
  return out;
}
const ehArquivoDeTeste = (rel) => RE_TESTE_DIR.test(rel) || RE_TESTE_EXT.test(rel);

/** O marcador na linha (crua) está DENTRO DE UM COMENTÁRIO de verdade, com motivo? Compara a linha
 *  CRUA (onde o marcador aparece) com a mesma linha depois de só apagar comentário
 *  (`despirComentarios`) — se o marcador SOME nessa segunda versão, estava dentro do comentário
 *  apagado; se PERSISTE, estava em código real ou numa STRING (preservada) — não conta (DL-07). */
function optOutValido(linhaCrua, linhaSoComentario) {
  return RE_MARCADOR_COM_MOTIVO.test(linhaCrua) && !linhaSoComentario.includes(MARCADOR_OPTOUT);
}

/** FUNÇÃO PURA: `porArquivo` = [{arquivo, fonte}] → achados de lógica duplicada. Sem fs, sem exit.
 *  Agrupa por assinatura ESTRUTURAL (tipo-2); um grupo só existe se ≥2 ocorrências sobrarem depois do
 *  filtro de teste/tamanho. Dentro do grupo, se TODAS as ocorrências também são idênticas byte-a-byte
 *  (tipo-1), o achado é tipo 1 (exato); senão é tipo 2 (estrutural). O grupo só é ISENTO quando TODAS
 *  as ocorrências têm opt-out válido (DL-07) — com parte marcada, ainda reprova e cada ocorrência leva
 *  a flag `marcado` pro relatório dizer qual lado falta. */
export function acharDuplicatas(porArquivo, opts = {}) {
  const minTokens = opts.minTokens ?? MIN_TOKENS;
  const minLinhas = opts.minLinhas ?? MIN_LINHAS;
  const ocorrencias = [];
  for (const entrada of porArquivo || []) {
    const arquivo = entrada?.arquivo;
    if (!arquivo || ehArquivoDeTeste(arquivo)) continue;
    const fonteNFC = String(entrada.fonte ?? '').normalize('NFC');
    const linhasCruas = fonteNFC.split('\n');
    const linhasSoComentario = despirComentarios(fonteNFC).split('\n');
    for (const d of acharDeclaracoes(fonteNFC)) {
      const linhas = (d.corpoDespido.match(/\n/g)?.length ?? 0) + 1;
      const tokens = d.corpoDespido.match(RE_TOKEN)?.length ?? 0;
      if (linhas < minLinhas || tokens < minTokens) continue;
      const linhaCrua = linhasCruas[d.linha - 1] ?? '';
      const linhaSoComentario = linhasSoComentario[d.linha - 1] ?? '';
      ocorrencias.push({
        arquivo, linha: d.linha, linhaFim: d.linhaFim, nome: d.nome,
        marcado: optOutValido(linhaCrua, linhaSoComentario),
        tipo1: semEspacos(d.corpoLiteral),
        tipo2: semEspacos(substituirIdentificadoresPorPosicao(d.corpoDespido, d.corpoLiteral)),
      });
    }
  }

  const porTipo2 = new Map();
  for (const o of ocorrencias) {
    if (!porTipo2.has(o.tipo2)) porTipo2.set(o.tipo2, []);
    porTipo2.get(o.tipo2).push(o);
  }

  const achadosBrutos = [];
  for (const grupo of porTipo2.values()) {
    if (grupo.length < 2) continue;
    if (grupo.every((o) => o.marcado)) continue; // isento SÓ quando TODAS as ocorrências têm opt-out válido (DL-07)
    const tipo1Unico = new Set(grupo.map((o) => o.tipo1)).size === 1;
    achadosBrutos.push({
      tipo: tipo1Unico ? 1 : 2,
      ocorrencias: grupo.map(({ arquivo, linha, linhaFim, nome, marcado }) => ({ arquivo, linha, linhaFim, nome, marcado })),
    });
  }

  // DL-05 (R4, parte 2): grupo INTERNO (helper aninhado) totalmente contido — mesmos arquivos, faixa de
  // linha de CADA ocorrência dentro da faixa da ocorrência correspondente — num grupo EXTERNO já
  // reportado não é um 2º achado: é o MESMO clone visto de dentro pra fora (a função que contém o
  // helper já flagra o par de arquivos; reportar o helper de novo é ruído, não um problema adicional).
  const mesmosArquivos = (a, b) => {
    const a1 = new Set(a.ocorrencias.map((o) => o.arquivo));
    const a2 = new Set(b.ocorrencias.map((o) => o.arquivo));
    return a1.size === a2.size && [...a1].every((x) => a2.has(x));
  };
  const contidoEm = (interno, externo) => mesmosArquivos(interno, externo) &&
    interno.ocorrencias.every((oi) => externo.ocorrencias.some((oe) =>
      oe.arquivo === oi.arquivo && oe.linha <= oi.linha && oi.linhaFim <= oe.linhaFim));
  const achados = achadosBrutos
    .filter((g, i) => !achadosBrutos.some((outro, j) => j !== i && contidoEm(g, outro)))
    .map((g) => ({ tipo: g.tipo, ocorrencias: g.ocorrencias.map(({ arquivo, linha, nome, marcado }) => ({ arquivo, linha, nome, marcado })) }));
  achados.sort((a, b) => {
    const ka = `${a.ocorrencias[0].arquivo}:${String(a.ocorrencias[0].linha).padStart(8, '0')}`;
    const kb = `${b.ocorrencias[0].arquivo}:${String(b.ocorrencias[0].linha).padStart(8, '0')}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return achados;
}

// ─── argv (DL-08): flag desconhecida ou `--dir=`/`--dir` sem valor → NÃO MEDIU, nunca cai pro cwd calado ──
function analisarArgv(argv) {
  let dir = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') {
      const v = argv[i + 1];
      if (!v) return { erro: '--dir sem caminho' };
      dir = v; i++; continue;
    }
    if (a.startsWith('--dir=')) {
      const v = a.slice('--dir='.length);
      if (!v) return { erro: '--dir= sem caminho' };
      dir = v; continue;
    }
    return { erro: `argumento desconhecido: ${a}` };
  }
  return { dir, erro: null };
}

/** Varre `dir`: arquivos de CÓDIGO (por extensão — DL-02: não faz mais sniff de binário, a extensão já
 *  diz que é código), pulando node_modules/.git sempre e `referencia` SÓ quando é exatamente
 *  `<dir>/referencia` (DL-08 — não em qualquer profundidade). Acima do teto de tamanho vira
 *  `naoMedidos` em vez de sumir calado (DL-02). */
function escanear(dir) {
  const relDe = (caminho) => relative(dir, caminho).split(sep).join('/');
  const pular = {
    has: (nome, caminho) => {
      if (nome === 'node_modules' || nome === '.git') return true;
      if (nome === 'referencia') return relDe(caminho) === 'referencia';
      return false;
    },
  };
  const { arquivos, naoMedidos } = varrerArvore(dir, {
    aceitar: (nome) => RE_EXT_CODIGO.test(nome),
    pular,
    maxBytes: MAX_BYTES,
    comoBuffer: false,
  });
  const porArquivo = arquivos.map((a) => ({ arquivo: relDe(a.caminho), fonte: a.conteudo }));
  return {
    achados: acharDuplicatas(porArquivo),
    medidos: arquivos.length,
    naoMedidos: naoMedidos.map((nm) => ({ arquivo: relDe(nm.caminho), motivo: nm.motivo })),
  };
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const { dir: dirArg, erro } = analisarArgv(argv);
  if (erro) { console.error(`[${NOME}] NÃO MEDIU: ${erro}. Uso: node duplicate-logic.mjs [--dir <caminho>]`); return 2; }
  const dir = dirArg ?? cwd;
  // R6 (2026-09-11): projeto declarado "stack":"python" não tem JS/TS pra este guard medir — NAO_APLICAVEL
  // exit 0, ANTES de qualquer outra regra (inclusive a DL-08 "0 arquivo de código = NÃO MEDIU" abaixo, que
  // continua valendo em projeto node). esteira.json sintaticamente inválido LANÇA → rodapé pega → exit 2.
  const stack = stackDoProjeto(dir);
  if (stack === 'python') { console.log(`[${NOME}] NAO_APLICAVEL: projeto declarado python no esteira.json — este guard só mede JS/TS.`); return 0; }
  const { achados, medidos, naoMedidos } = escanear(dir); // dir raiz ilegível/inexistente → lança → rodapé → exit 2

  if (achados.length > 0) {
    for (const a of achados) {
      const [primeira, ...resto] = a.ocorrencias;
      const tipoTxt = a.tipo === 1 ? '1, exato' : '2, estrutural — identificadores renomeados';
      const tag = (o) => (o.marcado ? '' : ' [SEM opt-out]');
      console.error(`[${NOME}] FALHA (logica-duplicada, tipo ${tipoTxt}): ${primeira.arquivo}:${primeira.linha} ` +
        `(${primeira.nome})${tag(primeira)} — mesmo corpo em ${a.ocorrencias.length} lugares:`);
      for (const o of resto) console.error(`[${NOME}]   também em ${o.arquivo}:${o.linha} (${o.nome})${tag(o)}`);
    }
    for (const nm of naoMedidos) console.error(`[${NOME}] AVISO (não medido): ${nm.arquivo} — ${nm.motivo}.`);
    console.error(`[${NOME}] COMO PASSAR: extraia o corpo comum para UMA função em scripts/lib/ (ou um módulo ` +
      `compartilhado do projeto) e chame-a nos dois lugares — dono único (LEI 11). Se a duplicação é MESMO ` +
      `intencional, comente "${MARCADOR_OPTOUT}: <motivo>" (dentro de um COMENTÁRIO real, com motivo) na MESMA ` +
      `linha da assinatura de CADA ocorrência que deve ficar isenta — falta UMA e o grupo inteiro continua reprovando.`);
    console.error(`[${NOME}] POR QUE EXISTE: reimplementar em vez de reusar cria dois donos da mesma regra — ` +
      `quando um lado é corrigido e o outro não, o bug volta pela porta que ninguém olhou.`);
    return 1;
  }

  if (naoMedidos.length > 0) { // achei 0 duplicatas no que LI, mas não li tudo → não afirmo "limpo" (doutrina: erra alto, nunca 0)
    for (const nm of naoMedidos) console.error(`[${NOME}] NÃO MEDIU: ${nm.arquivo} — ${nm.motivo}. ` +
      `Não posso afirmar "sem duplicação" sobre um arquivo que não li.`);
    console.error(`[${NOME}] COMO PASSAR: reduza o arquivo abaixo do teto (${MAX_BYTES} bytes) ou audite-o por fora.`);
    return 2;
  }

  if (medidos === 0) { // 0 arquivos de código no escopo → NÃO MEDI NADA, nunca "✅" (DL-08)
    console.error(`[${NOME}] NÃO MEDIU: nenhum arquivo de código em ${dir}.`);
    console.error(`[${NOME}] COMO PASSAR: confira o --dir — "0 arquivos" não é a mesma coisa que "medi e está limpo".`);
    return 2;
  }

  console.log(`[${NOME}] ✅ nenhuma lógica duplicada em ${dir} (${medidos} arquivo(s) medido(s)).`);
  return 0;
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) {
    // import DINÂMICO (não top-level await): a suíte importa ESTE arquivo de volta por caminho
    // relativo (LEI 11 — funções puras num dono só), e um `await` aqui, no topo do módulo que é o
    // próprio entrypoint, faz o ciclo (guard → suíte → guard) travar — Node acusa "unsettled top-level
    // await" (exit 13) porque o guard nunca termina de avaliar enquanto espera a suíte, que por sua vez
    // espera o guard "terminar de avaliar" pra resolver o import de volta. `.then()` evita o travamento:
    // o módulo termina de avaliar (síncrono) e só DEPOIS a suíte roda — o processo continua vivo até a
    // promise resolver, então o exit code sai certo do mesmo jeito.
    import('./selftest/duplicate-logic.mjs').then(({ selfTest }) => selfTest());
  } else {
    try { process.exitCode = principal(); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; }
  }
}

