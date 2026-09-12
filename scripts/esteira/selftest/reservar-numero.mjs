/**
 * ─── COMPANION de self-test de ../reservar-numero.mjs ────────────────────────
 * POR QUE EM ARQUIVO SEPARADO: regra do coordenador — nenhum arquivo do kit passa de 600 LINHAS
 *   VISUAIS (soma por linha de max(1, ceil(len/160))); a suíte inteira (repo git real + DOIS worktrees
 *   reais + todos os casos) não cabia dentro do teto junto com a lógica. `../reservar-numero.mjs`
 *   continua sendo A PORTA: `--self-test` importa ESTE arquivo dinamicamente (`await import(...)`) e
 *   ele roda a suíte e seta `process.exitCode` ao ser importado — mesma saída, mesmo exit code de
 *   sempre. Este arquivo só IMPORTA funções puras/IO de `../reservar-numero.mjs` e `../lib/reservas.mjs`
 *   (nunca duplica lógica — LEI 11) e calcula o caminho do alvo a partir do PRÓPRIO `import.meta.url`
 *   (nunca de `process.argv`), pra continuar correto quando a prova-de-vida copia `scripts/` inteira pra
 *   um tmp e muta só a cópia do arquivo alvo — o companion, copiado junto, ainda acha o vizinho certo.
 *
 * COBERTURA (achados da auditoria adversarial, ADR-0004): RN-C6 (slug normalizado ao criar), RN-01
 *   (trava pelo VALOR canônico — largura mista não duplica), RN-03 (--liberar só da própria frente),
 *   RN-04 (--liberar exige dígitos e caminho contido), RN-05/F3 (dir absoluto/fora do repo → exit 2,
 *   nunca escreve fora), RN-08 (erro depois de travar devolve a trava), RN-09 (timestamp UTC com piso),
 *   RN-07 (frontmatter com BOM/aspas), e os mutantes C2/C3/C5/C7 do h-mut.mjs.
 *
 * CONTRA-PROVA: node scripts/reservar-numero.mjs --self-test
 * ───────────────────────────────────────────────────────────────────────────
 */
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, mkdtempSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { envSemGit } from '../lib/git-base.mjs';
import {
  formatarSequencial, timestampAtual, dataDoTimestamp, extrairNumeros, maiorNumero, numeroExiste,
  proximoNumeroTimestamp, proximoNumeroComTrava, slugLegivel, slugificar, normalizarSlug,
  preencherModelo, frontmatterReserva, parseFrontmatterReserva, valorCanonico, dentroDe,
  RE_NOME_NUMERADO,
} from '../lib/reservas.mjs';
import { tentarTravar } from '../reservar-numero.mjs';

const NOME = 'reservar-numero';
// o alvo é o VIZINHO deste arquivo — resolvido por import.meta.url, não por process.argv (sobrevive à
// cópia inteira de scripts/ que a prova-de-vida faz pra mutar só o alvo).
const ALVO = fileURLToPath(new URL('../reservar-numero.mjs', import.meta.url));

const TEMPLATE_ADR_FIXTURE = [
  '# ADR-0000 — <título curto da decisão, no imperativo>',
  '',
  '- **Status:** proposta',
  '- **Data:** AAAA-MM-DD',
  '- **Issue/PR:** #N',
  '',
  '## Contexto',
  'x',
  '',
  '## Decisão',
  'x',
  '',
  '## Consequências',
  'x',
  '',
].join('\n');

function configFixture() {
  return {
    _doc: 'fixture de self-test',
    tipos: {
      adr: {
        dir: 'governance/adr', padrao: 'sequencial', largura: 4,
        criarDoModelo: 'governance/adr/0000-template.md',
      },
      doc: { dir: 'docs/registro', padrao: 'sequencial', largura: 3 },
      migration: { dir: null, padrao: 'timestamp', largura: 4 },
    },
  };
}

