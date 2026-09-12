#!/usr/bin/env node
/**
 * SUÍTE DE SELF-TEST do guard import-boundaries — movida para cá porque o guard passou de 600 linhas
 * visuais (PASSO 3(b) da reestruturação, decisão do coordenador). O guard continua sendo a PORTA:
 * `node scripts/guards/import-boundaries.mjs --self-test` importa este módulo dinamicamente e chama
 * `selfTest()`, com a mesma saída e o mesmo exit code de antes. As funções puras (julgarArquivo,
 * arquivoForaDeCamada, validarFormaConfig, NOME) vêm do guard por caminho relativo ('../import-boundaries.mjs').
 * O caminho do guard para os casos de PORTA-como-processo é calculado a partir do PRÓPRIO import.meta.url
 * deste companheiro (não hardcoded) — assim, quando a prova-de-vida copia a árvore scripts/ inteira pra um
 * tmp e muta só o guard, este companheiro (também copiado) aponta pro guard MUTADO da cópia, não pro
 * original — a contra-prova do companheiro.
 */
import {
  mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../../lib/guard-doctrine.mjs';
import { NOME, julgarArquivo, arquivoForaDeCamada, validarFormaConfig } from '../import-boundaries.mjs';

// ── fixtures: cfg de teste (mini "Clean Architecture" + cápsulas, mesma forma do templates/.arch-layers.json) ──
const cfgTeste = {
  camadas: {
    domain: { globs: ['src/**/domain/**'], podeImportar: [], puro: true },
    application: { globs: ['src/**/application/**'], podeImportar: ['domain'] },
    infra: { globs: ['src/**/infra/**'], podeImportar: ['domain', 'application'] },
    interfaces: { globs: ['src/**/interfaces/**'], podeImportar: ['application', 'domain'] },
    main: { globs: ['src/main.*'], podeImportar: ['*'] },
  },
  modulos: { raiz: 'src/modules', barrel: ['index.mjs'] },
};
const mapaResolve = {
  './outro.mjs': 'src/modules/venda/domain/outro.mjs',
  '../infra/banco.mjs': 'src/modules/venda/infra/banco.mjs',
  '../domain/preco.mjs': 'src/modules/venda/domain/preco.mjs',
  '../application/servico.mjs': 'src/modules/venda/application/servico.mjs',
  '../../estoque/index.mjs': 'src/modules/estoque/index.mjs',
  '../../estoque/application/regra.mjs': 'src/modules/estoque/application/regra.mjs',
  '../../estoque/application/index.mjs': 'src/modules/estoque/application/index.mjs', // IB-2: index de SUBPASTA ≠ barrel
  '../../modules/venda/application/servico.mjs': 'src/modules/venda/application/servico.mjs', // IB-6: de fora de src/modules
  '../estoque/application/regra.mjs': 'src/modules/estoque/application/regra.mjs', // IB-6/IB-7: main e órfão-de-camada
  './nao-existe.mjs': null,
};
const resolverFake = (esp) => (Object.prototype.hasOwnProperty.call(mapaResolve, esp) ? mapaResolve[esp] : null);
const linhaImport = (esp) => `import '${esp}';`;
// atalho pro caso comum julgarArquivo({ caminho, fonte, cfg: cfgTeste, resolver: resolverFake }) — usado por
// quase todo caso de BYPASS abaixo; não muda nenhuma asserção, só encurta a linha (PASSO 3(a)).
const jul = (caminho, fonte) => julgarArquivo({ caminho, fonte, cfg: cfgTeste, resolver: resolverFake });

// IB-3 (issue #27, causa 2) depende de o FILESYSTEM ignorar caixa (NTFS/APFS) — em ext4 (Linux) a
// mesma montagem nunca resolve, e o caso reprovava sempre lá. Sondar `process.platform` mentiria num
// NTFS montado em Linux ou num APFS case-sensitive; sondar o fs de VERDADE (grava minúsculo, lê
// maiúsculo) é a fonte certa. A sonda sempre CONTA um `check()` — nas duas respostas — pra não
// reduzir silenciosamente o N/N total quando o caso não roda de verdade (o auditor da coordenação
// pediu essa trava: sonda errada vira contagem visivelmente errada, não caso desaparecido).
function fsIgnoraCaixaEm(dir) {
  const minuscula = `sonda-caixa-${process.pid}.txt`;
  writeFileSync(join(dir, minuscula), 'x');
  return existsSync(join(dir, minuscula.toUpperCase()));
}

function montarProjeto(dir, cfg, arquivos) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.arch-layers.json'), JSON.stringify(cfg, null, 2));
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    const alvo = join(dir, rel);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
}

