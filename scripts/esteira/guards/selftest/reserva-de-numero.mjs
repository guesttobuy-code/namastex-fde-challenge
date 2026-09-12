/**
 * ─── COMPANION de self-test de ../reserva-de-numero.mjs ──────────────────────
 * POR QUE EM ARQUIVO SEPARADO: regra do coordenador — nenhum arquivo do kit passa de 600 LINHAS
 *   VISUAIS. `../reserva-de-numero.mjs` continua sendo A PORTA: `--self-test` importa ESTE arquivo
 *   dinamicamente (sem `await` no topo — evita "unsettled top-level await", já que este companion
 *   importa `medir`/`julgar` DE VOLTA do guard). O caminho do alvo é calculado a partir do PRÓPRIO
 *   `import.meta.url` (nunca de `process.argv`), pra continuar correto quando a prova-de-vida copia
 *   `scripts/` inteira pra um tmp e muta só a cópia do guard.
 *
 * COBERTURA (achados da auditoria adversarial, ADR-0004): RN-C1/C2 (nome numerado — separador "_",
 *   extensão livre, pasta), RN-C3 (guard não importa de scripts/ — checagem estática), RN-C4 (certidão
 *   completa — checagem estática), RN-C6 (molde isento), RN-C8 (reserva órfã), RN-01/02 (duplicata e
 *   largura por VALOR), RN-05 (dir ruim → NÃO MEDIU; governance/adr sem tipo → FALHA), RN-06 (migrations
 *   em qualquer nível, pasta Prisma), RN-07 (BOM, aspas, "./dir", tipo aninhado), RN-10 (fix-hint não
 *   promete script inexistente), RN-12 (subpasta não pulada, junction → NÃO MEDIU), RN-13 (path.relative,
 *   numero do frontmatter).
 *
 * CONTRA-PROVA: node scripts/guards/reserva-de-numero.mjs --self-test
 * ───────────────────────────────────────────────────────────────────────────
 */
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../../lib/guard-doctrine.mjs';
import { medir, julgar } from '../reserva-de-numero.mjs';
import { frontmatterReserva } from '../../lib/reservas.mjs';

const NOME = 'reserva-de-numero';
const ALVO = fileURLToPath(new URL('../reserva-de-numero.mjs', import.meta.url));
const MEU_CAMINHO = fileURLToPath(import.meta.url);
const ENV_SEM_NPM = { ...process.env, npm_lifecycle_event: '' };

// Absoluto neutro por plataforma pra provar "dir configurado como caminho absoluto → reprova" —
// nunca precisa existir de verdade (a checagem real é isAbsolute(), não presença no disco). Antes
// era a string 'C:/nao/existe/xyz', só absoluta no Windows: `path.isAbsolute()` real (que o guard usa
// em `reserva-de-numero.mjs:116`) devolve `false` pra isso no POSIX, e o caso nunca lançava fora do
// Windows (issue #27, causa 2). `path.resolve()` de um caminho começando com "/" é absoluto nos dois
// sistemas (no Windows resolve pra dentro da unidade atual, ex. "C:\nao\existe\xyz").
const DIR_ABSOLUTO_INEXISTENTE = resolve('/nao/existe/xyz');

const ADR = { dir: 'governance/adr', padrao: 'sequencial', largura: 4 };
const cfg = (tipos) => JSON.stringify({ tipos }, null, 2);

function put(dir, rel, txt = '# x\n') {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, txt);
  return p;
}
function res(numero, slug, extra = '') {
  const semRodape = frontmatterReserva({ numero, slug, branch: 'main', data: '2026-09-11', status: 'criado' }).slice(0, -4);
  return `${semRodape}\n${extra}---\n`;
}
function mkTree(montar) {
  const dir = mkdtempSync(join(tmpdir(), 'rdn-g-'));
  mkdirSync(join(dir, 'governance'), { recursive: true });
  montar(dir);
  return dir;
}

