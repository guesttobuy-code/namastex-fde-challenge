/**
 * scripts/guards/selftest/duplicate-logic.mjs — SUÍTE do self-test do guard duplicate-logic.
 *
 * POR QUE ESTÁ AQUI (não dentro do guard): o guard + suíte embutida passou de 600 linhas VISUAIS
 *   (linhasVisuais(arquivo) = soma, por linha, de max(1, ceil(comprimento/160)) — decisão do kit,
 *   2026-09-11). O guard continua sendo a PORTA (`node scripts/guards/duplicate-logic.mjs --self-test`
 *   dá a MESMA saída e o MESMO exit de antes — só importa esta suíte por caminho relativo). Este
 *   arquivo importa as FUNÇÕES PURAS do guard por caminho relativo (`../duplicate-logic.mjs`) — nunca
 *   reimplementa (LEI 11) — e calcula o caminho do PRÓPRIO guard a partir do seu import.meta.url (não
 *   do import.meta.url do guard): a prova-de-vida copia a árvore scripts/ inteira pra um tmp e muta
 *   só o arquivo do guard nessa cópia — os casos de PORTA-como-processo, e o auto-check da DL-03,
 *   precisam mirar o guard MUTADO da cópia, não o original.
 *
 * CONTRA-PROVA: node scripts/guards/duplicate-logic.mjs --self-test (não rode este arquivo direto).
 */
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../../lib/guard-doctrine.mjs';
import { acharDeclaracoes, acharDuplicatas, NOME, MAX_BYTES, MARCADOR_OPTOUT } from '../duplicate-logic.mjs';

// caminho do GUARD (não deste arquivo) — resolvido a partir da PRÓPRIA localização, pra funcionar
// igual na árvore real e numa cópia tmp da prova-de-vida (que muta só o duplicate-logic.mjs copiado).
const GUARD = fileURLToPath(new URL('../duplicate-logic.mjs', import.meta.url));
// ─── fixtures do self-test: corpos com lógica REAL, ~40+ tokens / ≥5 linhas, sem catch/segredo ─────
const CORPO_A = '\n  let total = 0;\n  for (let i = 0; i < itens.length; i++) {\n' +
  '    const preco = itens[i].valor * itens[i].quantidade;\n    const desconto = preco * taxa;\n' +
  '    total = total + preco - desconto;\n  }\n  return Math.round(total * 100) / 100;\n';
const CORPO_A_RENOMEADO = '\n  let soma = 0;\n  for (let j = 0; j < lista.length; j++) {\n' +
  '    const bruto = lista[j].valor * lista[j].quantidade;\n    const abate = bruto * pct;\n' +
  '    soma = soma + bruto - abate;\n  }\n  return Math.round(soma * 100) / 100;\n';
const CORPO_DIFERENTE = '\n  let resultado = [];\n  for (const registro of registros) {\n' +
  '    if (registro.ativo && registro.saldo > limite) {\n      resultado.push({ id: registro.id, saldo: registro.saldo });\n    }\n' +
  '  }\n  return resultado.sort((x, y) => y.saldo - x.saldo);\n';
const CORPO_CURTO = '\n  return a + b;\n';
const CORPO_METODO = '\n    let acumulado = 0;\n    for (const linha of linhas) {\n      if (linha.ativo) {\n' +
  '        acumulado += linha.valor * linha.peso;\n      }\n    }\n    return acumulado / linhas.length;\n';
const fonteFunc = (nome, corpo) => `export function ${nome}(itens, taxa) {${corpo}}\n`;
const fonteFuncOptOut = (nome, corpo) => `export function ${nome}(itens, taxa) { // ${MARCADOR_OPTOUT}: implementação espelhada por design\n${corpo}}\n`;