export function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── o que NUNCA pode passar (função pura julgarArquivo) ──
  check('BYPASS: camada-proibida (interfaces importa infra, fora do podeImportar) → achado', (() => {
    const r = jul('src/modules/venda/interfaces/rota.mjs', linhaImport('../infra/banco.mjs'));
    return r.length === 1 && r[0].tipo === 'camada-proibida';
  })());
  check('BYPASS: domain (puro) importa infra → domain-impuro E camada-proibida juntos (a mina)', (() => {
    const r = jul('src/modules/venda/domain/preco.mjs', linhaImport('../infra/banco.mjs'));
    const tipos = r.map((x) => x.tipo).sort();
    return tipos.length === 2 && tipos[0] === 'camada-proibida' && tipos[1] === 'domain-impuro';
  })());
  check('BYPASS: domain (puro) importa pacote externo (node:fs) → domain-impuro', (() => {
    const r = jul('src/modules/venda/domain/preco.mjs', `import 'node:fs';`);
    return r.length === 1 && r[0].tipo === 'domain-impuro' && r[0].externo === true;
  })());
  check('BYPASS: capsula-violada (application de "venda" importa arquivo interno de "estoque", não-barrel)', (() => {
    const r = jul('src/modules/venda/application/servico.mjs', linhaImport('../../estoque/application/regra.mjs'));
    return r.length === 1 && r[0].tipo === 'capsula-violada';
  })());
  check('BYPASS (IMPORT: reexport): export { x } from "…" também é julgado', (() => {
    const r = jul('src/modules/venda/interfaces/rota.mjs', `export { x } from '../infra/banco.mjs';`);
    return r.length === 1 && r[0].tipo === 'camada-proibida';
  })());
  check('BYPASS (IMPORT: dinâmico): import(...) também é julgado', (() => {
    const r = jul('src/modules/venda/interfaces/rota.mjs', `async function f(){ await import('../infra/banco.mjs'); }`);
    return r.length === 1 && r[0].tipo === 'camada-proibida';
  })());
  check('BYPASS (IMPORT: require): require(...) também é julgado', (() => {
    const r = jul('src/modules/venda/interfaces/rota.mjs', `const x = require('../infra/banco.mjs');`);
    return r.length === 1 && r[0].tipo === 'camada-proibida';
  })());
  check(
    'BYPASS: fora-de-camada (casa exigirCamadaEm mas não cai em nenhuma camada) → true',
    arquivoForaDeCamada('src/orfao.mjs', { ...cfgTeste, exigirCamadaEm: ['src/**/*.mjs'] }) === true,
  );
  check(
    'reporta a linha certa',
    jul('src/modules/venda/interfaces/rota.mjs', `linha1\nlinha2\n${linhaImport('../infra/banco.mjs')}`)[0]?.linha === 3,
  );

  // ── o que NUNCA pode bloquear (função pura julgarArquivo / arquivoForaDeCamada) ──
  check('NUNCA BLOQUEIA: domain importa domain (mesma camada) → 0', jul('src/modules/venda/domain/preco.mjs', linhaImport('./outro.mjs')).length === 0);
  check(
    'NUNCA BLOQUEIA: application importa domain (permitido) → 0',
    jul('src/modules/venda/application/servico.mjs', linhaImport('../domain/preco.mjs')).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: infra importa application (permitido) → 0',
    jul('src/modules/venda/infra/banco.mjs', linhaImport('../application/servico.mjs')).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: interfaces importa application (permitido) → 0',
    jul('src/modules/venda/interfaces/rota.mjs', linhaImport('../application/servico.mjs')).length === 0,
  );
  check('NUNCA BLOQUEIA: main importa qualquer camada (podeImportar: ["*"]) → 0', jul('src/main.mjs', linhaImport('../infra/banco.mjs')).length === 0);
  check(
    'NUNCA BLOQUEIA: módulo importa o BARREL (index.mjs) de outro módulo → 0',
    jul('src/modules/venda/application/servico.mjs', linhaImport('../../estoque/index.mjs')).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: camada NÃO-pura importa pacote externo (left-pad) → 0',
    jul('src/modules/venda/application/servico.mjs', `import 'left-pad';`).length === 0,
  );
  check(
    'NUNCA BLOQUEIA (NULO): import relativo que não resolve (arquivo inexistente) → 0 (não é este guard)',
    jul('src/modules/venda/domain/preco.mjs', linhaImport('./nao-existe.mjs')).length === 0,
  );
  check(
    'NUNCA BLOQUEIA (VAZIO): fonte vazia/undefined → 0',
    jul('src/modules/venda/domain/preco.mjs', '').length === 0
      && jul('src/modules/venda/domain/preco.mjs', undefined).length === 0,
  );
  check(
    'NUNCA BLOQUEIA (STRING/COMENTÁRIO): import citado em comentário/string não conta (despido)',
    jul('src/modules/venda/domain/preco.mjs', `// import '../infra/banco.mjs';\nconst doc = "import '../infra/banco.mjs'";`).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: opt-out "fronteira-de-proposito" na MESMA linha, com motivo, suprime TODAS as violações da linha → 0',
    jul('src/modules/venda/domain/preco.mjs', `import '../infra/banco.mjs'; // fronteira-de-proposito: migração em andamento, ver #123`).length === 0,
  );
  check(
    'NUNCA BLOQUEIA: dentro de uma camada declarada não é fora-de-camada mesmo com exigirCamadaEm',
    arquivoForaDeCamada('src/modules/venda/domain/preco.mjs', { ...cfgTeste, exigirCamadaEm: ['src/**/*.mjs'] }) === false,
  );
  check('NUNCA BLOQUEIA: sem "exigirCamadaEm" na config, a regra 4 nunca dispara', arquivoForaDeCamada('src/orfao.mjs', cfgTeste) === false);
  check(
    'NUNCA BLOQUEIA: arquivo que não casa nenhum glob de exigirCamadaEm não é medido',
    arquivoForaDeCamada('outra-pasta/x.mjs', { ...cfgTeste, exigirCamadaEm: ['src/**/*.mjs'] }) === false,
  );

  // ── IB-2: barrel é só <raiz>/<módulo>/<barrel> (ehBarrelDoModulo), não qualquer index.* em qualquer
  // profundidade ──
  check('IB-2: BYPASS index.mjs de SUBPASTA de outro módulo (3 segmentos — não é o barrel real) → capsula-violada', (() => {
    const r = jul('src/modules/venda/application/servico.mjs', linhaImport('../../estoque/application/index.mjs'));
    return r.length === 1 && r[0].tipo === 'capsula-violada';
  })());

  // ── IB-5: comentário mágico (webpack/vite) antes da aspa, e require com "\" (Windows/CJS), não escapam ──
  check('IB-5: BYPASS comentário mágico antes da aspa do import dinâmico não esconde o especificador', (() => {
    const r = jul('src/modules/venda/interfaces/rota.mjs', `async function f(){ await import(/* webpackChunkName: "banco" */ '../infra/banco.mjs'); }`);
    return r.length === 1 && r[0].tipo === 'camada-proibida';
  })());
  check('IB-5: BYPASS require com barra invertida (Windows, "..\\\\infra\\\\banco.mjs" no ARQUIVO real) é normalizado e tratado como relativo', (() => {
    // fonte simula o ARQUIVO real no disco: o developer escreveu "\\" (JS-válido) pra ter "\" em runtime —
    // por isso este template literal usa 4 barras por separador (2 no source deste teste = 1 barra no
    // ARQUIVO simulado × 2 = as 2 barras que o developer teria escrito).
    const r = jul('src/modules/venda/interfaces/rota.mjs', `const x = require('..\\\\infra\\\\banco.mjs');`);
    return r.length === 1 && r[0].tipo === 'camada-proibida';
  })());

  // ── IB-6: cápsula vale pra TODA origem fora do módulo (não só outro módulo) — exceto camada com ['*'] ──
  check("IB-6: BYPASS arquivo FORA de src/modules (camada sem ['*']) importa interno de um módulo → capsula-violada", (() => {
    const r = jul('src/interfaces/http/rota.mjs', linhaImport('../../modules/venda/application/servico.mjs'));
    return r.length === 1 && r[0].tipo === 'capsula-violada' && r[0].moduloOrigem === null;
  })());
  check(
    "IB-6: NUNCA BLOQUEIA main (podeImportar ['*']) importa arquivo INTERNO de módulo (não-barrel) → 0 (composição)",
    jul('src/main.mjs', linhaImport('../estoque/application/regra.mjs')).length === 0,
  );

  // ── IB-7: mutation-proofing — invariantes que a certidão afirma e nenhum caso travava antes ──
  check(
    'IB-7: BYPASS capsula-violada dispara com origem DENTRO de um módulo mas FORA de qualquer camada nomeada (independe de camadaOrigem)',
    (() => {
      const r = jul('src/modules/venda/README.mjs', linhaImport('../estoque/application/regra.mjs'));
      return r.length === 1 && r[0].tipo === 'capsula-violada';
    })(),
  );
  check('IB-7: BYPASS marcador em OUTRO lugar do arquivo (fora do trecho do próprio import) NÃO suprime', (() => {
    const fonte = `// fronteira-de-proposito: nao vale aqui, é de outro import\nconst x = 1;\n${linhaImport('../infra/banco.mjs')}\n`;
    const r = jul('src/modules/venda/interfaces/rota.mjs', fonte);
    return r.length === 1 && r[0].tipo === 'camada-proibida';
  })());

  // ── IB-8: opt-out multi-linha (com motivo, dentro de comentário) suprime; sem motivo/dentro de string, não ──
  check('IB-8: BYPASS opt-out em import MULTI-LINHA (marcador na linha de abertura, com motivo) suprime', (() => {
    const fonte = `import { // fronteira-de-proposito: migração do adaptador, ver #123\n  salvar,\n} from '../infra/banco.mjs';\n`;
    const r = jul('src/modules/venda/interfaces/rota.mjs', fonte);
    return r.length === 0;
  })());
  check('IB-8: BYPASS opt-out SEM motivo (só o marcador, sem ": <motivo>") NÃO suprime', (() => {
    const fonte = `${linhaImport('../infra/banco.mjs')} // fronteira-de-proposito\n`;
    const r = jul('src/modules/venda/interfaces/rota.mjs', fonte);
    return r.length === 1 && r[0].tipo === 'camada-proibida';
  })());
  check('IB-8: BYPASS opt-out DENTRO DE STRING (não é comentário) NÃO suprime', (() => {
    const fonte = `${linhaImport('../infra/banco.mjs')} const rotulo = 'fronteira-de-proposito';\n`;
    const r = jul('src/modules/venda/interfaces/rota.mjs', fonte);
    return r.length === 1 && r[0].tipo === 'camada-proibida';
  })());

  // ── IB-4: validarFormaConfig (unidade, sem fs) ──
  check('IB-4: BYPASS validarFormaConfig({camada:…}) (typo de "camadas") → inválida', typeof validarFormaConfig({ camada: cfgTeste.camadas }) === 'string');
  check('IB-4: BYPASS validarFormaConfig({}) → inválida', typeof validarFormaConfig({}) === 'string');
  check('IB-4: BYPASS validarFormaConfig([]) → inválida', typeof validarFormaConfig([]) === 'string');
  check('IB-4: BYPASS validarFormaConfig(null) → inválida (config vazia, distinto de "sem arquivo")', typeof validarFormaConfig(null) === 'string');
  check(
    'IB-4: BYPASS validarFormaConfig(glob com "\\\\") → inválida',
    typeof validarFormaConfig({ camadas: { domain: { globs: ['src\\domain\\**'] } } }) === 'string',
  );
  check('IB-4: NUNCA BLOQUEIA validarFormaConfig(cfgTeste real) → válida (null)', validarFormaConfig(cfgTeste) === null);

  // ── PORTA (issue #17): processo real, via --dir em árvores tmp. O caminho do guard é calculado a partir
  // do PRÓPRIO import.meta.url deste companheiro (não hardcoded) — assim, numa cópia da árvore scripts/
  // (prova-de-vida), aponta pro guard MUTADO da cópia, não pro original (contra-prova do companheiro).
  const guardPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'import-boundaries.mjs');
  const rodarProcesso = (args) => spawnSync(
    process.execPath,
    [guardPath, ...args],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '' } },
  );
  const porta = (dir) => rodarProcesso(['--dir', dir]).status;

  const ARQUIVOS_LIMPOS = {
    'src/modules/venda/domain/preco.mjs': `export function calcularPreco(pedido) { return pedido.valor; }\n`,
    'src/modules/venda/domain/outro.mjs': `export const IMPOSTO = 0.1;\n`,
    'src/modules/venda/application/servico.mjs':
      `import { calcularPreco } from '../domain/preco.mjs';\nexport function processar(p) { return calcularPreco(p); }\n`,
    'src/modules/venda/infra/banco.mjs':
      `import { processar } from '../application/servico.mjs';\nexport function salvar(p) { return processar(p); }\n`,
    'src/modules/venda/interfaces/rota.mjs':
      `import { processar } from '../application/servico.mjs';\nexport function rota(p) { return processar(p); }\n`,
    'src/main.mjs': `import './modules/venda/infra/banco.mjs';\n`,
  };
  // IB-4: mesmos arquivos VIOLADORES do prova do auditor (domain importa infra + node:fs) sob configs quebradas.
  const ARQUIVOS_COM_VIOLACAO = {
    ...ARQUIVOS_LIMPOS,
    'src/modules/venda/domain/preco.mjs':
      `import 'node:fs';\nimport { salvar } from '../infra/banco.mjs';\nexport function calcularPreco(pedido) { return salvar(pedido); }\n`,
  };

  const semConfig = mkdtempSync(join(tmpdir(), 'ib-semconfig-'));
  const jsonRuim = mkdtempSync(join(tmpdir(), 'ib-jsonruim-'));
  const limpo = mkdtempSync(join(tmpdir(), 'ib-limpo-'));
  const sujo = mkdtempSync(join(tmpdir(), 'ib-sujo-'));
  const semIgnorar = mkdtempSync(join(tmpdir(), 'ib-semignorar-'));
  const comIgnorar = mkdtempSync(join(tmpdir(), 'ib-comignorar-'));
  const comExigir = mkdtempSync(join(tmpdir(), 'ib-comexigir-'));
  const semExigir = mkdtempSync(join(tmpdir(), 'ib-semexigir-'));
  const tsNodeNext = mkdtempSync(join(tmpdir(), 'ib-tsnodenext-'));
  const caixaTrocada = mkdtempSync(join(tmpdir(), 'ib-caixa-'));
  const comJuncao = mkdtempSync(join(tmpdir(), 'ib-juncao-'));
  const naoResolvidosDir = mkdtempSync(join(tmpdir(), 'ib-naoresolvidos-'));
  const cfgTypo = mkdtempSync(join(tmpdir(), 'ib-cfgtypo-'));
  const cfgVazio = mkdtempSync(join(tmpdir(), 'ib-cfgvazio-'));
  const cfgArray = mkdtempSync(join(tmpdir(), 'ib-cfgarray-'));
  const cfgBarra = mkdtempSync(join(tmpdir(), 'ib-cfgbarra-'));
  const cfgNulo = mkdtempSync(join(tmpdir(), 'ib-cfgnulo-'));
  try {
    writeFileSync(join(semConfig, 'x.mjs'), `export const x = 1;\n`);
    check('PORTA: sem .arch-layers.json → NAO_APLICAVEL, exit 0', porta(semConfig) === 0);

    mkdirSync(jsonRuim, { recursive: true });
    writeFileSync(join(jsonRuim, '.arch-layers.json'), '{ isto nao é json valido ');
    check('PORTA: .arch-layers.json inválido (JSON quebrado) → NÃO MEDIU, exit 2', porta(jsonRuim) === 2);
    check('PORTA: --dir sem caminho → exit 2', rodarProcesso(['--dir']).status === 2);
    check('PORTA: --dir inexistente → exit 2', porta(join(jsonRuim, 'nao-existe')) === 2);

    montarProjeto(limpo, cfgTeste, ARQUIVOS_LIMPOS);
    check('PORTA: projeto sem violação de camada → exit 0', porta(limpo) === 0);

    montarProjeto(sujo, cfgTeste, {
      ...ARQUIVOS_LIMPOS,
      'src/modules/venda/interfaces/rota.mjs': `import '../infra/banco.mjs';\nexport function rota(){}\n`,
    });
    check('PORTA: interfaces importa infra direto (fora do podeImportar) → exit 1', porta(sujo) === 1);

    const cfgIgnorarBase = { camadas: { domain: { globs: ['**/domain/**'], podeImportar: [], puro: true } } };
    const arquivosIgnorar = { 'tests/domain/ruim.mjs': `import 'node:fs';\n` };
    montarProjeto(semIgnorar, cfgIgnorarBase, arquivosIgnorar);
    check('PORTA: sem "ignorar" no config, tests/domain/ruim.mjs é medido (domain-impuro) → exit 1', porta(semIgnorar) === 1);
    montarProjeto(comIgnorar, { ...cfgIgnorarBase, ignorar: ['tests/**'] }, arquivosIgnorar);
    check('PORTA: com "ignorar": ["tests/**"], o MESMO arquivo deixa de ser medido → exit 0', porta(comIgnorar) === 0);

    montarProjeto(
      comExigir,
      { camadas: { domain: { globs: ['src/**/domain/**'], podeImportar: [] } }, exigirCamadaEm: ['src/**/*.mjs'] },
      { 'src/orfao.mjs': `export const x = 1;\n` },
    );
    check('PORTA: exigirCamadaEm configurado + arquivo fora de qualquer camada → exit 1 (fora-de-camada)', porta(comExigir) === 1);
    montarProjeto(
      semExigir,
      { camadas: { domain: { globs: ['src/**/domain/**'], podeImportar: [] } } },
      { 'src/orfao.mjs': `export const x = 1;\n` },
    );
    check('PORTA: sem exigirCamadaEm, o MESMO arquivo fora de camada não é medido → exit 0', porta(semExigir) === 0);

    // IB-1: NodeNext real — o especificador aponta pro ".js" compilado, o arquivo REAL no disco é ".ts".
    montarProjeto(tsNodeNext, cfgTeste, {
      'src/modules/venda/infra/banco.ts': `export function salvar(p) { return p; }\n`,
      'src/modules/venda/interfaces/rota.ts': `import { salvar } from '../infra/banco.js';\nexport function rota(p) { return salvar(p); }\n`,
    });
    check(
      'IB-1: BYPASS import NodeNext (".js" no especificador, arquivo real é ".ts") resolve e é julgado — camada-proibida, não ✅ mudo',
      porta(tsNodeNext) === 1,
    );

    // IB-1: import relativo que não resolve é CONTADO e IMPRESSO, nunca descartado calado.
    montarProjeto(naoResolvidosDir, cfgTeste, {
      'src/modules/venda/interfaces/rota.mjs': `import './fantasma.mjs';\nexport function rota(){}\n`,
    });
    const rNaoResolvidos = rodarProcesso(['--dir', naoResolvidosDir]);
    check(
      'IB-1: import relativo que NÃO resolve nunca é descartado calado — contagem aparece na saída (exit 0, sem violação)',
      rNaoResolvidos.status === 0
        && /1 import\(s\) relativo\(s\) não resolvido\(s\)/.test(`${rNaoResolvidos.stdout}${rNaoResolvidos.stderr}`),
    );

    // IB-3: caixa trocada (Windows/NTFS) resolve ao arquivo real — só existe onde o fs ignora caixa.
    montarProjeto(caixaTrocada, cfgTeste, {
      'src/modules/venda/infra/banco.mjs': `export function salvar() { return 1; }\n`,
      'src/modules/venda/interfaces/rota.mjs': `import { salvar } from '../Infra/banco.mjs';\nexport function rota() { return salvar(); }\n`,
    });
    const fsIgnoraCaixa = fsIgnoraCaixaEm(caixaTrocada);
    check(
      fsIgnoraCaixa
        ? 'IB-3: BYPASS import com CAIXA trocada no caminho (Windows/NTFS) resolve ao arquivo real → camada-proibida'
        : 'IB-3: ⚠ pulado — fs case-sensitive (ext4/Linux): bypass de caixa trocada não existe aqui',
      fsIgnoraCaixa ? porta(caixaTrocada) === 1 : true,
    );

    // IB-3: junction (atalho de diretório) não esconde a camada real — segue o alvo verdadeiro.
    montarProjeto(comJuncao, cfgTeste, {
      'src/modules/venda/infra/banco.mjs': `export function salvar() { return 1; }\n`,
      'src/modules/venda/interfaces/rota.mjs': `import { salvar } from './atalho/banco.mjs';\nexport function rota() { return salvar(); }\n`,
    });
    symlinkSync(join(comJuncao, 'src/modules/venda/infra'), join(comJuncao, 'src/modules/venda/interfaces/atalho'), 'junction');
    check('IB-3: BYPASS junction (atalho de diretório pra infra) não esconde a camada real → camada-proibida', porta(comJuncao) === 1);

    // IB-4: config sem forma válida, com uma violação REAL no projeto (a mesma do prova do auditor) → NÃO
    // MEDIU, nunca ✅.
    montarProjeto(cfgTypo, { camada: cfgTeste.camadas, modulos: cfgTeste.modulos }, ARQUIVOS_COM_VIOLACAO);
    check(
      'IB-4: BYPASS chave "camada" (typo de "camadas"), violação real no projeto → NÃO MEDIU, exit 2 (nunca ✅)',
      porta(cfgTypo) === 2,
    );
    montarProjeto(cfgVazio, {}, ARQUIVOS_COM_VIOLACAO);
    check('IB-4: BYPASS config "{}", violação real no projeto → NÃO MEDIU, exit 2', porta(cfgVazio) === 2);
    montarProjeto(cfgArray, [], ARQUIVOS_COM_VIOLACAO);
    check('IB-4: BYPASS config "[]" (array), violação real no projeto → NÃO MEDIU, exit 2', porta(cfgArray) === 2);
    montarProjeto(cfgBarra, { camadas: { domain: { globs: ['src\\domain\\**'], podeImportar: [] } } }, ARQUIVOS_COM_VIOLACAO);
    check(
      'IB-4: BYPASS glob com "\\" (nunca casa caminho real, que usa "/"), violação real → NÃO MEDIU, exit 2',
      porta(cfgBarra) === 2,
    );
    montarProjeto(cfgNulo, null, ARQUIVOS_COM_VIOLACAO);
    check(
      'IB-4: BYPASS .arch-layers.json com conteúdo JSON "null" → NÃO MEDIU, exit 2 (distinto de "sem arquivo")',
      porta(cfgNulo) === 2,
    );
  } finally {
    for (const d of [
      semConfig, jsonRuim, limpo, sujo, semIgnorar, comIgnorar, comExigir, semExigir,
      tsNodeNext, caixaTrocada, comJuncao, naoResolvidosDir, cfgTypo, cfgVazio, cfgArray, cfgBarra, cfgNulo,
    ]) rmSync(d, { recursive: true, force: true });
  }

  // ── STACK (R6, 2026-09-11): "stack":"python" em esteira.json isenta este guard (só lê JS/TS) ──
  const stackPy = mkdtempSync(join(tmpdir(), 'ib-stack-py-'));
  const stackNode = mkdtempSync(join(tmpdir(), 'ib-stack-node-'));
  const stackRuim = mkdtempSync(join(tmpdir(), 'ib-stack-ruim-'));
  try {
    montarProjeto(stackPy, cfgTeste, ARQUIVOS_COM_VIOLACAO); // violação de camada de verdade — mas o projeto é python
    writeFileSync(join(stackPy, 'esteira.json'), JSON.stringify({ stack: 'python' }));
    check('STACK: projeto python (esteira.json) → NAO_APLICAVEL exit 0, mesmo com violação de camada no disco', porta(stackPy) === 0);
    montarProjeto(stackNode, cfgTeste, ARQUIVOS_COM_VIOLACAO);
    writeFileSync(join(stackNode, 'esteira.json'), JSON.stringify({ stack: 'node' }));
    check('STACK: projeto node (explícito) → regra normal (reprova a violação)', porta(stackNode) === 1);
    mkdirSync(stackRuim, { recursive: true });
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