function selfTestJulgar(check) {
  check('NAO_APLICAVEL: dados.aplicavel === false', julgar({ aplicavel: false }).estado === 'NAO_APLICAVEL');
  check(
    'BYPASS (NULO): julgar(null)/julgar(undefined) → NAO_APLICAVEL, nunca explode',
    julgar(null).estado === 'NAO_APLICAVEL' && julgar(undefined).estado === 'NAO_APLICAVEL',
  );

  const item = (numero, slugArquivo, slugReserva, numeroFrontmatter = numero) => ({
    caminho: `governance/adr/${numero}-${slugArquivo}.md`, numero, slugArquivo, reservaExiste: true, slugReserva, numeroFrontmatter,
  });
  const tipo = (itens, extra = {}) => ({
    tipo: 'adr', ligado: true, dir: 'governance/adr', largura: 4, padrao: 'sequencial', reservas: [], itens, ...extra,
  });
  const base = (tipos, extra = {}) => ({
    aplicavel: true, tipos, adr: { existe: false, coberta: true }, migrationsSemCobertura: [], ...extra,
  });

  const okItem = item('0005', 'exemplo', 'exemplo');
  check('OK: reserva existe e slug/numero batem → 0 falhas', julgar(base([tipo([okItem])])).falhas.length === 0);

  const semReserva = {
    caminho: 'governance/adr/0006-outro.md', numero: '0006', slugArquivo: 'outro', reservaExiste: false, slugReserva: null, numeroFrontmatter: null,
  };
  check(
    'BYPASS: item sem reserva → FALHA sem-reserva',
    julgar(base([tipo([semReserva])])).falhas.some((f) => f.tipo === 'sem-reserva'),
  );

  const divergente = item('0007', 'foo-bar', 'foo-baz');
  check(
    'BYPASS: slug do arquivo diverge do slug da reserva → FALHA reserva-diverge',
    julgar(base([tipo([divergente])])).falhas.some((f) => f.tipo === 'reserva-diverge'),
  );
  const normalizavel = item('0008', 'foo-bar', 'Foo_Bar');
  check(
    'NUNCA BLOQUEIA: slug bate após normalizar (maiúscula / "_" x "-")',
    julgar(base([tipo([normalizavel])])).falhas.length === 0,
  );
  const slugVazio = {
    caminho: 'x', numero: '0009', slugArquivo: 'algo', reservaExiste: true, slugReserva: null, numeroFrontmatter: '0009',
  };
  check(
    'BYPASS (NULO): reserva sem slug no frontmatter nunca "bate por acaso"',
    julgar(base([tipo([slugVazio])])).falhas.some((f) => f.tipo === 'reserva-diverge'),
  );

  const numeroDivergente = item('0001', 'x', 'x', '0007');
  check(
    'RN-13: numero do frontmatter diverge do nome → FALHA numero-diverge',
    julgar(base([tipo([numeroDivergente])])).falhas.some((f) => f.tipo === 'numero-diverge'),
  );

  const dupA = item('0001', 'foo-bar', 'foo-bar');
  const dupB = { ...item('0001', 'foo-baz', 'foo-baz'), caminho: 'governance/adr/0001-foo-baz.md' };
  check(
    'RN-02: dois itens com o MESMO valor numérico → FALHA numero-duplicado',
    julgar(base([tipo([dupA, dupB])])).falhas.some((f) => f.tipo === 'numero-duplicado'),
  );
  const larguraErrada = { ...item('001', 'x', 'x', '001'), caminho: 'governance/adr/001-x.md' };
  check(
    'RN-02: número com largura diferente da config → FALHA largura-diverge',
    julgar(base([tipo([larguraErrada])])).falhas.some((f) => f.tipo === 'largura-diverge'),
  );
  const larguraOk = item('0001', 'x', 'x');
  check(
    'NUNCA BLOQUEIA: número com a largura certa não reprova',
    julgar(base([tipo([larguraOk])])).falhas.every((f) => f.tipo !== 'largura-diverge'),
  );
  const itemTimestamp = item('20260911000000', 'x', 'x');
  const tipoTimestamp = tipo([itemTimestamp], { padrao: 'timestamp' });
  check(
    'NUNCA BLOQUEIA: padrão timestamp não é cobrado por largura',
    julgar(base([tipoTimestamp])).falhas.every((f) => f.tipo !== 'largura-diverge'),
  );

  const tipoOrfa = { ...tipo([]), reservas: [{ arquivo: '0005.md', numero: '0005', status: 'criado' }] };
  check(
    'RN-C8: reserva "criado" sem item correspondente → FALHA reserva-orfa',
    julgar(base([tipoOrfa])).falhas.some((f) => f.tipo === 'reserva-orfa'),
  );
  const tipoEmVoo = { ...tipo([]), reservas: [{ arquivo: '0006.md', numero: '0006', status: 'reservado' }] };
  check(
    'NUNCA BLOQUEIA: reserva "reservado" (trabalho em voo) sem item não reprova',
    julgar(base([tipoEmVoo])).falhas.every((f) => f.tipo !== 'reserva-orfa'),
  );

  const tipoDesligadoComItem = { tipo: 'adr', ligado: false, dir: null, itens: [semReserva], reservas: [] };
  check(
    'NUNCA BLOQUEIA: tipo desligado não é cobrado mesmo com itens',
    julgar(base([tipoDesligadoComItem])).falhas.length === 0,
  );

  check(
    'RN-05: governance/adr existe sem tipo cobrindo → FALHA adr-dir-sem-tipo',
    julgar(base([], { adr: { existe: true, coberta: false } })).falhas.some((f) => f.tipo === 'adr-dir-sem-tipo'),
  );
  check(
    'NUNCA BLOQUEIA: governance/adr existe e ESTÁ coberta → ok',
    julgar(base([], { adr: { existe: true, coberta: true } })).falhas.length === 0,
  );
  check(
    'RN-06: pasta "migrations" sem cobertura → FALHA migrations-sem-reserva',
    julgar(base([], { migrationsSemCobertura: ['db/migrations'] })).falhas.some((f) => f.tipo === 'migrations-sem-reserva'),
  );
}

