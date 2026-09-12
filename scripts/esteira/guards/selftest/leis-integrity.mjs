#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão do companheiro) ──────────────────────────────────────
 * POR QUE EXISTE: a suíte de `scripts/guards/leis-integrity.mjs` (casos, fixtures e helpers só de
 *   teste) passou de 600 linhas visuais junto com o guard — LEI DO FORMATO pede reestruturar sem
 *   mudar lógica. Este arquivo é só isso: os MESMOS 64 casos, fixtures e helpers, movidos para cá.
 *   O guard continua sendo a PORTA: `node scripts/guards/leis-integrity.mjs --self-test` importa este
 *   módulo por caminho relativo (`./selftest/leis-integrity.mjs`) e roda a mesma suíte, com a mesma
 *   saída e o mesmo exit code de antes.
 *
 * O QUE FAZ: importa as FUNÇÕES PURAS do guard por caminho relativo (`../leis-integrity.mjs` — nunca
 *   duplica `NOMES_CANONICOS`/`NOME`/`ARQUIVO_ALVO`, que continuam com dono único no guard, LEI 11) e
 *   exporta `selfTest()`, que roda os casos e DEVOLVE o exit code (não seta `process.exitCode` — quem
 *   decide isso é o guard, que é a PORTA de verdade). Os casos PORTA-como-processo (`spawnSync`) calculam
 *   o caminho do GUARD a partir do PRÓPRIO `import.meta.url` deste arquivo (`../leis-integrity.mjs`
 *   relativo a ele), nunca por caminho fixo — assim, quando a prova-de-vida copia a árvore `scripts/`
 *   inteira pra um tmp e muta só a cópia do guard, este companheiro (também copiado, intacto) resolve o
 *   caminho DENTRO do mesmo tmp e exercita o guard MUTADO, não o real.
 *
 * O QUE NUNCA MAIS PODE PASSAR: um caso sumir na mudança de arquivo (mesmos 64 nomes de caso de antes
 *   da separação); a suíte testar o guard ERRADO (caminho fixo em vez de relativo ao próprio
 *   `import.meta.url` — quebraria a prova-de-vida, que muta uma CÓPIA).
 *
 * O QUE ESTE ARQUIVO **NÃO** VÊ: nada de novo — é a MESMA suíte do guard, só movida; os limites são os
 *   mesmos documentados na certidão de `../leis-integrity.mjs`.
 *
 * CONTRA-PROVA: node scripts/guards/leis-integrity.mjs --self-test (suíte em
 *   scripts/guards/selftest/leis-integrity.mjs)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../../lib/guard-doctrine.mjs';
import {
  NOME, ARQUIVO_ALVO, NOMES_CANONICOS,
  auditarLeis, auditarBussola, acharImportsEmTexto, resolverImportsRecursivo,
} from '../leis-integrity.mjs';

// ─── fixtures do self-test: constrói a seção a partir de NOMES_CANONICOS (config, não texto solto) ──
function construirSecao(nomes = NOMES_CANONICOS, {
  titulo = '## AS 12 LEIS DO DESENVOLVIMENTO (a Bússola)', corpoExtra = '', numeros = null,
} = {}) {
  const linhas = [titulo, ''];
  nomes.forEach((nome, idx) => {
    const n = numeros ? numeros[idx] : idx + 1;
    linhas.push(`${n}. **${nome}** — corpo livre da lei, explicando o que ela cobra.`);
  });
  if (corpoExtra) linhas.push(corpoExtra);
  linhas.push('', '## Outra seção qualquer', 'texto depois da seção não importa.');
  return linhas.join('\n');
}

// LI-1: esconde a lei no índice `indiceComentado` (0-based) dentro de `<!-- -->` em linhas próprias.
function comLeiComentada(indiceComentado) {
  const linhas = ['## AS 12 LEIS DO DESENVOLVIMENTO (a Bússola)', ''];
  NOMES_CANONICOS.forEach((nome, idx) => {
    const linhaItem = `${idx + 1}. **${nome}** — corpo livre.`;
    if (idx === indiceComentado) linhas.push('<!--', linhaItem, '-->');
    else linhas.push(linhaItem);
  });
  linhas.push('', '## Outra seção', 'rodapé.');
  return linhas.join('\n');
}

