/**
 * ─── COMPANION de self-test de ../adr-sequence.mjs ────────────────────────────
 * POR QUE EM ARQUIVO SEPARADO: regra do coordenador — nenhum arquivo do kit passa de 600 LINHAS
 *   VISUAIS (`file-loc-ceiling`); `../adr-sequence.mjs` passou do teto ao ganhar a RN-C5 (ADR-0004:
 *   adr-sequence cede buraco/duplicata ao reserva-de-numero quando o tipo está ligado). `../adr-
 *   sequence.mjs` continua sendo A PORTA: `--self-test` importa ESTE arquivo dinamicamente (sem `await`
 *   no topo — evita "unsettled top-level await", já que este companion importa `julgarSequencia`/
 *   `listarAdrs`/`fmt` DE VOLTA do guard). O caminho do alvo é calculado a partir do PRÓPRIO
 *   `import.meta.url` (nunca de `process.argv`), pra continuar correto quando a prova-de-vida copia
 *   `scripts/` inteira pra um tmp e muta só a cópia do guard.
 *
 * CONTRA-PROVA: node scripts/guards/adr-sequence.mjs --self-test
 * ───────────────────────────────────────────────────────────────────────────
 */
import {
  readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../../lib/guard-doctrine.mjs';
import { julgarSequencia, listarAdrs, fmt } from '../adr-sequence.mjs';

const NOME = 'adr-sequence';

// ── fixtures do self-test ──────────────────────────────────────────────────
const status = (v = 'aceita') => `- **Status:** ${v}\n- **Data:** 2026-09-11\n`;
const adr = (n, corpo = status()) => ({ nome: `${fmt(n)}-caso.md`, conteudo: `# ADR-${fmt(n)}\n\n${corpo}\n## Contexto\nx\n` });
const comStatusVariante = (linha, n = 1) => ({ nome: `${fmt(n)}-caso.md`, conteudo: `# ADR-${fmt(n)}\n\n${linha}\n## Contexto\nx\n` });

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const meu = fileURLToPath(new URL('../adr-sequence.mjs', import.meta.url));

  // ── julgarSequencia: função pura ──
  check('NUNCA BLOQUEIA (VAZIO): array vazio/undefined/null → 0 achados',
    julgarSequencia([]).length === 0 && julgarSequencia(undefined).length === 0 && julgarSequencia(null).length === 0);
  check('NUNCA BLOQUEIA: README.md solto (sem prefixo numérico) → 0 achados', julgarSequencia([{ nome: 'README.md', conteudo: 'notas' }]).length === 0);
  check('ADR-01: prefixo com menos de 3 dígitos não é ADR — agora vira nome-fora-do-padrao (antes: 0 achados, falso-negativo)',
    julgarSequencia([{ nome: '01-x.md', conteudo: status() }]).some((a) => a.tipo === 'nome-fora-do-padrao'));
  check('NUNCA BLOQUEIA: 0000..0003 contíguos, todos com Status (0000 isento) → 0 achados',
    julgarSequencia([adr(0, 'molde, sem status'), adr(1), adr(2), adr(3)]).length === 0);
  check('NUNCA BLOQUEIA: 0000-template.md sem Status e com título fora do padrão → 0 (número 0 é isento de Status E de título)',
    julgarSequencia([{ nome: '0000-template.md', conteudo: '# ADR-9999 (molde)\nsem status aqui' }]).length === 0);
  check('NUNCA BLOQUEIA: 0001-a.md e 0010-b.md (números distintos, largura diferente) não é duplicata',
    !julgarSequencia([adr(1), adr(10)]).some((a) => a.tipo === 'numero-duplicado'));
  check('NUNCA BLOQUEIA: README.md e index.md (caixa livre) soltos continuam isentos',
    julgarSequencia([{ nome: 'index.md', conteudo: 'x' }, { nome: 'Readme.md', conteudo: 'x' }]).length === 0);

  check('BYPASS: 0001+0003 (falta 0002) → buraco', (() => {
    const a = julgarSequencia([adr(1), adr(3)]);
    return a.some((x) => x.tipo === 'buraco' && x.min === 1 && x.max === 3 && x.faltando.length === 1 && x.faltando[0] === 2);
  })());
  check('BYPASS: 0000+0002 (falta 0001; template conta na sequência) → buraco com falta=1', (() => {
    const a = julgarSequencia([adr(0, 'molde'), adr(2)]);
    return a.some((x) => x.tipo === 'buraco' && x.faltando.includes(1));
  })());
  check('BYPASS: 0001+0005 → buraco lista 2,3,4', (() => {
    const a = julgarSequencia([adr(1), adr(5)]).find((x) => x.tipo === 'buraco');
    return a && a.faltando.join(',') === '2,3,4';
  })());
  check('BYPASS: 0002 duplicado (dois arquivos, mesmo número) → numero-duplicado com os 2 nomes', (() => {
    const a = julgarSequencia([adr(1), { nome: '0002-a.md', conteudo: status() }, { nome: '0002-b.md', conteudo: status() }, adr(3)]);
    const d = a.find((x) => x.tipo === 'numero-duplicado');
    return d && d.numero === 2 && d.arquivos.length === 2;
  })());
  check('BYPASS: duplicata por VALOR (002-a.md e 0002-b.md, larguras diferentes) → numero-duplicado',
    julgarSequencia([{ nome: '002-a.md', conteudo: status() }, { nome: '0002-b.md', conteudo: status() }]).some((a) => a.tipo === 'numero-duplicado'));
  check('BYPASS: ADR (número > 0) sem a linha "- **Status:**" → adr-sem-status',
    julgarSequencia([adr(1, 'esqueceu o status')]).some((a) => a.tipo === 'adr-sem-status' && a.numero === 1));
  check('BYPASS: "status:" solto no meio do texto (sem o formato "- **Status:**") não conta como presente → adr-sem-status',
    julgarSequencia([adr(1, 'O status deste ADR: aceita (mas não no formato certo)')]).some((a) => a.tipo === 'adr-sem-status'));
  check('BYPASS (NULO): conteudo null/undefined em ADR>0 → adr-sem-status (nunca "sem violação")', julgarSequencia([
    { nome: '0001-x.md', conteudo: null },
    { nome: '0002-x.md', conteudo: undefined },
  ]).filter((a) => a.tipo === 'adr-sem-status').length === 2);
  check('BYPASS (CRLF): "- **Status:**" com quebra de linha \\r\\n é reconhecida',
    julgarSequencia([{ nome: '0001-x.md', conteudo: '# t\r\n\r\n- **Status:** aceita\r\n' }]).length === 0);

  // ── ADR-01: nome-fora-do-padrao fecha A1/A2/C1/D1/D2/D3/E2 (banca RENOMEAR/INVISÍVEL/CAIXA) ──
  check('ADR-01: .md solto fora do padrão (nem numerado, nem README/index) → nome-fora-do-padrao',
    julgarSequencia([{ nome: 'arquitetura.md', conteudo: 'x' }]).some((a) => a.tipo === 'nome-fora-do-padrao' && a.arquivo === 'arquitetura.md'));
  check(
    'ADR-01 (A1, RENOMEAR): ADR mais alto renomeado (0003 -> arquitetura.md) não passa mais em silêncio — ' +
      'nome-fora-do-padrao, sequência 0-2 sem buraco à parte',
    (() => {
      const a = julgarSequencia([adr(0, 'molde'), adr(1), adr(2), { nome: 'arquitetura.md', conteudo: status() }]);
      return a.some((x) => x.tipo === 'nome-fora-do-padrao' && x.arquivo === 'arquitetura.md') && !a.some((x) => x.tipo === 'buraco');
    })(),
  );
  check('ADR-01 (A2, RENOMEAR/piso): deletar molde+0001 (sobram 0002,0003) → buraco a partir do piso 1, não mais silencioso', (() => {
    const a = julgarSequencia([{ nome: '0002-a.md', conteudo: status() }, { nome: '0003-b.md', conteudo: status() }]);
    const b = a.find((x) => x.tipo === 'buraco');
    return b && b.min === 1 && b.faltando.join(',') === '1';
  })());
  check('ADR-01 (D1, CAIXA): extensão .MD maiúscula não vira ADR — nome-fora-do-padrao, NÃO numero-duplicado (mataria o mutante RE_ADR com /i)', (() => {
    const a = julgarSequencia([{ nome: '0002-b.md', conteudo: status() }, { nome: '0002-c.MD', conteudo: status() }]);
    return a.some((x) => x.tipo === 'nome-fora-do-padrao' && x.arquivo === '0002-c.MD') && !a.some((x) => x.tipo === 'numero-duplicado');
  })());
  check('ADR-01 (D2): hífen trocado por "_" (0002_c.md) → nome-fora-do-padrao', julgarSequencia([
    { nome: '0002-b.md', conteudo: status() },
    { nome: '0002_c.md', conteudo: status() },
  ]).some((a) => a.tipo === 'nome-fora-do-padrao' && a.arquivo === '0002_c.md'));
  check('ADR-01 (D3): prefixo "ADR-" antes do número (ADR-0002-c.md) → nome-fora-do-padrao', julgarSequencia([
    { nome: '0002-b.md', conteudo: status() },
    { nome: 'ADR-0002-c.md', conteudo: status() },
  ]).some((a) => a.tipo === 'nome-fora-do-padrao' && a.arquivo === 'ADR-0002-c.md'));
  check(
    'ADR-01 (E2, grafia do MODELO): ADR-001-a.md + ADR-003-c.md (buraco real, mas fora do padrão RE_ADR) → ' +
      'ambos nome-fora-do-padrao, não mais exit 0',
    (() => {
      const a = julgarSequencia([{ nome: 'ADR-001-a.md', conteudo: status() }, { nome: 'ADR-003-c.md', conteudo: status() }]);
      return a.length === 2 && a.every((x) => x.tipo === 'nome-fora-do-padrao');
    })(),
  );
  check(
    'ADR-01 (C1, INVISÍVEL): U+200B colado antes do número desmascara — vira numero-duplicado de verdade ' +
      'com o 0002-b.md legítimo',
    julgarSequencia([
      { nome: '0002-b.md', conteudo: status() },
      { nome: '​0002-c.md', conteudo: status() },
    ]).some((a) => a.tipo === 'numero-duplicado' && a.numero === 2),
  );
  check(
    'ADR-01 (INVISÍVEL/BOM): U+FEFF colado no nome também é normalizado antes de julgar',
    julgarSequencia([
      { nome: '0002-b.md', conteudo: status() },
      { nome: '﻿0002-c.md', conteudo: status() },
    ]).some((a) => a.tipo === 'numero-duplicado' && a.numero === 2),
  );

  // ── ADR-02: número sem teto vira nome-fora-do-padrao, nunca trava nem estoura stderr ──
  check(
    'ADR-02 (G1/G2, data YYYYMMDD): prefixo com mais de 6 dígitos não é ADR — nome-fora-do-padrao, sem laço, sem stderr gigante',
    julgarSequencia([{ nome: '20260911-a.md', conteudo: status() }]).every((a) => a.tipo === 'nome-fora-do-padrao'),
  );
  check('ADR-02 (G3/G4, > MAX_SAFE_INTEGER): dois números astronômicos não colidem nem travam — ambos nome-fora-do-padrao, retorno instantâneo', (() => {
    const a = julgarSequencia([
      { nome: '99999999999999999999-a.md', conteudo: status() },
      { nome: '99999999999999999998-b.md', conteudo: status() },
    ]);
    return a.length === 2 && a.every((x) => x.tipo === 'nome-fora-do-padrao') && !a.some((x) => x.tipo === 'numero-duplicado');
  })());

  // ── ADR-03: minefield vazio para este guard é limite DECLARADO (referencia/limpo fora de escopo) ──
  check('ADR-03: limite declarado no cabeçalho (minefield vazio pra este guard) — a prova real é o PORTA abaixo, não referencia/limpo',
    readFileSync(meu, 'utf8').includes('LIMITE DECLARADO (ADR-03)'));

  // ── ADR-04: FORMATO da linha de Status é travado (âncora de início de linha + marcador de lista) ──
  check('ADR-04: "Nota: o campo **Status:** fica pra depois" no MEIO da linha (sem bullet no início) não conta como presente',
    julgarSequencia([comStatusVariante('Nota: o campo **Status:** fica pra depois')]).some((a) => a.tipo === 'adr-sem-status'));

  // ── ADR-05: grafias legítimas de Status (decisão do coordenador: [-*+], dois-pontos livre, caixa livre) ──
  check('ADR-05: bullet "*" antes de **Status:** é aceito', julgarSequencia([comStatusVariante('* **Status:** aceita')]).length === 0);
  check('ADR-05: bullet "+" antes de **Status:** também é aceito', julgarSequencia([comStatusVariante('+ **Status:** aceita')]).length === 0);
  check('ADR-05: dois-pontos FORA do negrito (- **Status**: aceita) é aceito', julgarSequencia([comStatusVariante('- **Status**: aceita')]).length === 0);
  check('ADR-05: "status" minúsculo é aceito (caixa livre)', julgarSequencia([comStatusVariante('- **status:** aceita')]).length === 0);
  check('ADR-05: "STATUS" maiúsculo também é aceito', julgarSequencia([comStatusVariante('- **STATUS:** aceita')]).length === 0);
  check('ADR-05: sem NENHUM bullet (**Status:** solto) continua reprovado — fora da gramática decidida pelo coordenador',
    julgarSequencia([comStatusVariante('**Status:** aceita')]).some((a) => a.tipo === 'adr-sem-status'));
  check('ADR-05: front matter YAML (status: accepted) continua reprovado — fora da gramática decidida',
    julgarSequencia([{ nome: '0001-x.md', conteudo: '---\nstatus: accepted\n---\n# ADR-0001\n' }]).some((a) => a.tipo === 'adr-sem-status'));

  // ── ADR-06: divergência com docs/MODELO-PADRAO-DE-PROJETO.md é limite DECLARADO (correção é da R4) ──
  check('ADR-06: limite declarado no cabeçalho (grafia do MODELO diverge; correção agendada pra R4, fora do escopo deste guard)',
    readFileSync(meu, 'utf8').includes('LIMITE DECLARADO (ADR-06)'));

  // ── ADR-08: título do corpo tem que bater com o nome do arquivo; molde (0000) isento ──
  check('ADR-08 (J1): título "# ADR-0001" colado num arquivo 0002-b.md (rebase/copy-paste) → titulo-diverge-do-nome', (() => {
    const a = julgarSequencia([{ nome: '0002-b.md', conteudo: `# ADR-0001\n\n${status()}` }]);
    return a.some((x) => x.tipo === 'titulo-diverge-do-nome' && x.numeroNome === 2 && x.numeroTitulo === 1);
  })());
  check('ADR-08: título que BATE com o nome não é achado', julgarSequencia([adr(7)]).every((a) => a.tipo !== 'titulo-diverge-do-nome'));

  // ── RN-C5 (ADR-0004): reservaLigada=true cede buraco/duplicata ao reserva-de-numero, função pura ──
  check('RN-C5: buraco (falta 0002) com reservaLigada=true → 0 achados (não julga mais)',
    julgarSequencia([adr(1), adr(3)], { reservaLigada: true }).length === 0);
  check('RN-C5: duplicata (dois 0002) com reservaLigada=true → 0 achados no adr-sequence', julgarSequencia(
    [adr(1), { nome: '0002-a.md', conteudo: status() }, { nome: '0002-b.md', conteudo: status() }],
    { reservaLigada: true },
  ).length === 0);
  check('RN-C5: mesma entrada (buraco) com reservaLigada=false (padrão) continua reprovando — nada some do comportamento de hoje',
    julgarSequencia([adr(1), adr(3)]).some((a) => a.tipo === 'buraco'));
  check('RN-C5: com reservaLigada=true, adr-sem-status e titulo-diverge-do-nome CONTINUAM julgados (segue julgando o resto)', (() => {
    const a = julgarSequencia([adr(1, 'sem status'), { nome: '0002-b.md', conteudo: `# ADR-0001\n\n${status()}` }], { reservaLigada: true });
    return a.some((x) => x.tipo === 'adr-sem-status') && a.some((x) => x.tipo === 'titulo-diverge-do-nome');
  })());
  check('RN-C5: nome-fora-do-padrao continua julgado com reservaLigada=true',
    julgarSequencia([{ nome: 'solto.md', conteudo: 'x' }], { reservaLigada: true }).some((a) => a.tipo === 'nome-fora-do-padrao'));

  // ── PORTA (issue #17): processo real, árvores de PROJETO tmp (raiz com governance/adr dentro) ──
  const porta = (dir) => spawnSync(
    process.execPath,
    [meu, '--dir', dir],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '' } },
  ).status;
  const escrever = (raiz, arqs) => {
    const d = join(raiz, 'governance', 'adr');
    mkdirSync(d, { recursive: true });
    for (const a of arqs) writeFileSync(join(d, a.nome), a.conteudo);
  };
  // RN-C5: escreve governance/RESERVAS.json ligando (ou não) o tipo "adr" a governance/adr.
  const escreverReservas = (raiz, conteudo) => {
    mkdirSync(join(raiz, 'governance'), { recursive: true });
    writeFileSync(join(raiz, 'governance', 'RESERVAS.json'), conteudo);
  };
  const RESERVAS_LIGADA = JSON.stringify({ tipos: { adr: { dir: 'governance/adr', padrao: 'sequencial', largura: 4 } } });

  const okDir = mkdtempSync(join(tmpdir(), 'adrseq-ok-'));
  const buracoDir = mkdtempSync(join(tmpdir(), 'adrseq-buraco-'));
  const dupDir = mkdtempSync(join(tmpdir(), 'adrseq-dup-'));
  const semStatusDir = mkdtempSync(join(tmpdir(), 'adrseq-semstatus-'));
  const semPastaDir = mkdtempSync(join(tmpdir(), 'adrseq-sempasta-'));
  const vaziaDir = mkdtempSync(join(tmpdir(), 'adrseq-vazia-'));
  const readmeDir = mkdtempSync(join(tmpdir(), 'adrseq-readme-'));
  const numGigDir = mkdtempSync(join(tmpdir(), 'adrseq-numgig-'));
  const semSinalComEsteiraDir = mkdtempSync(join(tmpdir(), 'adrseq-semsinal-'));
  const arquivoComoDirDir = mkdtempSync(join(tmpdir(), 'adrseq-arqdir-'));
  const leituraDir = mkdtempSync(join(tmpdir(), 'adrseq-leitura-'));
  const rnc5BuracoLigadoDir = mkdtempSync(join(tmpdir(), 'adrseq-rnc5-buraco-'));
  const rnc5DupLigadoDir = mkdtempSync(join(tmpdir(), 'adrseq-rnc5-dup-'));
  const rnc5ConfigInvalidoDir = mkdtempSync(join(tmpdir(), 'adrseq-rnc5-badcfg-'));
  const rnc5TipoDesligadoDir = mkdtempSync(join(tmpdir(), 'adrseq-rnc5-desligado-'));
  const rnc5SemStatusLigadoDir = mkdtempSync(join(tmpdir(), 'adrseq-rnc5-semstatus-'));
  try {
    escrever(okDir, [adr(0, 'molde'), adr(1), adr(2), adr(3)]);
    check('PORTA: 0000..0003 contíguos com Status → exit 0', porta(okDir) === 0);

    escrever(buracoDir, [adr(1), adr(3)]);
    check('PORTA: falta 0002 (buraco) → exit 1', porta(buracoDir) === 1);

    escrever(dupDir, [adr(1), { nome: '0001-outro.md', conteudo: status() }]);
    check('PORTA: 0001 duplicado → exit 1', porta(dupDir) === 1);

    escrever(semStatusDir, [adr(1, 'sem a linha de status')]);
    check('PORTA: ADR sem Status → exit 1', porta(semStatusDir) === 1);

    mkdirSync(semPastaDir, { recursive: true }); // sem governance/adr, SEM sinal de projeto da esteira
    check('PORTA: sem governance/adr e sem sinal de projeto → NAO_APLICAVEL, exit 0', porta(semPastaDir) === 0);

    mkdirSync(join(vaziaDir, 'governance', 'adr'), { recursive: true }); // pasta existe, vazia
    check('PORTA: governance/adr vazia → exit 0', porta(vaziaDir) === 0);

    escrever(readmeDir, [{ nome: 'README.md', conteudo: 'como usar esta pasta' }]);
    check('PORTA: só README.md solto (sem prefixo) → exit 0', porta(readmeDir) === 0);

    escrever(numGigDir, [{ nome: '12345678901234567890-a.md', conteudo: status() }]);
    const rNumGig = spawnSync(
      process.execPath,
      [meu, '--dir', numGigDir],
      { encoding: 'utf8', timeout: 10_000, env: { ...process.env, npm_lifecycle_event: '' } },
    );
    check(
      'ADR-02: PORTA — prefixo de 20 dígitos não trava (nome-fora-do-padrao, exit 1, sem timeout/sinal)',
      rNumGig.status === 1 && rNumGig.signal == null,
    );

    mkdirSync(semSinalComEsteiraDir, { recursive: true });
    writeFileSync(join(semSinalComEsteiraDir, 'esteira.json'), '{}');
    check(
      'ADR-07: PORTA — governance/adr ausente NUM projeto da esteira (esteira.json presente) → reprova (pasta-adr-ausente), não mais NAO_APLICAVEL',
      porta(semSinalComEsteiraDir) === 1,
    );

    mkdirSync(arquivoComoDirDir, { recursive: true });
    const arquivoFake = join(arquivoComoDirDir, 'nao-e-pasta.txt');
    writeFileSync(arquivoFake, 'x');
    check('ADR-07: PORTA — --dir apontando pra um ARQUIVO (não pasta) → NÃO MEDIU, exit 2', porta(arquivoFake) === 2);

    check(
      'PORTA: --dir sem caminho → exit 2',
      spawnSync(process.execPath, [meu, '--dir'], { encoding: 'utf8', env: { ...process.env, npm_lifecycle_event: '' } }).status === 2,
    );
    check('PORTA: --dir inexistente (projeto todo não existe) → exit 2', porta(join(okDir, 'nao-existe-mesmo')) === 2);

    escrever(leituraDir, [adr(1)]);
    const dirAdrLeitura = join(leituraDir, 'governance', 'adr');
    const propaga = (() => {
      try {
        listarAdrs(dirAdrLeitura, { ler: () => { throw new Error('EACCES simulada'); } });
        return false;
      } catch { return true; }
    })();
    check('ADR-04: leitor injetado que lança propaga — listarAdrs não mascara como conteúdo vazio', propaga);
    check('ADR-08: falha de leitura de arquivo individual é NÃO MEDIU (propaga), não "sem Status" mascarado', propaga);

    // ── RN-C5 PORTA: processo real com governance/RESERVAS.json de verdade (não só a função pura) ──
    escreverReservas(rnc5BuracoLigadoDir, RESERVAS_LIGADA);
    escrever(rnc5BuracoLigadoDir, [adr(1), adr(3)]); // buraco (falta 0002)
    check('RN-C5: buraco com reserva ligada → 0 (exit 0, processo real)', porta(rnc5BuracoLigadoDir) === 0);

    escreverReservas(rnc5DupLigadoDir, RESERVAS_LIGADA);
    escrever(rnc5DupLigadoDir, [adr(1), { nome: '0001-outro.md', conteudo: status() }]); // 0001 duplicado
    check('RN-C5: duplicata com reserva ligada → 0 no adr-sequence (exit 0, processo real)', porta(rnc5DupLigadoDir) === 0);

    check('RN-C5: buraco sem RESERVAS.json → 1 (comportamento de hoje, mesma árvore do caso PORTA acima)', porta(buracoDir) === 1);

    escreverReservas(rnc5ConfigInvalidoDir, '{ isso nao é json válido');
    escrever(rnc5ConfigInvalidoDir, [adr(1), adr(3)]); // buraco
    check(
      'RN-C5: RESERVAS.json malformado (JSON inválido) → segue o comportamento de hoje sem inventar (buraco reprova, exit 1)',
      porta(rnc5ConfigInvalidoDir) === 1,
    );

    escreverReservas(rnc5TipoDesligadoDir, JSON.stringify({ tipos: { adr: { dir: null }, migration: { dir: 'db/migrations' } } }));
    escrever(rnc5TipoDesligadoDir, [adr(1), adr(3)]); // buraco
    check(
      'RN-C5: RESERVAS.json existe mas o tipo "adr" está desligado (dir:null) → não cede, buraco reprova como sempre (exit 1)',
      porta(rnc5TipoDesligadoDir) === 1,
    );

    escreverReservas(rnc5SemStatusLigadoDir, RESERVAS_LIGADA);
    escrever(rnc5SemStatusLigadoDir, [adr(1, 'esqueceu o status')]); // sem buraco/duplicata, mas sem Status
    check(
      'RN-C5: reserva ligada e SEM buraco/duplicata, mas ADR sem Status → segue julgando o resto (exit 1, adr-sem-status)',
      porta(rnc5SemStatusLigadoDir) === 1,
    );
  } finally {
    for (const d of [
      okDir, buracoDir, dupDir, semStatusDir, semPastaDir, vaziaDir,
      readmeDir, numGigDir, semSinalComEsteiraDir, arquivoComoDirDir, leituraDir,
      rnc5BuracoLigadoDir, rnc5DupLigadoDir, rnc5ConfigInvalidoDir, rnc5TipoDesligadoDir, rnc5SemStatusLigadoDir,
    ]) rmSync(d, { recursive: true, force: true });
  }

  // ── ADR-03 (reforço, dogfood real): se o kit estiver disponível, a sequência REAL de governance/adr
  //    deste repo não é falso-positivo — prova que substitui o minefield vazio pra este guard.
  (() => {
    try {
      const raizAdr = join(process.cwd(), 'governance', 'adr');
      if (!existsSync(raizAdr)) return; // ambiente sem o kit à mão: não afirma nada extra (self-test não quebra)
      check('ADR-03: dogfood — sequência real de governance/adr (este kit) não é falso-positivo', julgarSequencia(listarAdrs(raizAdr)).length === 0);
    } catch { /* ignora-de-proposito: cwd sem o kit — não é o alvo deste caso, self-test não quebra por isso */ }
  })();

  process.exitCode = relatarSelfTest(NOME, casos);
}

selfTest();