function selfTestMedirBasico(check) {
  check('medir: sem governance/RESERVAS.json → aplicavel:false', medir(mkTree(() => {})).aplicavel === false);
  check('BYPASS (VAZIO): RESERVAS.json não é JSON válido → lança', (() => {
    try { medir(mkTree((d) => put(d, 'governance/RESERVAS.json', '{ nao e json'))); return false; } catch { return true; }
  })());
  check('BYPASS (VAZIO): "tipos" ausente/vazio → lança', (() => {
    try { medir(mkTree((d) => put(d, 'governance/RESERVAS.json', cfg({})))); return false; } catch { return true; }
  })());
  check('NUNCA BLOQUEIA: tipo ligado cuja pasta ainda não existe (nunca usado) → itens:[], não lança', (() => {
    const dados = medir(mkTree((d) => put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }))));
    return dados.tipos.find((t) => t.tipo === 'adr').itens.length === 0;
  })());
  check('RN-05: tipo ligado com dir ABSOLUTO → lança', (() => {
    const cfgAbsoluto = cfg({ adr: { ...ADR, dir: DIR_ABSOLUTO_INEXISTENTE } });
    try { medir(mkTree((d) => put(d, 'governance/RESERVAS.json', cfgAbsoluto))); return false; } catch { return true; }
  })());

  check('RN-C1: item com separador "_" (Supabase) e extensão .sql sem reserva → FALHA', (() => {
    const dados = medir(mkTree((d) => {
      put(d, 'governance/RESERVAS.json', cfg({ mig: { dir: 'sup/migrations', padrao: 'timestamp', largura: 4 } }));
      put(d, 'sup/migrations/0001_init.sql', 'x');
    }));
    return julgar(dados).falhas.some((f) => f.tipo === 'sem-reserva' && /0001_init/.test(f.arquivo));
  })());
  check('RN-C2: item PASTA sem extensão (Prisma) sem reserva → FALHA', (() => {
    const dados = medir(mkTree((d) => {
      put(d, 'governance/RESERVAS.json', cfg({ mig: { dir: 'prisma/migrations', padrao: 'timestamp', largura: 4 } }));
      put(d, 'prisma/migrations/20240101000000-init/migration.sql', 'x');
      put(d, 'prisma/migrations/20240102000000-add-y/migration.sql', 'x');
    }));
    const f = julgar(dados).falhas.filter((x) => x.tipo === 'sem-reserva');
    return f.length === 2;
  })());
  check('RN-C6: o MOLDE não vira item (isento de reserva)', (() => {
    const dados = medir(mkTree((d) => {
      put(d, 'governance/RESERVAS.json', cfg({ adr: { ...ADR, criarDoModelo: 'governance/adr/0000-template.md' } }));
      put(d, 'governance/adr/0000-template.md');
    }));
    return dados.tipos.find((t) => t.tipo === 'adr').itens.length === 0;
  })());
}

