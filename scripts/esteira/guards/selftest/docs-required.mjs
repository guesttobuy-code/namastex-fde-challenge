#!/usr/bin/env node
/**
 * ─── COMPANHEIRO DE TESTE — não é guard, não é a PORTA ──────────────────────
 * O QUE É: a SUÍTE do self-test de `scripts/guards/docs-required.mjs` — casos, fixtures e os
 *   helpers só de teste. O guard CONTINUA sendo a PORTA: `node scripts/guards/docs-required.mjs
 *   --self-test` importa este arquivo por caminho relativo dinâmico e roda `selfTest()` daqui —
 *   mesma saída, mesmo exit code de antes da divisão (Rodada 1, reconciliação R3, 2026-09-11:
 *   guard passava de 600 linhas VISUAIS com a suíte embutida).
 * POR QUE O CAMINHO DO GUARD VEM DE import.meta.url (não de um literal fixo): a prova-de-vida
 *   (`scripts/guards/prova-de-vida.mjs`) copia a árvore `scripts/` inteira para uma pasta tmp e
 *   muta SÓ o guard lá dentro — os casos de PORTA-como-processo têm que rodar o guard MUTADO da
 *   cópia, não o original do worktree. Como este arquivo é copiado junto (é parte de `scripts/`),
 *   calcular `GUARD_PATH` a partir do próprio `import.meta.url` sempre aponta pro guard vizinho na
 *   MESMA árvore em que este arquivo está rodando — cópia mutada incluída.
 * FUNÇÕES PURAS: importadas de `../docs-required.mjs` (caminho relativo, DONO ÚNICO da lógica —
 *   este arquivo não reimplementa nada, só testa).
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../../lib/guard-doctrine.mjs';
import {
  entradaValida,
  temConteudoReal,
  julgarEntradaRaiz,
  julgarArquivoModulo,
  medirArquivo,
  medirPasta,
} from '../docs-required.mjs';

const NOME = 'docs-required';
// caminho do guard MUTADO da cópia (ver "POR QUE" no cabeçalho) — nunca um literal fixo pro worktree.
const GUARD_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs-required.mjs');

// ── fixtures: helpers de árvore tmp para o self-test (sem tocar a árvore real) ──
function escrever(base, rel, conteudo) {
  const abs = join(base, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, conteudo);
}
function criarPasta(base, rel) {
  mkdirSync(join(base, rel), { recursive: true });
}

export function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── entradaValida: função pura ──
  check('entradaValida: string não-vazia → true', entradaValida('README.md') === true);
  check(
    'BYPASS (NULO): entradaValida(null)/undefined/""/"   " → false (nunca "válida" por acaso)',
    entradaValida(null) === false && entradaValida(undefined) === false &&
      entradaValida('') === false && entradaValida('   ') === false,
  );
  check('BYPASS (VAZIO): entradaValida sem argumento nenhum não lança, devolve false', entradaValida() === false);
  check(
    'DR-03: entradaValida recusa caminho absoluto (posix "/x" e drive "C:/x")',
    entradaValida('/etc/passwd') === false && entradaValida('C:/Windows') === false,
  );
  check(
    'DR-03: entradaValida recusa segmento ".." em qualquer posição',
    entradaValida('../README.md') === false && entradaValida('docs/../segredo') === false,
  );
  check(
    'DR-03: entradaValida recusa caminho que normaliza pra raiz ("." / "./" / "//")',
    entradaValida('.') === false && entradaValida('./') === false && entradaValida('//') === false,
  );
  check(
    'DR-10: entradaValida recusa barra invertida',
    entradaValida('governance\\adr\\') === false && entradaValida('docs\\README.md') === false,
  );
  check(
    'NUNCA BLOQUEIA: entradaValida aceita caminho relativo normal (com ou sem "/" final)',
    entradaValida('governance/adr/') === true && entradaValida('.arch-layers.json') === true,
  );

  // ── temConteudoReal: função pura (DR-04) ──
  check(
    'DR-04: temConteudoReal(vazio/espaço/BOM/invisível) → false',
    temConteudoReal('') === false && temConteudoReal('   \n\t') === false && temConteudoReal('\uFEFF\u200B\u2060') === false,
  );
  check('DR-04: temConteudoReal(bytes NUL) → false', temConteudoReal('\u0000\u0000\u0000\u0000') === false);
  check('NUNCA BLOQUEIA: temConteudoReal(texto real) → true', temConteudoReal('conteúdo real') === true && temConteudoReal('123') === true);

  // ── julgarEntradaRaiz: função pura, os fatos vêm prontos (sem fs) ──
  check('BYPASS: arquivo ausente → doc-ausente', julgarEntradaRaiz('README.md', { existe: false })?.tipo === 'doc-ausente');
  check(
    'BYPASS: arquivo com tamanho 0 → doc-vazio',
    julgarEntradaRaiz('README.md', { existe: true, tamanho: 0, soEspaco: false })?.tipo === 'doc-vazio',
  );
  check(
    'BYPASS: arquivo só espaço em branco (tamanho>0) → doc-vazio',
    julgarEntradaRaiz('README.md', { existe: true, tamanho: 3, soEspaco: true })?.tipo === 'doc-vazio',
  );
  check(
    'NUNCA BLOQUEIA: arquivo com conteúdo real → null (ok)',
    julgarEntradaRaiz('README.md', { existe: true, tamanho: 42, soEspaco: false }) === null,
  );
  check('BYPASS: pasta obrigatória ausente → doc-ausente', julgarEntradaRaiz('governance/adr/', { existe: false })?.tipo === 'doc-ausente');
  check(
    'BYPASS: pasta obrigatória vazia (0 arquivos) → doc-vazio',
    julgarEntradaRaiz('governance/adr/', { existe: true, qtdArquivos: 0 })?.tipo === 'doc-vazio',
  );
  check('NUNCA BLOQUEIA: pasta com ≥1 arquivo → null (ok)', julgarEntradaRaiz('governance/adr/', { existe: true, qtdArquivos: 1 }) === null);
  check(
    'BYPASS (NULO): fatos undefined/null nunca viram "ok" por engano — sempre doc-ausente',
    julgarEntradaRaiz('x', undefined)?.tipo === 'doc-ausente' && julgarEntradaRaiz('x', null)?.tipo === 'doc-ausente',
  );
  check(
    'DR-10 (caso puro): nó existe com TIPO ERRADO → "doc-tipo-errado", nunca "doc-ausente"',
    julgarEntradaRaiz('ARQUIVO.md', { existe: false, tipoErrado: 'pasta' })?.tipo === 'doc-tipo-errado' &&
      julgarEntradaRaiz('PASTA/', { existe: false, tipoErrado: 'arquivo' })?.tipo === 'doc-tipo-errado',
  );

  // ── julgarArquivoModulo: função pura ──
  check(
    'BYPASS: módulo sem CONTRACT.md (ausente) → modulo-sem-doc',
    julgarArquivoModulo('pagamentos', 'CONTRACT.md', { existe: false })?.tipo === 'modulo-sem-doc',
  );
  check(
    'BYPASS: módulo com CONTRACT.md vazio → modulo-sem-doc',
    julgarArquivoModulo('pagamentos', 'CONTRACT.md', { existe: true, tamanho: 0, soEspaco: false })?.tipo === 'modulo-sem-doc',
  );
  check(
    'DR-06 (caso puro): módulo com CONTRACT.md só espaço (soEspaco:true) → modulo-sem-doc',
    julgarArquivoModulo('pagamentos', 'CONTRACT.md', { existe: true, tamanho: 5, soEspaco: true })?.tipo === 'modulo-sem-doc',
  );
  check(
    'NUNCA BLOQUEIA: módulo com CONTRACT.md preenchido → null (ok)',
    julgarArquivoModulo('pagamentos', 'CONTRACT.md', { existe: true, tamanho: 10, soEspaco: false }) === null,
  );
  check('caminho do achado é "modulo/arquivo"', julgarArquivoModulo('pagamentos', 'CONTRACT.md', { existe: false })?.caminho === 'pagamentos/CONTRACT.md');

  // ── medirArquivo/medirPasta: DR-06 "casos puros" contra fs real, com o TIPO trocado ──
  const tmpTipo = mkdtempSync(join(tmpdir(), 'docs-req-tipo-'));
  try {
    criarPasta(tmpTipo, 'sou-pasta');
    escrever(tmpTipo, 'sou-arquivo', 'x\n');
    const rArq = medirArquivo(join(tmpTipo, 'sou-pasta'));
    check('DR-06/DR-10 (caso puro): medirArquivo numa PASTA real → existe:false, tipoErrado:"pasta"', rArq.existe === false && rArq.tipoErrado === 'pasta');
    const rPasta = medirPasta(join(tmpTipo, 'sou-arquivo'));
    check(
      'DR-06/DR-10 (caso puro): medirPasta num ARQUIVO real → existe:false, tipoErrado:"arquivo"',
      rPasta.existe === false && rPasta.tipoErrado === 'arquivo',
    );
    const rSumiu = medirArquivo(join(tmpTipo, 'nao-existe-de-verdade.md'));
    check('caso puro: medirArquivo em caminho inexistente → existe:false, sem tipoErrado', rSumiu.existe === false && rSumiu.tipoErrado === undefined);
  } finally {
    rmSync(tmpTipo, { recursive: true, force: true });
  }

  // ── PORTA (issue #17): processo real, via --dir em árvores tmp ──
  const porta = (dir, extra = []) =>
    spawnSync(process.execPath, [GUARD_PATH, '--dir', dir, ...extra], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, npm_lifecycle_event: '' },
    });
  const raizTmp = mkdtempSync(join(tmpdir(), 'docs-req-'));
  try {
    // NUNCA BLOQUEIA: sem config nenhum (e sem esteira.json) → NÃO SE APLICA, exit 0
    criarPasta(raizTmp, 'sem-config');
    escrever(raizTmp, 'sem-config/nada.txt', 'so um arquivo qualquer, sem governance/\n');
    check('NUNCA BLOQUEIA: sem config e sem esteira.json → NAO_APLICAVEL 0', porta(join(raizTmp, 'sem-config')).status === 0);

    // NUNCA BLOQUEIA: tudo presente (raiz + módulo) → 0
    escrever(raizTmp, 'ok/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['README.md', 'governance/adr/'], porModulo: ['CONTRACT.md'] }));
    escrever(raizTmp, 'ok/README.md', '# projeto\nconteúdo real\n');
    escrever(raizTmp, 'ok/governance/adr/0001-exemplo.md', '# ADR 0001\n');
    escrever(raizTmp, 'ok/.arch-layers.json', JSON.stringify({ modulos: { raiz: 'src/modules' } }));
    escrever(raizTmp, 'ok/src/modules/pagamentos/CONTRACT.md', '# contrato do módulo pagamentos\n');
    check('NUNCA BLOQUEIA: tudo presente (raiz + módulo) → 0', porta(join(raizTmp, 'ok')).status === 0);

    // BYPASS: arquivo obrigatório faltando → 1
    escrever(raizTmp, 'falta-arquivo/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['README.md'] }));
    check('BYPASS: arquivo obrigatório faltando → 1', porta(join(raizTmp, 'falta-arquivo')).status === 1);

    // BYPASS: pasta obrigatória vazia → 1
    escrever(raizTmp, 'pasta-vazia/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['docs/'] }));
    criarPasta(raizTmp, 'pasta-vazia/docs');
    check('BYPASS: pasta obrigatória vazia → 1', porta(join(raizTmp, 'pasta-vazia')).status === 1);

    // BYPASS: arquivo vazio (0 bytes) → 1
    escrever(raizTmp, 'arquivo-vazio/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['NOTES.md'] }));
    escrever(raizTmp, 'arquivo-vazio/NOTES.md', '');
    check('BYPASS: arquivo vazio → 1', porta(join(raizTmp, 'arquivo-vazio')).status === 1);

    // BYPASS: arquivo só espaço em branco → 1
    escrever(raizTmp, 'so-espaco/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['NOTES.md'] }));
    escrever(raizTmp, 'so-espaco/NOTES.md', '   \n\t \n');
    check('BYPASS: arquivo só espaço em branco → 1', porta(join(raizTmp, 'so-espaco')).status === 1);

    // BYPASS: módulo sem CONTRACT.md → 1
    escrever(raizTmp, 'modulo-sem-doc/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [], porModulo: ['CONTRACT.md'] }));
    escrever(raizTmp, 'modulo-sem-doc/.arch-layers.json', JSON.stringify({ modulos: { raiz: 'src/modules' } }));
    criarPasta(raizTmp, 'modulo-sem-doc/src/modules/faturamento'); // módulo existe, sem CONTRACT.md
    check('BYPASS: módulo sem CONTRACT.md → 1', porta(join(raizTmp, 'modulo-sem-doc')).status === 1);

    // NUNCA BLOQUEIA: porModulo declarado mas sem .arch-layers.json → só "raiz" vale → 0
    escrever(raizTmp, 'sem-arch/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['README.md'], porModulo: ['CONTRACT.md'] }));
    escrever(raizTmp, 'sem-arch/README.md', 'conteúdo\n');
    check('NUNCA BLOQUEIA: sem .arch-layers/modulos → só "raiz" vale', porta(join(raizTmp, 'sem-arch')).status === 0);

    // NUNCA BLOQUEIA: .arch-layers.json existe mas sem modulos.raiz → também só "raiz" vale → 0
    escrever(raizTmp, 'sem-modulos-raiz/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['README.md'], porModulo: ['CONTRACT.md'] }));
    escrever(raizTmp, 'sem-modulos-raiz/README.md', 'conteúdo\n');
    escrever(raizTmp, 'sem-modulos-raiz/.arch-layers.json', JSON.stringify({ camadas: {} }));
    check('NUNCA BLOQUEIA: .arch-layers.json sem modulos.raiz → também só "raiz" vale → 0', porta(join(raizTmp, 'sem-modulos-raiz')).status === 0);

    // BYPASS (config inválida): JSON malformado → NÃO MEDIU (exit 2)
    escrever(raizTmp, 'json-invalido/governance/DOCS_OBRIGATORIOS.json', '{ isto nao é json valido');
    check('BYPASS: DOCS_OBRIGATORIOS.json com JSON malformado → NÃO MEDIU (exit 2)', porta(join(raizTmp, 'json-invalido')).status === 2);

    // BYPASS (VAZIO por tipo errado): config não é objeto (array/string) → NÃO MEDIU (exit 2), nunca 0
    escrever(raizTmp, 'config-array/governance/DOCS_OBRIGATORIOS.json', '[]');
    check(
      'BYPASS (VAZIO): config que é array (não-objeto) → NÃO MEDIU (exit 2), nunca aprovação silenciosa',
      porta(join(raizTmp, 'config-array')).status === 2,
    );

    // BYPASS (NULO): entrada nula dentro de "raiz" → NÃO MEDIU (exit 2)
    escrever(raizTmp, 'entrada-nula/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [null, 'README.md'] }));
    escrever(raizTmp, 'entrada-nula/README.md', 'conteúdo\n');
    check(
      'BYPASS (NULO): entrada nula em "raiz" → config inválida → NÃO MEDIU (exit 2), nunca aprovação silenciosa',
      porta(join(raizTmp, 'entrada-nula')).status === 2,
    );

    // BYPASS (SUBSTITUIR): pasta no lugar do arquivo exigido → doc-tipo-errado → 1
    escrever(raizTmp, 'substituir-arquivo/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['ARQUIVO.md'] }));
    criarPasta(raizTmp, 'substituir-arquivo/ARQUIVO.md'); // é uma PASTA, não um arquivo
    escrever(raizTmp, 'substituir-arquivo/ARQUIVO.md/nada.txt', 'x\n');
    check(
      'BYPASS (SUBSTITUIR): pasta no lugar do arquivo exigido → ainda reprova (doc-tipo-errado) → 1',
      porta(join(raizTmp, 'substituir-arquivo')).status === 1,
    );

    // BYPASS (SUBSTITUIR): arquivo no lugar da pasta exigida → doc-tipo-errado → 1
    escrever(raizTmp, 'substituir-pasta/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['PASTA/'] }));
    escrever(raizTmp, 'substituir-pasta/PASTA', 'sou um arquivo, não uma pasta\n');
    check(
      'BYPASS (SUBSTITUIR): arquivo no lugar da pasta exigida → ainda reprova (doc-tipo-errado) → 1',
      porta(join(raizTmp, 'substituir-pasta')).status === 1,
    );

    // BYPASS (INVISÍVEL): caminho exigido com U+200B não casa com o arquivo real → doc-ausente → 1
    escrever(raizTmp, 'invisivel/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['REA\u200BDME.md'] }));
    escrever(raizTmp, 'invisivel/README.md', 'conteúdo real, mas com nome DIFERENTE do exigido\n');
    check(
      'BYPASS (INVISÍVEL): caractere invisível no caminho exigido → não casa com o arquivo real → doc-ausente → 1',
      porta(join(raizTmp, 'invisivel')).status === 1,
    );

    // PORTA: --dir sem caminho / --dir inexistente
    check(
      'PORTA: --dir sem caminho → exit 2',
      spawnSync(process.execPath, [GUARD_PATH, '--dir'], { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } }).status === 2,
    );
    check('PORTA: --dir inexistente → escanear rejeita → rodapé → exit 2', porta(join(raizTmp, 'nao-existe-de-verdade')).status === 2);

    // ── DR-01: projeto da esteira (esteira.json) SEM o config obrigatório → reprova, nunca NÃO SE APLICA ──
    escrever(raizTmp, 'dr01-esteira-sem-config/esteira.json', JSON.stringify({ repo: 'x', branch: 'main' }));
    check(
      'DR-01: projeto da esteira (esteira.json) sem governance/DOCS_OBRIGATORIOS.json → reprova (1), nunca NÃO SE APLICA',
      porta(join(raizTmp, 'dr01-esteira-sem-config')).status === 1,
    );

    // ── DR-02: config presente mas não mede NADA (chave desconhecida, ou tudo vazio) → NÃO MEDIU (2) ──
    escrever(raizTmp, 'dr02-vazio-total/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({}));
    check('DR-02: config {} (sem raiz nem porModulo) → NÃO MEDIU (2), nunca ✅', porta(join(raizTmp, 'dr02-vazio-total')).status === 2);

    escrever(raizTmp, 'dr02-ambos-vazios/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [], porModulo: [] }));
    check(
      'DR-02: config com "raiz" e "porModulo" explicitamente [] → NÃO MEDIU (2), nunca ✅ (não mede nada)',
      porta(join(raizTmp, 'dr02-ambos-vazios')).status === 2,
    );

    escrever(raizTmp, 'dr02-chave-desconhecida/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ Raiz: ['README.md'] }));
    check(
      'DR-02: chave desconhecida ("Raiz" com maiúscula) → NÃO MEDIU (2), nunca aprovação por acidente de caixa',
      porta(join(raizTmp, 'dr02-chave-desconhecida')).status === 2,
    );

    // ── DR-03: "../" escapa da raiz do projeto; "./" normaliza pra raiz — os dois viram config inválida ──
    escrever(raizTmp, 'dr03-escapa-raiz/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['../README.md'] }));
    check('DR-03: raiz com "../" (escapa da raiz do projeto) → entrada inválida, NÃO MEDIU (2)', porta(join(raizTmp, 'dr03-escapa-raiz')).status === 2);

    escrever(raizTmp, 'dr03-normaliza-raiz/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['./'] }));
    check(
      'DR-03: raiz com "./" (normaliza pra raiz do projeto) → entrada inválida, NÃO MEDIU (2)',
      porta(join(raizTmp, 'dr03-normaliza-raiz')).status === 2,
    );

    // ── DR-04: conteúdo só de caractere invisível/NUL → doc-vazio, nunca "não-vazio" ──
    escrever(raizTmp, 'dr04-invisivel/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['README.md'] }));
    escrever(raizTmp, 'dr04-invisivel/README.md', '\u200B\u2060\uFEFF\n');
    check(
      'BYPASS (DR-04): conteúdo só com caracteres invisíveis (U+200B/U+2060/BOM) → doc-vazio (1)',
      porta(join(raizTmp, 'dr04-invisivel')).status === 1,
    );

    escrever(raizTmp, 'dr04-nul/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['README.md'] }));
    escrever(raizTmp, 'dr04-nul/README.md', Buffer.from([0, 0, 0, 0]));
    check('BYPASS (DR-04): conteúdo só com bytes NUL → doc-vazio (1)', porta(join(raizTmp, 'dr04-nul')).status === 1);

    // ── DR-05: pasta obrigatória com o conteúdo real numa SUBPASTA → satisfeita; só .gitkeep → ainda vazia ──
    escrever(raizTmp, 'dr05-subpasta/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['governance/adr/'] }));
    escrever(raizTmp, 'dr05-subpasta/governance/adr/aceitos/0001-decisao.md', '# ADR 1\nconteúdo real\n');
    escrever(raizTmp, 'dr05-subpasta/governance/adr/aceitos/0002-outra.md', '# ADR 2\nconteúdo real\n');
    check(
      'DR-05: pasta obrigatória com docs em SUBPASTA (adr/aceitos/) → satisfeita, não "vazia" (0)',
      porta(join(raizTmp, 'dr05-subpasta')).status === 0,
    );

    escrever(raizTmp, 'dr05-so-gitkeep/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['docs/'] }));
    escrever(raizTmp, 'dr05-so-gitkeep/docs/.gitkeep', '');
    check('BYPASS (DR-05): pasta obrigatória só com .gitkeep (0 bytes) → ainda doc-vazio (1)', porta(join(raizTmp, 'dr05-so-gitkeep')).status === 1);

    // ── DR-06: fixtures explícitas do conserto (tipo errado em raiz/porModulo; entrada vazia; módulo com só-espaço) ──
    escrever(raizTmp, 'dr06-raiz-string/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: 'README.md' }));
    check('DR-06: "raiz" como STRING (não-array) → NÃO MEDIU (2)', porta(join(raizTmp, 'dr06-raiz-string')).status === 2);

    escrever(raizTmp, 'dr06-raiz-objeto/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: {} }));
    check('DR-06: "raiz" como OBJETO {} (não-array) → NÃO MEDIU (2)', porta(join(raizTmp, 'dr06-raiz-objeto')).status === 2);

    escrever(raizTmp, 'dr06-podmodulo-string/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['README.md'], porModulo: 'CONTRACT.md' }));
    escrever(raizTmp, 'dr06-podmodulo-string/README.md', 'conteúdo\n');
    check('DR-06: "porModulo" como STRING (não-array) → NÃO MEDIU (2)', porta(join(raizTmp, 'dr06-podmodulo-string')).status === 2);

    escrever(raizTmp, 'dr06-entrada-vazia/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [''] }));
    check('DR-06: raiz:[""] (entrada vazia dentro do array) → NÃO MEDIU (2)', porta(join(raizTmp, 'dr06-entrada-vazia')).status === 2);

    escrever(raizTmp, 'dr06-modulo-so-espaco/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [], porModulo: ['CONTRACT.md'] }));
    escrever(raizTmp, 'dr06-modulo-so-espaco/.arch-layers.json', JSON.stringify({ modulos: { raiz: 'src/modules' } }));
    escrever(raizTmp, 'dr06-modulo-so-espaco/src/modules/pagamentos/CONTRACT.md', '   \n\t \n');
    check('DR-06: módulo com CONTRACT.md só espaço em branco → modulo-sem-doc (1), via PORTA', porta(join(raizTmp, 'dr06-modulo-so-espaco')).status === 1);

    // DR-06 (R3): réplica adversarial 2026-09-11 achou 'raiz'/'porModulo' string sem "." (ex. "abc")
    // sobrevivia à remoção de Array.isArray — cada char isolado passa em entradaValida por acaso, e
    // "README.md" (caso acima) só barra por causa do "." — este caso NÃO depende do "." coincidir.
    escrever(raizTmp, 'dr06-r3-raiz-string-sem-ponto/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: 'abc' }));
    check(
      'DR-06 (R3): "raiz" STRING sem "." nem "/" (ex. "abc") → NÃO MEDIU (2), não vira 3 arquivos de 1 letra',
      porta(join(raizTmp, 'dr06-r3-raiz-string-sem-ponto')).status === 2,
    );

    escrever(raizTmp, 'dr06-r3-podmodulo-string-sem-ponto/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [], porModulo: 'xyz' }));
    escrever(raizTmp, 'dr06-r3-podmodulo-string-sem-ponto/.arch-layers.json', JSON.stringify({ modulos: { raiz: 'src/modules' } }));
    criarPasta(raizTmp, 'dr06-r3-podmodulo-string-sem-ponto/src/modules/algum');
    check(
      'DR-06 (R3): "porModulo" STRING sem "." nem "/" (ex. "xyz") → NÃO MEDIU (2), mesmo raciocínio',
      porta(join(raizTmp, 'dr06-r3-podmodulo-string-sem-ponto')).status === 2,
    );

    // DR-06 (R3): réplica achou que tirar o filtro temConteudoReal de medirPasta (contar QUALQUER
    // arquivo, não só o com conteúdo real) sobrevivia — o único caso de pasta-vazia do self-test usava
    // .gitkeep, que já é filtrado ANTES do temConteudoReal (por varrerArvore); este caso usa um arquivo
    // comum (não .gitkeep) só com espaço, que só o temConteudoReal pega.
    escrever(raizTmp, 'dr06-r3-pasta-so-espaco-nao-gitkeep/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['docs/'] }));
    escrever(raizTmp, 'dr06-r3-pasta-so-espaco-nao-gitkeep/docs/nota.txt', '   \n\t\n');
    check(
      'DR-06 (R3): pasta obrigatória com 1 arquivo NÃO-.gitkeep só-espaço → doc-vazio (1), não conta como presente',
      porta(join(raizTmp, 'dr06-r3-pasta-so-espaco-nao-gitkeep')).status === 1,
    );

    // ── DR-07: módulo alcançável só por JUNCTION (sem CONTRACT.md no alvo) → cobrado, não invisível ──
    const dr07Alvo = join(raizTmp, 'dr07-alvo-sem-contrato');
    mkdirSync(dr07Alvo, { recursive: true }); // pasta REAL fora da árvore do módulo, sem CONTRACT.md
    escrever(raizTmp, 'dr07-junction/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [], porModulo: ['CONTRACT.md'] }));
    escrever(raizTmp, 'dr07-junction/.arch-layers.json', JSON.stringify({ modulos: { raiz: 'src/modules' } }));
    mkdirSync(join(raizTmp, 'dr07-junction/src/modules'), { recursive: true });
    try {
      symlinkSync(dr07Alvo, join(raizTmp, 'dr07-junction/src/modules/pagamentos'), 'junction');
      check(
        'DR-07: módulo alcançável só por JUNCTION (sem CONTRACT.md) → cobrado, modulo-sem-doc (1)',
        porta(join(raizTmp, 'dr07-junction')).status === 1,
      );
    } catch (e) {
      check(`DR-07: módulo por junction cobrado (pulado — symlinkSync indisponível neste ambiente: ${e?.code || e})`, true);
    }

    // ── DR-08: ENOTDIR ao tentar listar modulos.raiz → NÃO MEDIU; ENOENT (pasta ainda não existe) → 0 módulos ──
    escrever(raizTmp, 'dr08-enotdir/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [], porModulo: ['CONTRACT.md'] }));
    escrever(raizTmp, 'dr08-enotdir/.arch-layers.json', JSON.stringify({ modulos: { raiz: 'src/modules' } }));
    escrever(raizTmp, 'dr08-enotdir/src/modules', 'sou um ARQUIVO, nao uma pasta de modulos\n'); // ENOTDIR ao ler
    check(
      'DR-08: modulos.raiz aponta pra um ARQUIVO (ENOTDIR) → NÃO MEDIU (2), nunca "0 módulos" silencioso',
      porta(join(raizTmp, 'dr08-enotdir')).status === 2,
    );

    escrever(raizTmp, 'dr08-enoent/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [], porModulo: ['CONTRACT.md'] }));
    escrever(raizTmp, 'dr08-enoent/.arch-layers.json', JSON.stringify({ modulos: { raiz: 'src/modules' } })); // pasta NÃO existe ainda
    check(
      'NUNCA BLOQUEIA (DR-08): modulos.raiz declarado mas a pasta não existe ainda (ENOENT, projeto novo) → 0 módulos, exit 0',
      porta(join(raizTmp, 'dr08-enoent')).status === 0,
    );

    // ── DR-09: pasta que o .arch-layers.json manda ignorar (ex. __tests__) não vira "módulo sem doc" ──
    escrever(raizTmp, 'dr09-ignorado/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: [], porModulo: ['CONTRACT.md'] }));
    escrever(raizTmp, 'dr09-ignorado/.arch-layers.json', JSON.stringify({ modulos: { raiz: 'src/modules' }, ignorar: ['**/__tests__/**'] }));
    escrever(raizTmp, 'dr09-ignorado/src/modules/pagamentos/CONTRACT.md', '# contrato\n');
    escrever(raizTmp, 'dr09-ignorado/src/modules/__tests__/pagamentos.test.mjs', 'x\n');
    check(
      'NUNCA BLOQUEIA (DR-09): pasta que o .arch-layers.json manda ignorar (**/__tests__/**) não vira "módulo sem doc" (0)',
      porta(join(raizTmp, 'dr09-ignorado')).status === 0,
    );

    // ── DR-10: barra invertida no config → config inválida (2), nunca a mensagem enganosa "não existe" ──
    escrever(raizTmp, 'dr10-backslash/governance/DOCS_OBRIGATORIOS.json', JSON.stringify({ raiz: ['governance/adr', 'governance\\adr\\'] }));
    check(
      'DR-10: entrada com barra invertida ("\\\\") → entrada inválida, NÃO MEDIU (2), nunca "não existe" enganoso',
      porta(join(raizTmp, 'dr10-backslash')).status === 2,
    );
  } finally {
    rmSync(raizTmp, { recursive: true, force: true });
  }

  return relatarSelfTest(NOME, casos);
}