// LI-1: a SEÇÃO INTEIRA (A2) dentro de um único comentário HTML.
function secaoInteiraComentada() {
  return ['# projeto', '', '<!--', construirSecao(), '-->', ''].join('\n');
}

export function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── auditarLeis: o que NUNCA pode passar (núcleo estrutural, inalterado) ──
  check('BYPASS: 11 leis (falta LEI DA PROVA) → contagem → reprova',
    auditarLeis(construirSecao(NOMES_CANONICOS.filter((_, idx) => idx !== 6))).ok === false);
  check('contagem: mensagem nomeada "contagem"',
    auditarLeis(construirSecao(NOMES_CANONICOS.filter((_, idx) => idx !== 6)))
      .problemas.some((p) => p.startsWith('contagem')));

  check('BYPASS: lei renomeada (nome fora do canônico) → nome → reprova',
    auditarLeis(construirSecao(NOMES_CANONICOS.map((n, idx) => (idx === 0 ? 'LEI DO PAPEL TROCADA' : n)))).ok === false);
  check('nome: mensagem nomeada "nome" com esperado/achou', (() => {
    const problemas = auditarLeis(construirSecao(NOMES_CANONICOS.map((n, idx) => (idx === 0 ? 'LEI DO PAPEL TROCADA' : n)))).problemas;
    return problemas.some((p) => p.startsWith('nome') && p.includes('esperado') && p.includes('achou'));
  })());

  check('BYPASS: duas leis trocadas de ordem (conteúdo trocado, números 1..12 intactos) → reprova', (() => {
    const trocadas = [...NOMES_CANONICOS];
    [trocadas[2], trocadas[3]] = [trocadas[3], trocadas[2]];
    return auditarLeis(construirSecao(trocadas)).ok === false;
  })());

  check('BYPASS: número pulado (4 vira 5, resto sobe 1) → numeracao → reprova', (() => {
    const numeros = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    return auditarLeis(construirSecao(NOMES_CANONICOS, { numeros })).ok === false;
  })());
  check('numeracao: mensagem nomeada "numeracao" com posição/número', (() => {
    const numeros = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    return auditarLeis(construirSecao(NOMES_CANONICOS, { numeros }))
      .problemas.some((p) => p.startsWith('numeracao') && p.includes('posição'));
  })());

  check('BYPASS: seção ausente → secao-ausente → reprova',
    auditarLeis('# projeto qualquer\nsem a seção das leis em lugar nenhum aqui.\n').ok === false);
  check('secao-ausente: mensagem nomeada corretamente',
    auditarLeis('# nada\n').problemas[0].startsWith('secao-ausente'));

  check('BYPASS: seção duplicada (aparece 2x) → secao-duplicada → reprova',
    auditarLeis(`${construirSecao()}\n${construirSecao()}`).ok === false);
  check(
    'LI-6 (R3): secao-duplicada — mensagem nomeada corretamente via .some(p => p?.startsWith(...)), ' +
    'não problemas[0] direto (mata mutante M4 com ✗ limpo, sem CRASHAR)',
    auditarLeis(`${construirSecao()}\n${construirSecao()}`).problemas.some((p) => p?.startsWith('secao-duplicada')));

  check('BYPASS (TRUNCADO): seção cortada no meio (só 6 leis presentes) → contagem → reprova',
    auditarLeis(construirSecao().split('\n').slice(0, 8).join('\n')).ok === false);

  check('BYPASS (INVISÍVEL): U+200B dentro do nome não é absorvido pelo colapso de espaço → nome → reprova', (() => {
    const zwsp = String.fromCharCode(0x200b); // zero-width space: NÃO casa \s no JS
    const nomeComInvisivel = `LEI DO PA${zwsp}PEL`;
    return auditarLeis(construirSecao(NOMES_CANONICOS.map((n, idx) => (idx === 0 ? nomeComInvisivel : n)))).ok === false;
  })());

  check('BYPASS (NULO): auditarLeis(null/undefined/"") nunca é "ok" — vira secao-ausente, não aprovação silenciosa',
    auditarLeis(null).ok === false && auditarLeis(undefined).ok === false && auditarLeis('').ok === false);

  // ── auditarLeis: o que NUNCA pode bloquear ──
  check('NUNCA BLOQUEIA: as 12 leis certas, corpo livre → ok', auditarLeis(construirSecao()).ok === true);
  check('NUNCA BLOQUEIA: as 12 certas com corpo e emendas em blockquote (">") → ok',
    auditarLeis(construirSecao(NOMES_CANONICOS, {
      corpoExtra: '> Emenda 2026-01-01: ajusta o texto da LEI DO EXEMPLO.\n' +
        '> 13. **LEI FALSA DENTRO DE CITAÇÃO** — bloco citado não conta como item.',
    })).ok === true);
  check('NUNCA BLOQUEIA: espaço duplo entre palavras + acento em forma NFD ainda casa (normaliza) → ok', (() => {
    const nomeVariante = 'LEI  DO  NÃO-CHUTE'.normalize('NFD'); // espaço duplo + acento decomposto
    return auditarLeis(construirSecao(NOMES_CANONICOS.map((n, idx) => (idx === 1 ? nomeVariante : n)))).ok === true;
  })());
  check('NUNCA BLOQUEIA: quebras de linha CRLF não derrubam conteúdo correto → ok',
    auditarLeis(construirSecao().replace(/\n/g, '\r\n')).ok === true);
  check('NUNCA BLOQUEIA: texto antes/depois da seção não interfere → ok',
    auditarLeis(`preâmbulo qualquer\n\n${construirSecao()}\n\nrodapé qualquer`).ok === true);

  // ── LI-6: 3 mutantes que sobreviviam ao self-test antigo, agora mordidos ──
  check(
    'LI-6: título "## AS 12 LEIS..." citado NO MEIO de uma frase não inicia seção ' +
    '(mata mutante da âncora de RE_SECAO) → secao-ausente', (() => {
      const r = auditarLeis('Nota: ver "## AS 12 LEIS DO DESENVOLVIMENTO" citada aqui, no meio da frase.\n\nsem seção real em lugar nenhum.\n');
      return r.ok === false && r.problemas[0].startsWith('secao-ausente');
    })());
  check(
    'LI-6: item numerado numa seção POSTERIOR (depois do próximo "## ") não conta pra contagem ' +
    '(mata mutante de RE_FIM_SECAO) → contagem', (() => {
      const linhas = ['## AS 12 LEIS DO DESENVOLVIMENTO', ''];
      NOMES_CANONICOS.slice(0, 11).forEach((nome, idx) => linhas.push(`${idx + 1}. **${nome}** — corpo.`));
      linhas.push('', '## Outra seção', `12. **${NOMES_CANONICOS[11]}** — item que NÃO deveria contar, está fora da seção.`);
      const r = auditarLeis(linhas.join('\n'));
      return r.ok === false && r.problemas.some((p) => p.startsWith('contagem') && p.includes('11'));
    })());
  check(
    'LI-6: blockquote com o NOME EXATO da lei ("> 13. **LEI DO EXTRA**") não conta como item de topo ' +
    '(mata mutante de RE_ITEM aceitando blockquote) → ok',
    auditarLeis(construirSecao(NOMES_CANONICOS, {
      corpoExtra: '> 13. **LEI DO EXTRA** — citação com o padrão exato; não pode contar.',
    })).ok === true);
  check(
    'LI-6: item INDENTADO ("   13. **LEI DO EXTRA**") também não conta como item de topo ' +
    '(mata mutante de RE_ITEM aceitando indentação) → ok',
    auditarLeis(construirSecao(NOMES_CANONICOS, {
      corpoExtra: '   13. **LEI DO EXTRA** — indentado; não pode contar.',
    })).ok === true);

  // ── LI-1 / LI-7: auditarBussola (despirMarkdown antes de auditar) ──
  check('LI-1: comentário HTML esconde SÓ uma lei (A1) → contagem → reprova',
    auditarBussola(comLeiComentada(6)).ok === false);
  check('LI-1: contagem cai pra 11 quando a lei está em comentário (A1)',
    auditarBussola(comLeiComentada(6)).problemas.some((p) => p.startsWith('contagem')));
  check('LI-1: comentário HTML esconde a SEÇÃO INTEIRA (A2) → secao-ausente → reprova',
    auditarBussola(secaoInteiraComentada()).ok === false &&
    auditarBussola(secaoInteiraComentada()).problemas[0].startsWith('secao-ausente'));
  check(
    'LI-7: seção real apagada, só sobra EXEMPLO dentro de bloco de código cercado (A7) → secao-ausente ' +
    '(antes a certidão dizia "nunca falso-negativo" — falso)', (() => {
      const texto = ['# proj', '', 'Formato esperado (exemplo, não é a seção real):', '', '```md', construirSecao(), '```', ''].join('\n');
      const r = auditarBussola(texto);
      return r.ok === false && r.problemas[0].startsWith('secao-ausente');
    })());
  check('NUNCA BLOQUEIA (auditarBussola): as 12 certas, sem nenhum comentário/bloco → ok', auditarBussola(construirSecao()).ok === true);

  // ── acharImportsEmTexto / resolverImportsRecursivo (puras, fs injetada) ──
  check('acharImportsEmTexto: acha "@caminho" em QUALQUER posição da linha, não só sozinho (LI-4/B1)',
    acharImportsEmTexto('As leis estão em @leis.md — leia antes de tudo.').some((r) => r.especificador === 'leis.md'));
  check('acharImportsEmTexto: ignora "@" dentro de bloco de código cercado (LI-3/A3)',
    acharImportsEmTexto('texto\n```\n@leis.md\n```\n').length === 0);
  check('acharImportsEmTexto: ignora "@" dentro de comentário HTML (LI-1)',
    acharImportsEmTexto('texto\n<!-- @leis.md -->\nfim').length === 0);
  check('acharImportsEmTexto: sem nenhum "@" → lista vazia',
    acharImportsEmTexto('linha1\nlinha2').length === 0);

  check('resolverImportsRecursivo: import DENTRO de dirRaiz resolve e concatena no lugar da linha (fs fake)', (() => {
    const r = resolverImportsRecursivo('antes\n@ok/CLAUDE.md\ndepois', 'C:\\raiz', {
      existe: (p) => p === 'C:\\raiz\\ok\\CLAUDE.md', ler: () => 'CONTEUDO-IMPORTADO',
    });
    return r.foraDoRepo === null && r.texto === 'antes\nCONTEUDO-IMPORTADO\ndepois';
  })());
  check('resolverImportsRecursivo: sem nenhuma ocorrência de "@" → texto intacto (fs fake nem é chamada)', (() => {
    const r = resolverImportsRecursivo('linha1\nlinha2', 'C:\\raiz', {
      existe: () => { throw new Error('não deveria chamar'); },
      ler: () => { throw new Error('não deveria chamar'); },
    });
    return r.foraDoRepo === null && r.texto === 'linha1\nlinha2';
  })());
  check('resolverImportsRecursivo: import que NÃO existe fica LITERAL, não quebra sozinho (fs fake) (LI-4/B5)', (() => {
    const r = resolverImportsRecursivo('antes\n@fulano\ndepois', 'C:\\raiz', {
      existe: () => false, ler: () => { throw new Error('não deveria ler'); },
    });
    return r.foraDoRepo === null && r.texto === 'antes\n@fulano\ndepois';
  })());
  check(
    'resolverImportsRecursivo: caminho RELATIVO resolve a partir do ARQUIVO que importa, não sempre ' +
    'da raiz (2 níveis, fs fake) (LI-4/B6)', (() => {
      const arquivos = {
        'C:\\raiz\\sub\\a.md': '@b/c.md', // "b/c.md" é relativo a C:\raiz\sub (onde a.md está), não a C:\raiz
        'C:\\raiz\\sub\\b\\c.md': 'CONTEUDO-FINAL',
      };
      const r = resolverImportsRecursivo('@sub/a.md', 'C:\\raiz', { existe: (p) => p in arquivos, ler: (p) => arquivos[p] });
      return r.foraDoRepo === null && r.texto === 'CONTEUDO-FINAL';
    })());
  check('resolverImportsRecursivo: caminho ABSOLUTO usado como está (fs fake) (LI-4/B2)', (() => {
    const alvo = 'C:\\raiz\\abs\\leis.md';
    const r = resolverImportsRecursivo(`@${alvo}`, 'C:\\raiz', { existe: (p) => p === alvo, ler: () => 'CONTEUDO-ABS' });
    return r.foraDoRepo === null && r.texto === 'CONTEUDO-ABS';
  })());
  check('NUNCA BLOQUEIA (LI-4): "~/" expande para o homedir injetado (fs fake)', (() => {
    const r = resolverImportsRecursivo('@~/leis.md', 'C:\\raiz', {
      existe: (p) => p === 'C:\\raiz\\home\\leis.md',
      ler: () => 'CONTEUDO-HOME',
      homedir: () => 'C:\\raiz\\home',
    });
    return r.foraDoRepo === null && r.texto === 'CONTEUDO-HOME';
  })());
  check(
    'resolverImportsRecursivo: import MULTILINHA no MEIO de uma linha ganha quebra própria — "^##" do ' +
    'conteúdo importado não cola no texto antes dele (fs fake) (LI-4/B1)', (() => {
      const r = resolverImportsRecursivo('antes @m.md depois', 'C:\\raiz', { existe: (p) => p === 'C:\\raiz\\m.md', ler: () => '## Título\nlinha2' });
      return r.foraDoRepo === null && r.texto === 'antes \n## Título\nlinha2\n depois';
    })());
  check('resolverImportsRecursivo: import cujo alvo cai FORA de dirRaiz → foraDoRepo, não expande (fs fake) (LI-3/C2)', (() => {
    const r = resolverImportsRecursivo('@../fora/leis.md', 'C:\\raiz\\proj', { existe: () => true, ler: () => 'NUNCA-DEVERIA-APARECER' });
    return r.texto === null && r.foraDoRepo?.especificador === '../fora/leis.md';
  })());

  // ── PORTA (issue #17): processo real, via --dir em árvores tmp — caminho do GUARD calculado a
  // partir do PRÓPRIO import.meta.url deste companheiro (sobe 1 nível: selftest/ -> guards/), nunca
  // fixo — é isto que faz a prova-de-vida exercitar a cópia MUTADA quando copia a árvore inteira.
  const caminhoGuard = join(dirname(fileURLToPath(import.meta.url)), '..', 'leis-integrity.mjs');
  const envFilho = { ...process.env, npm_lifecycle_event: '' };
  const porta = (dir) => spawnSync(process.execPath, [caminhoGuard, '--dir', dir], { encoding: 'utf8', timeout: 60_000, env: envFilho }).status;

  const raizTmp = mkdtempSync(join(tmpdir(), 'leis-integrity-'));
  try {
    // helper: cria `raizTmp/nome`, grava cada `{caminhoRelativo: conteudo}`, roda a PORTA e já conta o caso.
    const fixture = (nome, arquivos, esperado, msg) => {
      const d = join(raizTmp, nome);
      mkdirSync(d, { recursive: true });
      for (const [rel, conteudo] of Object.entries(arquivos)) {
        mkdirSync(dirname(join(d, rel)), { recursive: true });
        writeFileSync(join(d, rel), conteudo);
      }
      check(msg, porta(d) === esperado);
      return d;
    };
    const onze = construirSecao(NOMES_CANONICOS.filter((_, idx) => idx !== 6)); // 11 leis, falta LEI DA PROVA

    fixture('sem-claude-md', {}, 0, 'PORTA: --dir sem CLAUDE.md (nem raiz nem .claude/) → NÃO SE APLICA → exit 0');
    check('PORTA: --dir sem caminho → NÃO MEDIU → exit 2',
      spawnSync(process.execPath, [caminhoGuard, '--dir'], { encoding: 'utf8', env: envFilho }).status === 2);
    check(
      'LI-5: --dir apontando pra pasta que NÃO EXISTE → NÃO MEDIU → exit 2 ' +
      '(antes: NÃO SE APLICA/exit 0, incoerente com os scanners irmãos)',
      porta(join(raizTmp, 'esta-pasta-nao-existe')) === 2);

    const ok12 = fixture('ok12', { [ARQUIVO_ALVO]: construirSecao() }, 0, 'PORTA: CLAUDE.md com as 12 leis corretas → exit 0');
    check(
      'LI-9: caminho de APROVAÇÃO exercitado de verdade — Bússola intacta aprova por CONTEÚDO, não só ' +
      'por ausência (o "0 no vácuo" do minefield/referencia-limpo, fora do meu escopo, fica coberto AQUI) → exit 0',
      porta(ok12) === 0);

    fixture('falta1', { [ARQUIVO_ALVO]: onze }, 1, 'BYPASS: CLAUDE.md com 11 leis (falta LEI DA PROVA) → exit 1');
    fixture(
      'via-import', { [ARQUIVO_ALVO]: '@sub/CLAUDE.md\n', 'sub/CLAUDE.md': construirSecao() }, 0,
      'NUNCA BLOQUEIA: as 12 corretas vindas via "@sub/CLAUDE.md" (import) → exit 0');
    fixture(
      'import-quebrado', { [ARQUIVO_ALVO]: '@nao-existe/CLAUDE.md\n' }, 1,
      'BYPASS: @import inexistente, é TUDO que o CLAUDE.md tem → secao-ausente → exit 1 (não quebra à parte — LI-4)');
    fixture(
      'sem-secao', { [ARQUIVO_ALVO]: '# projeto qualquer\nsem a seção das leis aqui.\n' }, 1,
      'BYPASS: CLAUDE.md sem a seção "AS 12 LEIS" → exit 1 (secao-ausente)');

    // LI-1: comentário HTML escondendo a lei/seção — reproduz o ataque A1/A2 via processo real.
    fixture(
      'li1-a1-lei-comentada', { [ARQUIVO_ALVO]: comLeiComentada(6) }, 1,
      'LI-1: PORTA — comentário HTML esconde a LEI DA PROVA (A1, node --dir) → exit 1 (antes: exit 0)');
    fixture(
      'li1-a2-secao-comentada', { [ARQUIVO_ALVO]: secaoInteiraComentada() }, 1,
      'LI-1: PORTA — comentário HTML esconde a SEÇÃO INTEIRA (A2) → exit 1 (antes: exit 0)');

    // LI-2: Bússola no local OFICIAL alternativo `.claude/CLAUDE.md`.
    fixture(
      'li2-bussola-movida', { '.claude/CLAUDE.md': onze }, 1,
      'LI-2: PORTA — Bússola QUEBRADA movida pra .claude/CLAUDE.md (A4) → exit 1 (antes: exit 0, guard cego)');
    fixture('li2-oculta-ok', { '.claude/CLAUDE.md': construirSecao() }, 0, 'LI-2 (NUNCA BLOQUEIA): só .claude/CLAUDE.md existe e está CORRETA → exit 0');
    fixture(
      'li2-renomeada', { 'CLAUDE.old.md': construirSecao() }, 0,
      'LI-2: nem CLAUDE.md nem .claude/CLAUDE.md existem (A5, renomeado p/ CLAUDE.old.md) → NÃO SE APLICA → exit 0 (limite DECLARADO — ver certidão)');

    // LI-3: import dentro de bloco de código cercado (A3) e import fora do --dir (C2).
    fixture(
      'li3-a3-import-em-bloco',
      { [ARQUIVO_ALVO]: '# proj\n\nExemplo (ilustrativo):\n\n```\n@leis.md\n```\n', 'leis.md': construirSecao() }, 1,
      'LI-3: PORTA — import DENTRO de bloco cercado não expande (A3) → secao-ausente → exit 1 (antes: exit 0)');
    const li3C2Proj = join(raizTmp, 'li3-c2-fora', 'proj');
    mkdirSync(li3C2Proj, { recursive: true });
    mkdirSync(join(raizTmp, 'li3-c2-fora', 'fora'), { recursive: true });
    writeFileSync(join(raizTmp, 'li3-c2-fora', 'fora', 'leis.md'), construirSecao());
    writeFileSync(join(li3C2Proj, ARQUIVO_ALVO), '@../fora/leis.md\n');
    check(
      'LI-3: PORTA — import apontando pra FORA do --dir (C2) → import-fora-do-repo → exit 1 (antes: exit 0, seguido calado)',
      porta(li3C2Proj) === 1);

    // LI-4: sintaxe real do @import (inline, absoluto, 2 níveis, menção solta).
    fixture(
      'li4-b1-inline', { [ARQUIVO_ALVO]: 'As leis estão em @leis.md — leia antes de tudo.\n', 'leis.md': construirSecao() }, 0,
      'LI-4: PORTA — import "@caminho" NO MEIO de uma frase (B1) expande → exit 0 (antes: exit 1)');
    const li4B2 = join(raizTmp, 'li4-b2-absoluto'); mkdirSync(li4B2);
    const li4B2LeisAbs = join(li4B2, 'leis.md');
    writeFileSync(li4B2LeisAbs, construirSecao());
    writeFileSync(join(li4B2, ARQUIVO_ALVO), `@${li4B2LeisAbs}\n`);
    check('LI-4: PORTA — import de caminho ABSOLUTO (B2) resolve → exit 0 (antes: exit 1)', porta(li4B2) === 0);
    fixture(
      'li4-b6-2niveis', { [ARQUIVO_ALVO]: '@a.md\n', 'a.md': '@b.md\n', 'b.md': construirSecao() }, 0,
      'LI-4: PORTA — import de 2 NÍVEIS (CLAUDE.md→a.md→b.md, B6) → exit 0 (antes: exit 1, só 1 nível)');
    fixture(
      'li4-b5-mencao', { [ARQUIVO_ALVO]: `${construirSecao()}\n\nRevisor do método:\n@fulano\n` }, 0,
      'LI-4: PORTA — menção solta "@fulano" que NÃO resolve não quebra a Bússola já íntegra (B5) → exit 0 (antes: exit 1)');

    // LI-7: seção real apagada, só sobra EXEMPLO em bloco de código cercado (A7).
    fixture(
      'li7-so-exemplo-em-bloco',
      { [ARQUIVO_ALVO]: ['# proj', '', 'Formato esperado (exemplo, não é a seção real):', '', '```md', construirSecao(), '```', ''].join('\n') }, 1,
      'LI-7: PORTA — seção real apagada, só sobra EXEMPLO em bloco cercado (A7) → secao-ausente → exit 1 (antes: exit 0)');

    // LI-8: BOM (U+FEFF) no arquivo importado e no próprio CLAUDE.md raiz, título na linha 1.
    fixture(
      'li8-bom-importado', { [ARQUIVO_ALVO]: '@leis.md\n', 'leis.md': '\uFEFF' + construirSecao() }, 0,
      'LI-8: PORTA — BOM no início do arquivo IMPORTADO, título na linha 1 (B3) → exit 0 (antes: exit 1)');
    fixture(
      'li8-bom-raiz', { [ARQUIVO_ALVO]: '\uFEFF' + construirSecao() }, 0,
      'LI-8: PORTA — BOM no início do CLAUDE.md raiz, título na linha 1 (B4) → exit 0 (antes: exit 1)');

    // Morde a mutação canônica da PORTA (prova-de-vida: exitCode 2 virando 0): CLAUDE.md é um
    // DIRETÓRIO em vez de arquivo → a leitura lança → só o catch do rodapé sai com o código 2.
    const claudeEhPasta = join(raizTmp, 'claude-e-pasta'); mkdirSync(claudeEhPasta); mkdirSync(join(claudeEhPasta, ARQUIVO_ALVO));
    check('PORTA: CLAUDE.md é um diretório (leitura lança) → NÃO MEDIU → exit 2', porta(claudeEhPasta) === 2);
  } finally {
    rmSync(raizTmp, { recursive: true, force: true });
  }

  return relatarSelfTest(NOME, casos);
}