function selfTestPastasConhecidas(check, guard) {
  const E1 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: { ...ADR, dir: null }, migration: { dir: null, padrao: 'timestamp', largura: 4 } }));
    put(d, 'governance/adr/0009-fantasma.md');
  });
  check('RN-05 (E1): governance/adr existe, tipo "adr" DESLIGADO → FALHA adr-dir-sem-tipo', guard(E1).status === 1);
  const E1b = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ migration: { dir: null, padrao: 'timestamp', largura: 4 } }));
    put(d, 'governance/adr/0009-fantasma.md');
  });
  check('RN-05 (E1b): chave "adr" nem existe no config → FALHA adr-dir-sem-tipo', guard(E1b).status === 1);
  const E2 = mkTree((d) => put(d, 'governance/adr/0009-fantasma.md'));
  check('NUNCA BLOQUEIA (E2): sem RESERVAS.json → NAO_APLICAVEL mesmo com fantasma', guard(E2).status === 0);
  const E3 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: { ...ADR, dir: 'governance/adrs' } }));
    put(d, 'governance/adr/0009-fantasma.md');
  });
  check(
    'RN-05 (E3): dir com typo (governance/adrs, não existe) → FALHA adr-dir-sem-tipo (governance/adr real descoberta)',
    guard(E3).status === 1,
  );
  const E3c = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: { ...ADR, dir: DIR_ABSOLUTO_INEXISTENTE } }));
    put(d, 'governance/adr/0009-fantasma.md');
  });
  check('RN-05 (E3c): dir absoluto inexistente → NÃO MEDIU (exit 2)', guard(E3c).status === 2);
  const E4 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({
      doc: { dir: 'docs', padrao: 'sequencial', largura: 4 }, adr: { dir: 'docs/adr', padrao: 'sequencial', largura: 4 },
    }));
    put(d, 'docs/adr/0001-usar-postgres.md');
    put(d, 'governance/reservas/adr/0001.md', res('0001', 'usar-postgres'));
  });
  check('RN-07 (E4): tipo aninhado (docs/adr dentro de docs) com reserva certa → NUNCA BLOQUEIA', guard(E4).status === 0);

  const E6 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR, migration: { dir: './migrations', padrao: 'timestamp', largura: 4 } }));
    mkdirSync(join(d, 'migrations'));
  });
  check('RN-07 (E6): dir "./migrations" (com "./") cobre a pasta real → NUNCA BLOQUEIA', guard(E6).status === 0);
  const E7 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR, migration: { dir: 'prisma/migrations', padrao: 'timestamp', largura: 4 } }));
    put(d, 'prisma/migrations/20240101000000-init/migration.sql', 'x');
    put(d, 'prisma/migrations/20240102000000-add-y/migration.sql', 'x');
  });
  check('RN-06 (E7): migrations do Prisma (pastas) sem reserva → FALHA', guard(E7).status === 1);
  const E8 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR, migration: { dir: null, padrao: 'timestamp', largura: 4 } }));
    put(d, 'apps/api/supabase/migrations/20240101000000-init.sql', 'x');
  });
  check('RN-06 (E8): monorepo (apps/api/supabase/migrations) sem cobertura → FALHA', guard(E8).status === 1);
  const E9 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR, migration: { dir: 'supabase/migrations', padrao: 'timestamp', largura: 4 } }));
    mkdirSync(join(d, 'supabase/migrations'), { recursive: true });
    put(d, 'db/migrations/20240101000000-legado.sql', 'x');
  });
  check('RN-06 (E9): duas pastas "migrations" conhecidas, config cobre só uma → FALHA (a não coberta)', guard(E9).status === 1);
}