export function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── acharDeclaracoes: as formas originais + o que NÃO é declaração ──
  check('acharDeclaracoes: function nomeada', acharDeclaracoes('function soma(a, b) {\n  return a + b;\n}\n').some((d) => d.nome === 'soma'));
  check('acharDeclaracoes: async function nomeada', acharDeclaracoes('async function busca(id) {\n  return id;\n}\n').some((d) => d.nome === 'busca'));
  check(
    'acharDeclaracoes: arrow com bloco (const nome = (args) => { })',
    acharDeclaracoes('const total = (a, b) => {\n  return a + b;\n};\n').some((d) => d.nome === 'total'),
  );
  check('acharDeclaracoes: arrow expressão-corpo (sem bloco) NÃO conta', acharDeclaracoes('const dobro = (a) => a * 2;\n').length === 0);
  check(
    'acharDeclaracoes: function expression (const nome = function(...) { })',
    acharDeclaracoes('const total = function(a, b) {\n  return a + b;\n};\n').some((d) => d.nome === 'total'),
  );
  check(
    'acharDeclaracoes: método-shorthand em classe',
    acharDeclaracoes('class X {\n  soma(a, b) {\n    return a + b;\n  }\n}\n').some((d) => d.nome === 'soma'),
  );
  check(
    'acharDeclaracoes: método literalmente chamado "get" (não é palavra de controle)',
    acharDeclaracoes('class M {\n  get(k) {\n    return this.mapa[k];\n  }\n}\n').some((d) => d.nome === 'get'),
  );
  check(
    'NUNCA CONFUNDE: chamada de método (obj.metodo(x)) não é declaração',
    acharDeclaracoes('resultado = obj.metodo(x);\nif (x) {\n  console.log(1);\n}\n').length === 0,
  );
  check(
    'NUNCA CONFUNDE: callback anônimo passado como argumento não vira declaração (sem nome)',
    acharDeclaracoes('lista.forEach(function (item) {\n  usa(item);\n});\n').length === 0,
  );
  check(
    'acharDeclaracoes: function com anotação de tipo de retorno (TS) ainda acha o corpo',
    acharDeclaracoes('function soma(a: number, b: number): number {\n  return a + b;\n}\n').some((d) => d.nome === 'soma'),
  );
  check(
    'acharDeclaracoes: reporta a linha certa da assinatura',
    acharDeclaracoes('linha1\nlinha2\nfunction f(x) {\n  return x;\n}\n').find((d) => d.nome === 'f')?.linha === 3,
  );
  check(
    'BYPASS (COMENTÁRIO/STRING): função "citada" em comentário/string não gera declaração real (despido)',
    acharDeclaracoes('// function fantasma(a) {\n//   return a;\n// }\nconst doc = "function fantasma(a) { return a; }";\n').length === 0,
  );

  // ── DL-04: formas de declaração que escapavam ──
  check(
    'DL-04: arrow de 1 parâmetro SEM parênteses (const f = itens => { ... })',
    acharDeclaracoes('const dobrarTudo = itens => {\n  return itens.map((x) => x * 2);\n};\n').some((d) => d.nome === 'dobrarTudo'),
  );
  check(
    'DL-04: campo de classe com arrow (calcularTotal = (itens, taxa) => { ... })',
    acharDeclaracoes(`class Servico {\n  calcularTotal = (itens, taxa) => {${CORPO_A}  };\n}\n`).some((d) => d.nome === 'calcularTotal'),
  );
  check(
    'DL-04: CJS (exports.calcularTotal = function (itens, taxa) { ... })',
    acharDeclaracoes(`exports.calcularTotal = function (itens, taxa) {${CORPO_A}};\n`).some((d) => d.nome === 'calcularTotal'),
  );
  check(
    'DL-04: atribuição a propriedade (obj.calcularTotal = (itens, taxa) => { ... })',
    acharDeclaracoes(`obj.calcularTotal = (itens, taxa) => {${CORPO_A}};\n`).some((d) => d.nome === 'calcularTotal'),
  );
  check(
    'DL-04: const com tipo TS antes do "=" (const f: Calc = (itens, taxa) => { ... })',
    acharDeclaracoes(`const f: Calc = (itens, taxa) => {${CORPO_A}};\n`).some((d) => d.nome === 'f'),
  );
  check(
    'DL-04: método chamado "delete" (não é palavra de controle)',
    acharDeclaracoes('class Mapa {\n  delete(chave) {\n    return this.dados[chave];\n  }\n}\n').some((d) => d.nome === 'delete'),
  );
  check(
    'DL-04: retorno com tipo objeto-literal (): { total: number } { ... })',
    acharDeclaracoes('function calcularTotal(itens): { total: number } {\n  return { total: 1 };\n}\n').some((d) => d.nome === 'calcularTotal'),
  );
  check(
    'DL-04: export default function anônimo → nome sintético "default"',
    acharDeclaracoes(`export default function (itens, taxa) {${CORPO_A}}\n`).some((d) => d.nome === 'default'),
  );

  // ── DL-05: falso-positivo em lógica realmente diferente (só varia no literal) ──
  check(
    'DL-05: validarEmail × validarCpf (diferem só no literal de string) → 0',
    (() => {
      const email = "export function validar(v) {\n  const alvo = String(v);\n" +
        "  const ok = alvo.includes('@') && alvo.length > 5;\n  const limpo = alvo.trim();\n" +
        "  return ok && limpo.length > 0;\n}\n";
      const cpf = "export function validar(v) {\n  const alvo = String(v);\n" +
        "  const ok = alvo.includes('.') && alvo.length > 5;\n  const limpo = alvo.trim();\n" +
        "  return ok && limpo.length > 0;\n}\n";
      return acharDuplicatas([{ arquivo: 'email.mjs', fonte: email }, { arquivo: 'cpf.mjs', fonte: cpf }]).length === 0;
    })(),
  );
  check(
    'DL-05: ehCep × ehPlaca (diferem só no literal de regex) → 0',
    (() => {
      const cep = 'export function ehValido(v) {\n  const alvo = String(v).trim();\n' +
        '  const re = /^[0-9]{5}-?[0-9]{3}$/;\n  const bateu = re.test(alvo);\n' +
        '  return bateu && alvo.length > 0;\n}\n';
      const placa = 'export function ehValido(v) {\n  const alvo = String(v).trim();\n' +
        '  const re = /^[A-Z]{3}-?[0-9]{4}$/;\n  const bateu = re.test(alvo);\n' +
        '  return bateu && alvo.length > 0;\n}\n';
      return acharDuplicatas([{ arquivo: 'cep.mjs', fonte: cep }, { arquivo: 'placa.mjs', fonte: placa }]).length === 0;
    })(),
  );
  check(
    'DL-05: ternário "modo ? carregar(env) : {obj}" não vira uma 2ª declaração de "carregar" (o ramo-objeto não é corpo)',
    (() => {
      const fonte = `const cfg = modo ? carregar(env) : { chave: 'valor', outraChave: 'outroValor', maisUm: 'x' };\n` +
        `function carregar(env) {${CORPO_DIFERENTE}}\n`;
      return acharDeclaracoes(fonte).filter((d) => d.nome === 'carregar').length === 1;
    })(),
  );
  check(
    'DL-05: pasta de teste no SINGULAR (test/, não só tests/) fica fora da varredura',
    acharDuplicatas([
      { arquivo: 'aa.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
      { arquivo: 'test/bb.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
    ]).length === 0,
  );
  check(
    'DL-05: reformatação pura (tabs × espaços) ainda conta como tipo 1',
    (() => {
      const comTabs = fonteFunc('calcularTotal', CORPO_A.replace(/  /g, '\t'));
      const r = acharDuplicatas([{ arquivo: 'fmt-a.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) }, { arquivo: 'fmt-b.mjs', fonte: comTabs }]);
      return r.length === 1 && r[0].tipo === 1;
    })(),
  );
  check(
    'DL-05 (R4): api.buscar(id) × banco.remover(id) — nome de PROPRIEDADE/método depois do "." é ' +
      'semântico (não uma variável renomeada); alvo de chamada DIFERENTE não casa estruturalmente → 0',
    (() => {
      const corpoUsuario = '\n  let total = 0;\n  for (let i = 0; i < itens.length; i++) {\n' +
        '    const preco = api.buscar(itens[i]) * itens[i].quantidade;\n    const desconto = preco * taxa;\n' +
        '    total = total + preco - desconto;\n  }\n  return Math.round(total * 100) / 100;\n';
      const corpoPedido = '\n  let total = 0;\n  for (let i = 0; i < itens.length; i++) {\n' +
        '    const preco = banco.remover(itens[i]) * itens[i].quantidade;\n    const desconto = preco * taxa;\n' +
        '    total = total + preco - desconto;\n  }\n  return Math.round(total * 100) / 100;\n';
      return acharDuplicatas([
        { arquivo: 'carregarUsuario.mjs', fonte: fonteFunc('carregarUsuario', corpoUsuario) },
        { arquivo: 'apagarPedido.mjs', fonte: fonteFunc('apagarPedido', corpoPedido) },
      ]).length === 0;
    })(),
  );
  check(
    'DL-05 (R4): clone INTERNO (helper aninhado) totalmente contido no clone EXTERNO, mesmos 2 ' +
      'arquivos → 1 grupo só (o helper duplicado já está coberto pela função que o contém, não é um 2º achado)',
    (() => {
      const fonteComHelper = (nomeExterno) => `export function ${nomeExterno}(grupos) {\n` +
        `  function ajudaCalculo(linhas) {${CORPO_METODO}  }\n` +
        `  let total = 0;\n  for (const grupo of grupos) {\n    total = total + ajudaCalculo(grupo.linhas);\n  }\n` +
        `  return total;\n}\n`;
      const r = acharDuplicatas([
        { arquivo: 'ext1.mjs', fonte: fonteComHelper('processarGrupos') },
        { arquivo: 'ext2.mjs', fonte: fonteComHelper('processarGrupos') },
      ]);
      return r.length === 1;
    })(),
  );

  // ── acharDuplicatas: os casos originais da spec ──
  check(
    'BYPASS: duas funções idênticas em 2 arquivos → 1 grupo (tipo 1, exato)',
    (() => {
      const r = acharDuplicatas([
        { arquivo: 'a.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
        { arquivo: 'b.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
      ]);
      return r.length === 1 && r[0].tipo === 1 && r[0].ocorrencias.length === 2;
    })(),
  );
  check(
    'BYPASS: mesma lógica com variáveis renomeadas (tipo 2, estrutural) → flagra',
    (() => {
      const r = acharDuplicatas([
        { arquivo: 'c.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
        { arquivo: 'd.mjs', fonte: fonteFunc('calcularOutro', CORPO_A_RENOMEADO) },
      ]);
      return r.length === 1 && r[0].tipo === 2 && r[0].ocorrencias.length === 2;
    })(),
  );
  check(
    'BYPASS: método (shorthand) duplicado entre classes em arquivos diferentes → flagra',
    (() => {
      const a = `class ServicoA {\n  calcularMedia(linhas) {${CORPO_METODO}  }\n}\nexport default ServicoA;\n`;
      const b = `class ServicoB {\n  calcularMedia(linhas) {${CORPO_METODO}  }\n}\nexport default ServicoB;\n`;
      const r = acharDuplicatas([{ arquivo: 'q.mjs', fonte: a }, { arquivo: 'r.mjs', fonte: b }]);
      return r.length === 1 && r[0].tipo === 1;
    })(),
  );
  check(
    'BYPASS: duplicação DENTRO do mesmo arquivo (2 funções no mesmo arquivo) também flagra',
    (() => {
      const fonte = fonteFunc('foo', CORPO_A) + fonteFunc('bar', CORPO_A);
      const r = acharDuplicatas([{ arquivo: 's.mjs', fonte }]);
      return r.length === 1 && r[0].ocorrencias.length === 2;
    })(),
  );
  check(
    'NUNCA BLOQUEIA: corpo curto (poucas linhas/tokens, abaixo do mínimo) → 0',
    acharDuplicatas([
      { arquivo: 'e.mjs', fonte: fonteFunc('somaCurta', CORPO_CURTO) },
      { arquivo: 'f.mjs', fonte: fonteFunc('somaCurta', CORPO_CURTO) },
    ]).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: funções com lógica diferente → 0',
    acharDuplicatas([
      { arquivo: 'g.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
      { arquivo: 'h.mjs', fonte: `export function filtrarAtivos(registros, limite) {${CORPO_DIFERENTE}}\n` },
    ]).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: arquivo em __tests__/ fica fora da varredura (mesmo com corpo duplicado real)',
    acharDuplicatas([
      { arquivo: 'i.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
      { arquivo: '__tests__/j.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
    ]).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: arquivo *.test.mjs fica fora da varredura',
    acharDuplicatas([
      { arquivo: 'k.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
      { arquivo: 'l.test.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
    ]).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: função "citada" em comentário/string não conta como 2ª ocorrência (despido)',
    (() => {
      const fonte = `${fonteFunc('calcularTotal', CORPO_A)}\n` +
        `// cópia: export function calcularTotal(itens, taxa) { let total = 0; }\n` +
        `const doc = ${JSON.stringify(fonteFunc('calcularTotal', CORPO_A))};\n`;
      return acharDuplicatas([{ arquivo: 'o.mjs', fonte }]).length === 0;
    })(),
  );
  check(
    'NUNCA BLOQUEIA: export + re-export da MESMA função não vira 2 ocorrências',
    acharDuplicatas([{ arquivo: 'p.mjs', fonte: `${fonteFunc('calcularTotal', CORPO_A)}export { calcularTotal as calcularTotalV2 };\n` }]).length === 0,
  );
  check(
    'NUNCA BLOQUEIA (VAZIO/NULO): lista vazia, ou fonte vazia/undefined em todo arquivo → 0',
    acharDuplicatas([]).length === 0 && acharDuplicatas([
      { arquivo: 'v.mjs', fonte: '' },
      { arquivo: 'w.mjs', fonte: undefined },
    ]).length === 0 && acharDuplicatas(null).length === 0,
  );

  // ── DL-07: opt-out exige motivo + comentário real, e só isenta quando TODAS as ocorrências marcam ──
  check(
    'DL-07: opt-out COM motivo em comentário real nos DOIS lados → isenta o grupo',
    acharDuplicatas([
      { arquivo: 'm.mjs', fonte: fonteFuncOptOut('calcularTotal', CORPO_A) },
      { arquivo: 'n.mjs', fonte: fonteFuncOptOut('calcularTotal', CORPO_A) },
    ]).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: sem opt-out, o MESMO par ainda reprova (controle do caso acima)',
    acharDuplicatas([
      { arquivo: 'm2.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
      { arquivo: 'n2.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
    ]).length === 1,
  );
  check(
    'BYPASS (DL-07): opt-out SÓ NUMA ponta do par NÃO isenta o grupo — continua reprovando e diz qual lado falta',
    (() => {
      const r = acharDuplicatas([
        { arquivo: 'op1.mjs', fonte: fonteFuncOptOut('calcularTotal', CORPO_A) },
        { arquivo: 'op2.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
      ]);
      if (r.length !== 1) return false;
      const marcada = r[0].ocorrencias.find((o) => o.arquivo === 'op1.mjs');
      const semMarca = r[0].ocorrencias.find((o) => o.arquivo === 'op2.mjs');
      return marcada?.marcado === true && semMarca?.marcado === false;
    })(),
  );
  check(
    'BYPASS (DL-07): opt-out SEM motivo (só o marcador, sem ": <motivo>") não isenta',
    (() => {
      const semMotivo = (nome, corpo) => `export function ${nome}(itens, taxa) { // ${MARCADOR_OPTOUT}\n${corpo}}\n`;
      return acharDuplicatas([
        { arquivo: 'sm1.mjs', fonte: semMotivo('calcularTotal', CORPO_A) },
        { arquivo: 'sm2.mjs', fonte: semMotivo('calcularTotal', CORPO_A) },
      ]).length === 1;
    })(),
  );
  check(
    'BYPASS (DL-07): opt-out dentro de uma STRING de código (não de um comentário) não isenta',
    (() => {
      const emString = (nome, corpo) => `export function ${nome}(itens, taxa) { const _x = ` +
        `"${MARCADOR_OPTOUT}: implementação espelhada por design";\n${corpo}}\n`;
      return acharDuplicatas([
        { arquivo: 'es1.mjs', fonte: emString('calcularTotal2', CORPO_A) },
        { arquivo: 'es2.mjs', fonte: emString('calcularTotal2', CORPO_A) },
      ]).length === 1;
    })(),
  );

  // ── DL-06: limiar exige os DOIS lados (tokens E linhas), isolados um do outro ──
  check(
    'DL-06: linhas >= 5 mas tokens < 40 (só o mínimo de linhas bate) → 0',
    (() => {
      const c = '\n  let x = 1;\n\n\n  x = 2;\n\n\n  return x;\n';
      return acharDuplicatas([{ arquivo: 'mt1.mjs', fonte: fonteFunc('f1', c) }, { arquivo: 'mt2.mjs', fonte: fonteFunc('f1', c) }]).length === 0;
    })(),
  );
  check(
    'DL-06: tokens >= 40 mas linhas < 5 (só o mínimo de tokens bate) → 0',
    (() => {
      const c = ' let a=1,b=2,c=3,d=4,e=5,f=6,g=7,h=8,i=9,j=10,k=11,l=12; return a+b+c+d+e+f+g+h+i+j+k+l; ';
      return acharDuplicatas([{ arquivo: 'tl1.mjs', fonte: fonteFunc('f2', c) }, { arquivo: 'tl2.mjs', fonte: fonteFunc('f2', c) }]).length === 0;
    })(),
  );
  check(
    'DL-06/M6: chamada encadeada (obj.metodo(x)) seguida de BLOCO SOLTO na linha de baixo não vira declaração',
    acharDeclaracoes('obj.metodo(x)\n{\n  console.log(1);\n  console.log(2);\n  console.log(3);\n  console.log(4);\n}\n').length === 0,
  );
  check(
    'DL-06/M8: "const y = (x)" seguido de BLOCO SOLTO (sem "=>") não vira declaração',
    acharDeclaracoes('const y = (x)\n{\n  console.log(x);\n  console.log(x);\n  console.log(x);\n  console.log(x);\n}\n').length === 0,
  );
  check(
    'DL-06 (R3/M8): BLOCO SOLTO com bloco ANINHADO logo na abertura não engana a exigência de "=>" ' +
      '(replay R2 do mutante M8 — sem esta checagem, "y" registraria o bloco interno como corpo)',
    acharDeclaracoes('const y = (x)\n{ {\n  console.log(x);\n  console.log(x);\n  console.log(x);\n  console.log(x);\n}\n}\n').length === 0,
  );

  // ── DL-01: identificador acentuado / com caractere invisível ainda flagra tipo 2, NFC normaliza ──
  check(
    'DL-01: identificador acentuado ("preco" → "preço") ainda flagra (tipo 2)',
    (() => {
      const comAcento = CORPO_A.replace(/\bpreco\b/g, 'preço');
      const r = acharDuplicatas([
        { arquivo: 'ac1.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
        { arquivo: 'ac2.mjs', fonte: fonteFunc('calcularTotal', comAcento) },
      ]);
      return r.length === 1 && r[0].tipo === 2;
    })(),
  );
  check(
    'BYPASS (DL-01, INVISÍVEL): ZWNJ (U+200C) colado num identificador ("total" → "total\\u200c") ainda flagra',
    (() => {
      const comZwnj = CORPO_A.replace(/\btotal\b/g, 'total‌');
      return acharDuplicatas([
        { arquivo: 'zw1.mjs', fonte: fonteFunc('calcularTotal', CORPO_A) },
        { arquivo: 'zw2.mjs', fonte: fonteFunc('calcularTotal', comZwnj) },
      ]).length === 1;
    })(),
  );
  check(
    'DL-01: grafia NFC × NFD do MESMO acento ("preço") ainda flagra — normalize(NFC) equaliza',
    (() => {
      const nfc = CORPO_A.replace(/\bpreco\b/g, 'preço');
      const nfd = nfc.normalize('NFD');
      return acharDuplicatas([
        { arquivo: 'nf1.mjs', fonte: fonteFunc('calcularTotal', nfc) },
        { arquivo: 'nf2.mjs', fonte: fonteFunc('calcularTotal', nfd) },
      ]).length === 1;
    })(),
  );

  // ── DL-03: fechar/ehBinario vêm da lib compartilhada, não reimplementados localmente ──
  check(
    'DL-03: fechar/ehBinario NÃO são reimplementados neste arquivo (vêm de scripts/lib/) — auto-acusação resolvida na fonte',
    (() => {
      const meuFonte = readFileSync(GUARD, 'utf8');
      return !/\n\s*function\s+fechar\s*\(/.test(meuFonte) &&
        !/\n\s*function\s+ehBinario\s*\(/.test(meuFonte) &&
        /import\s*\{[^}]*\bfechar\b[^}]*\}\s*from\s*['"]\.\.\/lib\/despir-codigo\.mjs['"]/.test(meuFonte);
    })(),
  );

  // ── PORTA (issue #17): processo real, via --dir em árvores tmp ──
  const meu = GUARD;
  const envFilho = { ...process.env, npm_lifecycle_event: '' };
  const porta = (dir) => spawnSync(process.execPath, [meu, '--dir', dir], { encoding: 'utf8', timeout: 60_000, env: envFilho }).status;
  const comArg = (...args) => spawnSync(process.execPath, [meu, ...args], { encoding: 'utf8', timeout: 60_000, env: envFilho }).status;
  const limpo = mkdtempSync(join(tmpdir(), 'dl-limpo-'));
  const sujo = mkdtempSync(join(tmpdir(), 'dl-sujo-'));
  const comRef = mkdtempSync(join(tmpdir(), 'dl-ref-'));
  try {
    writeFileSync(join(limpo, 'unico.mjs'), fonteFunc('calcularTotal', CORPO_A));
    writeFileSync(join(limpo, 'diferente.mjs'), `export function filtrarAtivos(registros, limite) {${CORPO_DIFERENTE}}\n`);
    check('PORTA: --dir de árvore sem duplicação → exit 0', porta(limpo) === 0);
    writeFileSync(join(sujo, 'x.mjs'), fonteFunc('calcularTotal', CORPO_A));
    writeFileSync(join(sujo, 'y.mjs'), fonteFunc('calcularTotal', CORPO_A));
    check('PORTA: --dir com lógica duplicada → exit 1', porta(sujo) === 1);
    check('PORTA: --dir sem caminho → exit 2', comArg('--dir') === 2);
    check('PORTA: --dir inexistente → exit 2', porta(join(sujo, 'nao-existe')) === 2);
    mkdirSync(join(comRef, 'referencia', 'minado', 'duplicate-logic'), { recursive: true });
    writeFileSync(join(comRef, 'referencia', 'minado', 'duplicate-logic', 'a.mjs'), fonteFunc('calcularTotal', CORPO_A));
    writeFileSync(join(comRef, 'referencia', 'minado', 'duplicate-logic', 'b.mjs'), fonteFunc('calcularTotal', CORPO_A));
    // arquivo LEGÍTIMO fora de "referencia", pra "medidos" não ficar em 0 (DL-08 é outro caso).
    writeFileSync(join(comRef, 'fora.mjs'), `export function filtrarAtivos(registros, limite) {${CORPO_DIFERENTE}}\n`);
    check('PORTA (RENOMEAR/PATH): --dir no topo PULA a subpasta "referencia" (0, mesmo com dup lá dentro)', porta(comRef) === 0);
    check('PORTA: --dir apontando PRA DENTRO de referencia funciona (acha a dup)', porta(join(comRef, 'referencia', 'minado', 'duplicate-logic')) === 1);
  } finally {
    rmSync(limpo, { recursive: true, force: true });
    rmSync(sujo, { recursive: true, force: true });
    rmSync(comRef, { recursive: true, force: true });
  }
  // ── DL-08: argv malformado, 0 arquivos medidos, "referencia" só na RAIZ do --dir ──
  const argvRuim = mkdtempSync(join(tmpdir(), 'dl-argv-'));
  try {
    writeFileSync(join(argvRuim, 'x.mjs'), fonteFunc('calcularTotal', CORPO_A));
    writeFileSync(join(argvRuim, 'y.mjs'), fonteFunc('calcularTotal', CORPO_A));
    check('PORTA (DL-08): --dir=<caminho> (forma com "=") é reconhecido — acha a dup', comArg(`--dir=${argvRuim}`) === 1);
    check('PORTA (DL-08): --dir= sem valor → NÃO MEDIU exit 2', comArg('--dir=') === 2);
    check('PORTA (DL-08): flag desconhecida → NÃO MEDIU exit 2 (não cai pro cwd calado)', comArg('--diretorio', argvRuim) === 2);
  } finally { rmSync(argvRuim, { recursive: true, force: true }); }
  const soMd = mkdtempSync(join(tmpdir(), 'dl-somd-'));
  try {
    writeFileSync(join(soMd, 'doc.md'), '# título\nsem código nenhum aqui.\n');
    check(
      'PORTA (DL-08): --dir só com .md (0 arquivos de código) → NÃO MEDIU exit 2 (antes dava ✅)',
      porta(soMd) === 2,
    );
  } finally { rmSync(soMd, { recursive: true, force: true }); }
  const refProfundo = mkdtempSync(join(tmpdir(), 'dl-refprof-'));
  try {
    mkdirSync(join(refProfundo, 'src', 'modulos', 'referencia'), { recursive: true });
    writeFileSync(join(refProfundo, 'src', 'pedido.mjs'), fonteFunc('calcularTotal', CORPO_A));
    writeFileSync(join(refProfundo, 'src', 'modulos', 'referencia', 'tabela.mjs'), fonteFunc('calcularTotal', CORPO_A));
    check('PORTA (DL-08/RENOMEAR): pasta "referencia" ANINHADA (não é a raiz do --dir) NÃO é pulada — a dup é achada', porta(refProfundo) === 1);
  } finally { rmSync(refProfundo, { recursive: true, force: true }); }
  // ── DL-02: arquivo acima do teto de tamanho e NUL num comentário ──
  const grande = mkdtempSync(join(tmpdir(), 'dl-grande-'));
  try {
    writeFileSync(join(grande, 'grande.mjs'), `/* ${'x'.repeat(MAX_BYTES + 1024)} */\n` + fonteFunc('calcularTotal', CORPO_A));
    check(
      'PORTA (DL-02): arquivo de código acima do teto → NÃO MEDIU exit 2 (nunca ✅ calado)',
      porta(grande) === 2,
    );
  } finally { rmSync(grande, { recursive: true, force: true }); }
  // DL-06 (R3): a mesma checagem, mas com um arquivo NORMAL ao lado do gigante (medidos > 0) — sem o
  // bloco `naoMedidos.length > 0` em principal(), o fallback "medidos === 0" mascara a falta e o
  // guard cairia no ✅ calado justamente no caso que a DL-02 existe pra proibir (replay do mutante M14).
  const grandeMisto = mkdtempSync(join(tmpdir(), 'dl-grande-misto-'));
  try {
    writeFileSync(join(grandeMisto, 'normal.mjs'), fonteFunc('outraFuncao', CORPO_DIFERENTE));
    writeFileSync(join(grandeMisto, 'grande.mjs'), `/* ${'x'.repeat(MAX_BYTES + 1024)} */\nexport function semDuplicata() { return 1; }\n`);
    check('PORTA (DL-06/M14, arquivo grande AO LADO de um normal): ainda NÃO MEDIU exit 2, não cai no ✅ do "medidos>0"', porta(grandeMisto) === 2);
  } finally { rmSync(grandeMisto, { recursive: true, force: true }); }
  const comNul = mkdtempSync(join(tmpdir(), 'dl-nul-'));
  try {
    const corpoComNul = `// comentario com um byte NUL de verdade: [${String.fromCharCode(0)}] aqui dentro\n${CORPO_A}`;
    writeFileSync(join(comNul, 'a.mjs'), fonteFunc('calcularTotal', corpoComNul));
    writeFileSync(join(comNul, 'b.mjs'), fonteFunc('calcularTotal', corpoComNul));
    check('PORTA (DL-02): NUL dentro de um COMENTÁRIO não tira o arquivo da varredura — a dup ainda reprova', porta(comNul) === 1);
  } finally { rmSync(comNul, { recursive: true, force: true }); }

  // ── STACK (R6, 2026-09-11): "stack":"python" em esteira.json isenta este guard (só lê JS/TS) ──
  const stackPy = mkdtempSync(join(tmpdir(), 'dl-stack-py-'));
  const stackNode = mkdtempSync(join(tmpdir(), 'dl-stack-node-'));
  const stackRuim = mkdtempSync(join(tmpdir(), 'dl-stack-ruim-'));
  try {
    writeFileSync(join(stackPy, 'esteira.json'), JSON.stringify({ stack: 'python' }));
    writeFileSync(join(stackPy, 'a.mjs'), fonteFunc('calcularTotal', CORPO_A)); // clone de verdade — mas o projeto é python
    writeFileSync(join(stackPy, 'b.mjs'), fonteFunc('calcularTotal', CORPO_A));
    check('STACK: projeto python (esteira.json) → NAO_APLICAVEL exit 0, mesmo com clone no disco', porta(stackPy) === 0);
    writeFileSync(join(stackNode, 'esteira.json'), JSON.stringify({ stack: 'node' }));
    writeFileSync(join(stackNode, 'a.mjs'), fonteFunc('calcularTotal', CORPO_A));
    writeFileSync(join(stackNode, 'b.mjs'), fonteFunc('calcularTotal', CORPO_A));
    check('STACK: projeto node (explícito) → regra normal (reprova o clone)', porta(stackNode) === 1);
    writeFileSync(join(stackRuim, 'esteira.json'), '{ nao é json');
    writeFileSync(join(stackRuim, 'ok.mjs'), 'export const x = 1;\n');
    check('STACK: esteira.json com JSON inválido → NÃO MEDIU exit 2 (nunca "node" silencioso)', porta(stackRuim) === 2);
  } finally {
    rmSync(stackPy, { recursive: true, force: true });
    rmSync(stackNode, { recursive: true, force: true });
    rmSync(stackRuim, { recursive: true, force: true });
  }

  process.exitCode = relatarSelfTest(NOME, casos);
}