/** repo git REAL com DOIS worktrees reais (git worktree add) — a contra-prova da trava compartilhada. */
function repoComWorktrees(config = configFixture()) {
  const base = mkdtempSync(join(tmpdir(), 'rn-self-'));
  const repo = join(base, 'origem');
  mkdirSync(repo, { recursive: true });
  const g = (args, cwd = repo) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: envSemGit(),
  });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  g(['config', 'core.autocrlf', 'false']);
  mkdirSync(join(repo, 'governance', 'adr'), { recursive: true });
  writeFileSync(join(repo, 'governance', 'adr', '0000-template.md'), TEMPLATE_ADR_FIXTURE);
  writeFileSync(join(repo, 'governance', 'RESERVAS.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(repo, 'README.md'), 'x\n');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'base']);
  const wtA = join(base, 'wt-a');
  const wtB = join(base, 'wt-b');
  g(['worktree', 'add', '-q', wtA, '-b', 'frente-a']);
  g(['worktree', 'add', '-q', wtB, '-b', 'frente-b']);
  return { base, repo, wtA, wtB, g };
}

function limparRepoComWorktrees({ base, wtA, wtB, g }) {
  // sequência robusta no Windows (memória: remove pode falhar por lock) — remove → rmSync → prune.
  for (const wt of [wtA, wtB]) {
    try { g(['worktree', 'remove', '--force', wt]); } catch { /* ignora-de-proposito: rmSync cobre embaixo */ }
  }
  try { g(['worktree', 'prune']); } catch { /* ignora-de-proposito: melhor esforço */ }
  rmSync(base, { recursive: true, force: true });
}

function extrairNumeroReservado(stdout) {
  const m = /reservado: \S+\/(\S+)/.exec(String(stdout || ''));
  return m ? m[1] : null;
}

function selfTestFuncoesPuras(check) {
  check('formatarSequencial: 5 com largura 4 → "0005"', formatarSequencial(5, 4) === '0005');
  check('valorCanonico: "015" e "0015" → o MESMO valor ("15")', valorCanonico('015') === '15' && valorCanonico('0015') === '15');
  const dataFixa = new Date(Date.UTC(2026, 8, 11, 9, 5, 3));
  check('timestampAtual: usa UTC (não a hora local do processo)', timestampAtual(dataFixa) === '20260911090503');
  check('dataDoTimestamp: inverso de timestampAtual (ida e volta)', dataDoTimestamp(timestampAtual(dataFixa)).getTime() === dataFixa.getTime());
  const numerosDeItem = extrairNumeros(['0007', 'x'], /^(\d+)$/);
  check('extrairNumeros: casa "0007" → {7}', [...numerosDeItem].join(',') === '7');
  check('RE_NOME_NUMERADO: casa separador "_" (Supabase) — RN-C1', RE_NOME_NUMERADO.test('0001_init.sql'));
  check('RE_NOME_NUMERADO: extensão MAIÚSCULA ou ausente — RN-C2', RE_NOME_NUMERADO.test('0001-X.MD') && RE_NOME_NUMERADO.test('0001-pasta'));
  check('RE_NOME_NUMERADO: slug = até o 1º ponto ("0001_init.up.sql")', RE_NOME_NUMERADO.exec('0001_init.up.sql')[2] === 'init');
  const setsVazios = { dirNums: new Set(), reservaNums: new Set(), lockNums: new Set() };
  check('maiorNumero: vazio → 0', maiorNumero(setsVazios) === 0);
  const setsMistos = { dirNums: new Set([2]), reservaNums: new Set([5]), lockNums: new Set([3]) };
  check('maiorNumero: pega o maior das TRÊS fontes', maiorNumero(setsMistos) === 5);
  check('numeroExiste: bate em qualquer uma das três fontes', numeroExiste(3, { dirNums: new Set(), reservaNums: new Set(), lockNums: new Set([3]) }));
  check('BYPASS (VAZIO/NULO): numeroExiste com sets ausentes não explode e devolve false', numeroExiste(1, {}) === false);
  check('RN-09: proximoNumeroTimestamp livre → usa o "agora" como veio', proximoNumeroTimestamp(setsVazios, dataFixa) === timestampAtual(dataFixa));
  const proximoSegundo = new Date(dataFixa.getTime() + 1000);
  const setsOcupados = { ...setsVazios, lockNums: new Set([Number(timestampAtual(dataFixa))]) };
  check('proximoNumeroTimestamp: ocupado → +1s até achar livre', proximoNumeroTimestamp(setsOcupados, dataFixa) === timestampAtual(proximoSegundo));
  check('RN-09: PISO — maior existente no FUTURO → nunca devolve número menor que ele', (() => {
    const futuro = Number('29990101000000');
    const r = proximoNumeroTimestamp({ ...setsVazios, dirNums: new Set([futuro]) }, dataFixa);
    return Number(r) > futuro;
  })());
  check('slugLegivel: troca hífen por espaço e maiúscula a 1ª letra', slugLegivel('reserva-de-numero') === 'Reserva de numero');
  check('RN-C6: slugificar remove acento, baixa caixa, junta símbolos em "-"', slugificar('Café com Leite!! 2026') === 'cafe-com-leite-2026');
  check('RN-C6: slugificar de só-símbolos → "" (o chamador decide exit 2)', slugificar('???') === '');
  check('normalizarSlug: minúsculas e _ → -', normalizarSlug('Minha_Reserva') === 'minha-reserva');
  check('RN-07: parseFrontmatterReserva ignora BOM na frente do bloco', (() => {
    const texto = '\uFEFF' + frontmatterReserva({ numero: '0001', slug: 'x', branch: 'main', data: '2026-09-11', status: 'criado' });
    return parseFrontmatterReserva(texto)?.slug === 'x';
  })());
  check('RN-07: parseFrontmatterReserva tira aspas do valor (YAML válido)', (() => {
    const texto = '---\nnumero: 0001\nslug: "x"\nbranch: main\ndata: 2026-09-11\nstatus: criado\n---\n';
    return parseFrontmatterReserva(texto)?.slug === 'x';
  })());
  check('preencherModelo: ADR-0000 / título / data trocados', (() => {
    const s = preencherModelo(TEMPLATE_ADR_FIXTURE, { numeroFormatado: '0005', slug: 'exemplo-de-reserva', data: '2026-09-11' });
    return s.includes('ADR-0005') && !s.includes('ADR-0000') && s.includes('Exemplo de reserva') && s.includes('**Data:** 2026-09-11');
  })());
  check('frontmatterReserva/parseFrontmatterReserva: ida e volta', (() => {
    const fm = parseFrontmatterReserva(frontmatterReserva({ numero: '0005', slug: 'x', branch: 'main', data: '2026-09-11', status: 'criado' }));
    return fm?.numero === '0005' && fm?.status === 'criado' && fm?.slug === 'x';
  })());
  check('dentroDe: caminho FORA da pasta base (../fora) é rejeitado — RN-04/RN-05', !dentroDe(join(tmpdir(), 'fora'), join(tmpdir(), 'base', 'x')));

  check('BYPASS (EEXIST simulado): 1ª trava recusada → recoleta e PULA pro próximo', (() => {
    let chamadas = 0;
    const r = proximoNumeroComTrava({
      padrao: 'sequencial', largura: 4,
      coletar: () => (chamadas === 0 ? setsVazios : { ...setsVazios, lockNums: new Set([1]) }),
      travar: (cand) => { const ok = cand !== '0001'; chamadas++; return ok; },
    });
    return r === '0002' && chamadas === 2;
  })());
  check('trava sempre recusa → esgota maxTentativas e devolve null (nunca finge sucesso)', proximoNumeroComTrava({
    padrao: 'sequencial', largura: 4, coletar: () => setsVazios, travar: () => false, maxTentativas: 3,
  }) === null);
}

function selfTestTrava(check) {
  const lockDirTest = mkdtempSync(join(tmpdir(), 'rn-lock-'));
  try {
    check('tentarTravar: 1ª trava do número → sucesso (arquivo criado)', tentarTravar(lockDirTest, '0001') === true);
    check('BYPASS (EEXIST real): travar o MESMO número de novo → false', tentarTravar(lockDirTest, '0001') === false);
    check('RN-01: trava por VALOR canônico — "015" e "0015" colidem (mesmo arquivo de trava)', (() => {
      const primeira = tentarTravar(lockDirTest, '015');
      const segunda = tentarTravar(lockDirTest, '0015');
      return primeira === true && segunda === false;
    })());
  } finally { rmSync(lockDirTest, { recursive: true, force: true }); }
}

function selfTestPortaBasica(check, porta) {
  const semConfig = mkdtempSync(join(tmpdir(), 'rn-semcfg-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: semConfig, env: envSemGit() });
    check('PORTA: governance/RESERVAS.json ausente → exit 2', porta(['adr', 'x'], semConfig).status === 2);
  } finally { rmSync(semConfig, { recursive: true, force: true }); }
}

function selfTestF3ForaDoRepo(check, porta) {
  // RN-05/F3: "dir": "../fora" — CLI nunca escreve fora do repo; recusa com exit 2.
  const base = mkdtempSync(join(tmpdir(), 'rn-f3-'));
  try {
    const repo = join(base, 'origem');
    mkdirSync(join(repo, 'governance'), { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env: envSemGit() });
    writeFileSync(join(repo, 'governance', 'RESERVAS.json'), JSON.stringify({
      tipos: { nota: { dir: '../fora', padrao: 'sequencial', largura: 4 } },
    }));
    const r = porta(['nota', 'vazou'], repo);
    check('RN-05/F3: "dir": "../fora" → exit 2 (NÃO MEDIU, nunca escreve)', r.status === 2);
    check('RN-05/F3: nada foi escrito fora do repo', !existsSync(join(base, 'fora')));
  } finally { rmSync(base, { recursive: true, force: true }); }
}

function selfTestRN08TravaVaza(check, porta) {
  // RN-08: criarDoModelo aponta pra molde inexistente — validação ANTES de travar: 3 tentativas
  // seguidas não deixam NENHUMA trava presa, e a 1ª reserva válida depois pega o número 1 (não pulou).
  const base = mkdtempSync(join(tmpdir(), 'rn-08-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: base, env: envSemGit() });
    mkdirSync(join(base, 'governance', 'adr'), { recursive: true });
    writeFileSync(join(base, 'governance', 'RESERVAS.json'), JSON.stringify({
      tipos: { adr: { dir: 'governance/adr', padrao: 'sequencial', largura: 4, criarDoModelo: 'governance/adr/NAO-EXISTE.md' } },
    }));
    for (let i = 0; i < 3; i++) check(`RN-08: tentativa ${i + 1} com molde ausente → exit 2 (não trava)`, porta(['adr', 'x'], base).status === 2);
    const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: base, encoding: 'utf8', env: envSemGit() }).trim();
    const lockDirAdr = join(commonDir, 'esteira-reservas', 'adr');
    check('RN-08: nenhuma trava sobrou das tentativas frustradas', !existsSync(lockDirAdr) || readdirSync(lockDirAdr).length === 0);
    // conserta o CONFIG (aponta pro molde real) e reserva de verdade — tem que pegar o número 1
    writeFileSync(join(base, 'governance', 'adr', '0000-template.md'), TEMPLATE_ADR_FIXTURE);
    writeFileSync(join(base, 'governance', 'RESERVAS.json'), JSON.stringify({
      tipos: { adr: { dir: 'governance/adr', padrao: 'sequencial', largura: 4, criarDoModelo: 'governance/adr/0000-template.md' } },
    }));
    const ok = porta(['adr', 'primeira-de-verdade'], base);
    check('RN-08: depois de consertar, a reserva pega 0001 (nenhum número foi queimado)', extrairNumeroReservado(ok.stdout) === '0001');
  } finally { rmSync(base, { recursive: true, force: true }); }
}

function selfTestRepoComWorktrees(check, porta) {
  let rw;
  try {
    rw = repoComWorktrees();
    const { wtA, wtB } = rw;

    check('PORTA: tipo desconhecido → exit 2', porta(['nao-existe', 'x'], wtA).status === 2);
    check('PORTA: tipo desligado (migration, dir:null) → exit 2', porta(['migration', 'x'], wtA).status === 2);

    const r1 = porta(['adr', 'primeira-reserva'], wtA);
    const r2 = porta(['adr', 'segunda-reserva'], wtA);
    const num1 = extrairNumeroReservado(r1.stdout);
    const num2 = extrairNumeroReservado(r2.stdout);
    check('duas reservas seguidas (mesma worktree) dão números diferentes', r1.status === 0 && r2.status === 0 && num1 !== num2);
    check('a numeração é crescente', Number(num1) < Number(num2));

    const r3 = porta(['adr', 'terceira-reserva'], wtB);
    const num3 = extrairNumeroReservado(r3.stdout);
    check('reserva feita no worktree A é vista pelo worktree B (trava compartilhada)', r3.status === 0 && Number(num3) > Number(num2));

    const linhasR1 = String(r1.stdout || '').trim().split('\n');
    const arquivoCriado = linhasR1[linhasR1.length - 1];
    const conteudoCriado = readFileSync(join(wtA, arquivoCriado), 'utf8');
    check('criarDoModelo: número preenchido (sem sobrar ADR-0000)', conteudoCriado.includes(`ADR-${num1}`) && !conteudoCriado.includes('ADR-0000'));
    check('criarDoModelo: título preenchido a partir do slug', conteudoCriado.includes('Primeira reserva'));
    check('mutante C7 (h-mut.mjs): status vira "criado" quando cria arquivo (não fica "reservado")', (() => {
      const fm = parseFrontmatterReserva(readFileSync(join(wtA, 'governance', 'reservas', 'adr', `${num1}.md`), 'utf8'));
      return fm?.status === 'criado';
    })());

    const liberaBloqueado = porta(['--liberar', 'adr', num1], wtA);
    check('--liberar RECUSA quando o arquivo numerado já existe → exit 1', liberaBloqueado.status === 1);
    check('--liberar recusado NÃO apaga a reserva', readdirSync(join(wtA, 'governance', 'reservas', 'adr')).includes(`${num1}.md`));

    const rDoc = porta(['doc', 'nota-solta'], wtA);
    const numeroDoc = extrairNumeroReservado(rDoc.stdout);
    check('reserva "doc" (sem criarDoModelo) não cria arquivo numerado, status "reservado"', (() => {
      const fm = parseFrontmatterReserva(readFileSync(join(wtA, 'governance', 'reservas', 'doc', `${numeroDoc}.md`), 'utf8'));
      return rDoc.status === 0 && fm?.status === 'reservado';
    })());

    check('RN-04: --liberar com número NÃO-dígitos (path traversal) → exit 2, nada apagado', (() => {
      const alvo = join(wtA, 'CHANGELOG-fixture.md');
      writeFileSync(alvo, 'historia\n');
      const r = porta(['--liberar', 'doc', '../../../CHANGELOG-fixture'], wtA);
      const sobrou = existsSync(alvo);
      rmSync(alvo, { force: true });
      return r.status === 2 && sobrou;
    })());

    check('RN-03: a frente B NÃO consegue liberar o número reservado pela frente A → exit 1, nada some', (() => {
      const antes = existsSync(join(wtA, 'governance', 'reservas', 'doc', `${numeroDoc}.md`));
      const r = porta(['--liberar', 'doc', numeroDoc], wtB);
      const depois = existsSync(join(wtA, 'governance', 'reservas', 'doc', `${numeroDoc}.md`));
      return antes && r.status === 1 && depois;
    })());

    const liberaOk = porta(['--liberar', 'doc', numeroDoc], wtA);
    check('--liberar dá certo quando é a própria frente e não há arquivo numerado → exit 0', liberaOk.status === 0);
    check('--liberar de verdade remove a reserva versionada', !existsSync(join(wtA, 'governance', 'reservas', 'doc', `${numeroDoc}.md`)));
    check('mutante C3 (h-mut.mjs): --liberar TAMBÉM remove a trava local (não só a reserva)', (() => {
      const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { cwd: wtA, encoding: 'utf8', env: envSemGit() }).trim();
      return !existsSync(join(commonDir, 'esteira-reservas', 'doc', String(Number(numeroDoc))));
    })());

    const lst = porta(['--listar', 'adr'], wtA);
    check('--listar imprime as reservas do tipo', lst.status === 0 && /primeira-reserva/.test(lst.stdout));

    check('RN-C6: slug com acento/maiúscula é normalizado ao criar o arquivo', (() => {
      const r = porta(['adr', 'Decisão Número Ímpar'], wtA);
      const linhas = String(r.stdout || '').trim().split('\n');
      const criado = linhas[linhas.length - 1];
      return r.status === 0 && /decisao-numero-impar\.md$/.test(criado);
    })());
    check('RN-C6: slug que normaliza pra "" → exit 2 (nunca grava slug vazio)', porta(['adr', '???'], wtA).status === 2);
    check('slug com barra é recusado ANTES de normalizar (mutante C5)', porta(['adr', 'a/b'], wtA).status === 2);

    check('RN-09/C2: tipo "timestamp" devolve 14 dígitos (padrão não é ignorado)', (() => {
      const cfgPath = join(wtB, 'governance', 'RESERVAS.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      cfg.tipos.migration = { dir: 'migrations', padrao: 'timestamp', largura: 4 };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      mkdirSync(join(wtB, 'migrations'), { recursive: true });
      const r = porta(['migration', 'nova-migration'], wtB);
      const num = extrairNumeroReservado(r.stdout);
      return r.status === 0 && /^\d{14}$/.test(num);
    })());
  } finally { if (rw) limparRepoComWorktrees(rw); }
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });
  const porta = (args, cwd) => spawnSync(process.execPath, [ALVO, ...args], {
    cwd, encoding: 'utf8', timeout: 60_000, env: { ...envSemGit(), npm_lifecycle_event: '' },
  });

  selfTestFuncoesPuras(check);
  selfTestTrava(check);
  selfTestPortaBasica(check, porta);
  selfTestF3ForaDoRepo(check, porta);
  selfTestRN08TravaVaza(check, porta);
  selfTestRepoComWorktrees(check, porta);

  process.exitCode = relatarSelfTest(NOME, casos);
}

selfTest();