function selfTestFrontmatterEIntegridade(check, guard) {
  const E5 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/0001-x.md');
    put(d, 'governance/reservas/adr/0001.md', '\uFEFF' + res('0001', 'x'));
  });
  check('RN-07 (E5): reserva com BOM (editor Windows) → NUNCA BLOQUEIA', guard(E5).status === 0);
  const E5b = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/0001-x.md');
    put(d, 'governance/reservas/adr/0001.md', res('0001', '"x"'));
  });
  check('RN-07 (E5b): slug entre aspas (YAML válido) → NUNCA BLOQUEIA', guard(E5b).status === 0);
  const E5c = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/0001-x.md');
    put(d, 'governance/reservas/adr/0001.md', res('0001', 'x').replace(/\n/g, '\r\n'));
  });
  check('controle (E5c): reserva CRLF → NUNCA BLOQUEIA', guard(E5c).status === 0);

  const d10 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/0009-fantasma.md');
  });
  const r10 = spawnSync(process.execPath, [ALVO, '--dir', '.'], { cwd: d10, encoding: 'utf8', env: ENV_SEM_NPM });
  // o bug antigo (slice em vez de path.relative) cortava as 2 primeiras letras: "governance/..." virava
  // "vernance/..." — aqui checa o caminho CERTO por INTEIRO, com fronteira de palavra (word boundary)
  // antes do "governance", pra não confundir com a substring "vernance" que "governance" já contém.
  check(
    'RN-13 (E10): --dir "." não corta o caminho no relatório (path.relative, não slice)',
    /\bgovernance\/adr\/0009-fantasma\.md/.test(r10.stderr),
  );

  const E11 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/0001-x.md');
    put(d, 'governance/reservas/adr/0001.md', res('0007', 'x'));
  });
  check('RN-13 (E11): numero: 0007 no frontmatter de um arquivo 0001 → FALHA', guard(E11).status === 1);

  const E13 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/0001-foo_bar.md');
    put(d, 'governance/adr/0001-foo-bar.md');
    put(d, 'governance/reservas/adr/0001.md', res('0001', 'foo-bar'));
  });
  check('RN-02 (E13): dois arquivos "0001" (um com "_") → FALHA numero-duplicado', guard(E13).status === 1);
  const E14 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/005-a.md');
    put(d, 'governance/reservas/adr/005.md', res('005', 'a'));
    put(d, 'governance/adr/0005-b.md');
    put(d, 'governance/reservas/adr/0005.md', res('0005', 'b'));
  });
  check('RN-01/02 (E14): "005" e "0005" (mesmo VALOR, larguras diferentes) → FALHA', guard(E14).status === 1);
}

function selfTestSubpastaEJunction(check, guard) {
  const E15 = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/referencia/0042-escondido.md');
  });
  check('RN-12 (E15): numerado escondido em referencia/ DENTRO do dir do tipo → FALHA', guard(E15).status === 1);

  const fora = mkdtempSync(join(tmpdir(), 'rn-fora-'));
  try {
    put(fora, '0099-escondido-por-junction.md');
    const d = mkTree((d2) => {
      put(d2, 'governance/RESERVAS.json', cfg({ adr: ADR }));
      mkdirSync(join(d2, 'governance/adr'), { recursive: true });
    });
    try { symlinkSync(fora, join(d, 'governance/adr/arquivo'), 'junction'); }
    catch { /* ambiente sem privilégio de symlink: caso pulado, não falha a suíte */ return; }
    check('RN-12 (F4): junction dentro do dir do tipo → NÃO MEDIU (exit 2), nunca lido através', guard(d).status === 2);
  } finally { rmSync(fora, { recursive: true, force: true }); }
}

function selfTestEstatico(check) {
  const caminhoGuard = fileURLToPath(new URL('../reserva-de-numero.mjs', import.meta.url));
  const fonteGuard = readFileSync(caminhoGuard, 'utf8');
  const importaDeScripts = /from\s+['"]\.\.\/reservar-numero\.mjs['"]/.test(fonteGuard)
    || /from\s+['"]\.\.\/\.\.\/reservar-numero\.mjs['"]/.test(fonteGuard);
  check('RN-C3: o guard NÃO importa de scripts/ (só de lib/) — camada certa', !importaDeScripts);

  const marcasObrigatorias = [
    'POR QUE EXISTE', 'O QUE FAZ', 'NUNCA MAIS PODE PASSAR', 'GUARD **NÃO** VÊ',
    'MODO DE FALHA', 'BANCA', 'CONTRA-PROVA', 'INCIDENTE DE ORIGEM',
  ];
  check(
    'RN-C4: certidão tem POR QUE EXISTE / O QUE FAZ / NUNCA MAIS PODE PASSAR / NÃO VÊ / MODO DE FALHA / BANCA / CONTRA-PROVA',
    marcasObrigatorias.every((marca) => fonteGuard.includes(marca)),
  );
  check('RN-C4: certidão cita o INCIDENTE DE ORIGEM = ADR-0004', /INCIDENTE DE ORIGEM: ADR-0004/.test(fonteGuard));

  const saidaFalha = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/0009-fantasma.md');
  });
  const rFalha = spawnSync(process.execPath, [ALVO, '--dir', saidaFalha], { encoding: 'utf8', env: ENV_SEM_NPM });
  const stderrFalha = rFalha.stderr;
  // RN-10 evoluiu com o cabeamento (R4): "npm run adr:nova" agora EXISTE de verdade (package.json), então
  // o fix-hint passou a recomendá-lo — a regra permanece "nunca promete comando que não existe", só que
  // agora o comando existe. Os dois casos abaixo trocam de sinal em relação à versão pré-R4.
  check(
    'RN-10 (pós-R4): o fix-hint IMPRESSO aponta "npm run adr:nova" (agora real — cabeado no package.json)',
    /COMO PASSAR:.*npm run adr:nova/.test(stderrFalha.replace(/\n/g, ' ')),
  );
  check(
    'RN-10 (pós-R4): o fix-hint IMPRESSO também aponta o comando node puro (sem npm) como alternativa',
    /node scripts\/reservar-numero\.mjs/.test(stderrFalha),
  );
  check('este companion existe (é o próprio arquivo lido)', MEU_CAMINHO.endsWith('reserva-de-numero.mjs'));
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const guard = (dir) => spawnSync(process.execPath, [ALVO, '--dir', dir], { encoding: 'utf8', timeout: 60_000, env: ENV_SEM_NPM });

  selfTestJulgar(check);
  selfTestMedirBasico(check);
  selfTestPastasConhecidas(check, guard);
  selfTestFrontmatterEIntegridade(check, guard);
  selfTestSubpastaEJunction(check, guard);
  selfTestEstatico(check);

  const semDir = spawnSync(process.execPath, [ALVO, '--dir'], { encoding: 'utf8', env: ENV_SEM_NPM });
  check('PORTA: --dir sem caminho → exit 2', semDir.status === 2);
  check('PORTA: --dir inexistente → exit 2', guard(join(tmpdir(), 'rdn-nao-existe-de-verdade')).status === 2);
  const okDir = mkTree((d) => {
    put(d, 'governance/RESERVAS.json', cfg({ adr: ADR }));
    put(d, 'governance/adr/0001-primeiro.md');
    put(d, 'governance/reservas/adr/0001.md', res('0001', 'primeiro'));
  });
  check('PORTA: árvore válida (numerado + reserva batendo) → exit 0', guard(okDir).status === 0);

  process.exitCode = relatarSelfTest(NOME, casos);
}

selfTest();
