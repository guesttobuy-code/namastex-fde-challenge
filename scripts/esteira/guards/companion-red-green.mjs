#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: teste escrito DEPOIS do conserto nasce verde e nunca provou nada. Na esteira de
 *   origem, 28 de 48 companions ficavam verdes com o código de ANTES do fix — "tem teste" era
 *   fachada. A pergunta certa não é "o teste passa?", é "o teste ficaria VERMELHO se o conserto
 *   não existisse?". Este guard faz a pergunta por máquina.
 *
 * O QUE FAZ: acha os testes (`*.test.mjs|*.test.js`) e as fontes que o diff contra a base toca;
 *   cria uma worktree descartável NA BASE, copia para lá a versão HEAD dos testes tocados, roda
 *   `node --test` neles (esperado: FALHA — o teste morde a base); depois roda os mesmos testes no
 *   HEAD (esperado: PASSA). Só `PROVOU_O_FIX` sai 0.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. teste que passa na base (`NAO_MORDE_A_BASE`) — não distingue antes de depois;
 *   2. teste que falha no HEAD (`VERMELHO_NO_HEAD`) — o conserto não está pronto;
 *   3. "não consegui montar a réplica" saindo como 0 — é exit 2 (NÃO MEDIU).
 *
 * LIMITE CONHECIDO: (a) só julga quando o diff tem teste E fonte — diff só de doc/config sai
 *   `NAO_APLICAVEL` (0); a existência do teste do item 4 do PLANO é do `plano-na-issue` e do
 *   auditor; (b) roda `node --test` — projeto com outro runner declara `--cmd "<comando>"`;
 *   (c) não sabe se o teste exercita a fonte alterada (pode morder por outro motivo) — o auditor
 *   confere no passo 4; (d) Windows trava pasta com cwd dentro: a réplica é removida com --force e
 *   o resto fica para o varredor; (e) CÓDIGO PYTHON (R6, 2026-09-11) — em projeto com "stack":"python"
 *   em esteira.json, reconhece teste Python (convenção de lib/python-test.mjs) e roda
 *   `<python> -m pytest -q <arquivo>` (resolução de lib/python-runtime.mjs); `--cmd` explícito continua
 *   tendo prioridade sobre qualquer stack. Python/pytest AUSENTE nunca vira verde por omissão: o estado
 *   `FERRAMENTA_AUSENTE` sai NÃO MEDIU (exit 2) com a dica de instalação — nunca 0/1 sem a ferramenta real;
 *   (f) ADAPTAÇÃO LOCAL (frente `fundacao-python`, 2026-09-12, issue #4): a réplica na base é um
 *   `git worktree add` a partir do merge-base — não carrega nada fora do que o git rastreia, então
 *   `.venv` (gitignored) nunca existia lá, e `resolverPython(replica)` caía pro Python do sistema (sem
 *   ruff/pytest, por decisão do dono de não instalar nada global). Todo PR Python com teste+fonte no
 *   diff saía `FERRAMENTA_AUSENTE` sempre, mesmo com o `.venv` do repo real instalado e funcionando —
 *   guard que não consegue medir não é limite, é guard morto. Corrigido com o MESMO padrão que já
 *   existe para `node_modules` linhas abaixo: `mklink /J .venv` pra dentro da réplica, só quando
 *   `.venv` existe no repo e não existe na réplica — nenhum comportamento novo pra JS/TS. LIMITE
 *   DECLARADO: a réplica passa a compartilhar o mesmo `.venv` do repositório real, não um isolado —
 *   aceitável porque o teste só LÊ o venv (não instala/desinstala nada nele). Reportado ao kit
 *   (`projeto-base`) pela coordenação; não reverter sem consultar.
 *
 * CONTRA-PROVA: `node guards/companion-red-green.mjs --self-test` — monta um repo temporário real
 *   com fonte quebrada → conserto + teste, e prova PROVOU_O_FIX; depois um teste que passa na base
 *   e prova NAO_MORDE_A_BASE; e um teste quebrado no HEAD → VERMELHO_NO_HEAD.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from '../lib/guard-doctrine.mjs';
import { stackDoProjeto } from '../lib/stack.mjs';
import { resolverPython } from '../lib/python-runtime.mjs';
import { RE_TESTE_PY, RE_FONTE_PY } from '../lib/python-test.mjs';

const NOME = 'companion-red-green';
export const R = Object.freeze({
  PROVOU_O_FIX: 'PROVOU_O_FIX', NAO_MORDE_A_BASE: 'NAO_MORDE_A_BASE', VERMELHO_NO_HEAD: 'VERMELHO_NO_HEAD',
  NAO_APLICAVEL: 'NAO_APLICAVEL',
  // R6 (2026-09-11): python sem ruff/pytest instalado — NÃO MEDIU explícito, NUNCA verde por ferramenta ausente.
  FERRAMENTA_AUSENTE: 'FERRAMENTA_AUSENTE',
});
const RE_TESTE = /\.(test|spec)\.(mjs|cjs|js|ts)$/i;
const RE_FONTE = /\.(mjs|cjs|js|ts|tsx|jsx|mts|cts)$/i;

// Dentro de um hook do git (pre-commit), o git exporta GIT_DIR/GIT_INDEX_FILE/GIT_PREFIX para os filhos —
// e o repo TEMPORÁRIO do self-test passa a operar no repo do hook (medido em 2026-09-10: self-test
// verde por fora, vermelho dentro do `git commit`). Todo `git` que este guard spawna vai com env limpo.
export const envSemGit = (base = process.env) => Object.fromEntries(Object.entries(base).filter(([k]) => !/^GIT_/i.test(k)));
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], env: envSemGit() }).trim();

/** FUNÇÃO PURA: a decisão, dado o que aconteceu nas duas rodadas. */
export function julgar({ testes = [], fontes = [], vermelhoNaBase = null, verdeNoHead = null } = {}) {
  if (testes.length === 0 || fontes.length === 0) return { estado: R.NAO_APLICAVEL, motivo: testes.length === 0 ? 'nenhum teste no diff — nada a provar aqui (a existência do teste do item 4 é do plano-na-issue e do auditor)' : 'só testes no diff, nenhuma fonte — não há conserto a morder' };
  if (vermelhoNaBase === false) return { estado: R.NAO_MORDE_A_BASE, motivo: 'o(s) teste(s) PASSAM contra a base — não distinguem antes de depois; reescreva o teste (nunca o veredito)' };
  if (verdeNoHead === false) return { estado: R.VERMELHO_NO_HEAD, motivo: 'o(s) teste(s) FALHAM no HEAD — o conserto não está pronto (ou o teste está errado)' };
  return { estado: R.PROVOU_O_FIX, motivo: 'vermelho contra a base, verde no HEAD — o teste morde' };
}

// R6 (2026-09-11): `stackPython` reconhece a convenção Python (RE_TESTE_PY/RE_FONTE_PY, dono único em
// lib/python-test.mjs) SÓ quando o projeto está declarado "stack":"python" em esteira.json — um .py
// avulso num projeto node (script de deploy, por exemplo) não vira "teste" por acidente.
function classificarDiff(arquivos, stackPython) {
  const ehTestePy = (a) => stackPython && RE_TESTE_PY.test(a);
  const ehFontePy = (a) => stackPython && RE_FONTE_PY.test(a) && !RE_TESTE_PY.test(a);
  const testes = arquivos.filter((a) => RE_TESTE.test(a) || ehTestePy(a));
  const fontes = arquivos.filter((a) => (RE_FONTE.test(a) && !RE_TESTE.test(a)) || ehFontePy(a));
  return { testes, fontes };
}

/** Roda `arquivos` em `cwd`. `--cmd` explícito sempre vence (qualquer stack). Sem `--cmd`: projeto python
 *  roda `<python> -m pytest -q <arquivos>` (resolução do Python em lib/python-runtime.mjs — dono único,
 *  MESMA ordem do scripts/python-check.mjs); projeto node roda `node --test` (comportamento de sempre).
 *  Python/pytest AUSENTE devolve `ferramentaAusente: true` — NUNCA `ok` (nem true nem false): sem
 *  ferramenta real não há como afirmar vermelho NEM verde (LEI DO NÃO-CHUTE). `resolver` é INJETÁVEL
 *  (Parte 3 do COMO-CRIAR-GUARD): em produção é `resolverPython`; o self-test injeta um fake pra provar
 *  o ramo "python ausente" sem depender de a máquina ter ou não Python de verdade. */
function rodarTestes(cwd, arquivos, cmd, stackPython, resolver = resolverPython) {
  if (cmd) {
    const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: 600_000, env: envSemGit() });
    return { ok: r.status === 0, saida: ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-6).join('\n') };
  }
  // Adaptação local (2026-09-11): rotear POR EXTENSÃO, não só pela stack do projeto. Este repositório é
  // Python, mas a própria esteira traz um teste Node (tests/esteira.test.mjs). Mandar um `.mjs` para o
  // pytest fazia ele coletar zero testes e sair 4 — que o guard traduzia como "pytest não instalado",
  // mandando instalar uma ferramenta que não faltava. Agora: `.py` vai para o pytest; o resto, para o
  // `node --test`. Reportado ao kit.
  const arquivosPy = arquivos.filter((a) => /\.py$/i.test(a));
  if (stackPython && arquivosPy.length) {
    const py = resolver(cwd);
    if (!py) {
      return { ferramentaAusente: true, saida: 'python não encontrado (.venv/Scripts, .venv/bin, python, py -3) — instale Python 3.' };
    }
    const r = spawnSync(py.cmd, [...py.args, '-m', 'pytest', '-q', ...arquivosPy], { cwd, encoding: 'utf8', timeout: 600_000, env: envSemGit() });
    const saidaBruta = (r.stdout || '') + (r.stderr || '');
    if (r.error || /No module named pytest/i.test(saidaBruta)) {
      return { ferramentaAusente: true, saida: `pytest não está instalado nesse Python — rode: ${py.cmd} -m pip install pytest` };
    }
    // Teste que não é .py no mesmo diff NÃO pode ser pulado em silêncio: roda no node e os dois contam.
    const outros = arquivos.filter((a) => !/\.py$/i.test(a));
    if (!outros.length) return { ok: r.status === 0, saida: saidaBruta.trim().split('\n').slice(-6).join('\n') };
    const rn = spawnSync(process.execPath, ['--test', ...outros], { cwd, encoding: 'utf8', timeout: 600_000, env: envSemGit() });
    const saidaNode = ((rn.stdout || '') + (rn.stderr || '')).trim().split('\n').slice(-4).join('\n');
    return { ok: r.status === 0 && rn.status === 0, saida: `${saidaBruta.trim().split('\n').slice(-4).join('\n')}\n${saidaNode}` };
  }
  const r = spawnSync(process.execPath, ['--test', ...arquivos], { cwd, encoding: 'utf8', timeout: 600_000, env: envSemGit() });
  return { ok: r.status === 0, saida: ((r.stdout || '') + (r.stderr || '')).trim().split('\n').slice(-6).join('\n') };
}

/** ADAPTAÇÃO LOCAL (issue #4, 2026-09-12): mesmo padrão do `node_modules` (linha acima, em `medir`),
 *  agora para o `.venv` — sem ele, `resolverPython(replica)` nunca acha ruff/pytest (o `.venv` é
 *  gitignored, a réplica é um `git worktree add` limpo) e todo PR Python com teste+fonte no diff saía
 *  `FERRAMENTA_AUSENTE` sempre, mesmo com o `.venv` do repo real instalado e funcionando. Réplica passa
 *  a compartilhar o MESMO `.venv` do repositório real (limite declarado na certidão do topo do arquivo)
 *  — aceitável porque o teste só LÊ o venv. Extraída como função à parte (BANCA SUBSTITUIR/testar sem
 *  precisar de Python de verdade instalado — só dois diretórios quaisquer e um arquivo-marcador). */
function linkarVenvNaReplica(repo, replica) {
  const venv = join(repo, '.venv');
  if (existsSync(venv) && !existsSync(join(replica, '.venv'))) {
    try { execFileSync('cmd', ['/c', 'mklink', '/J', join(replica, '.venv'), venv], { stdio: 'ignore' }); } catch { /* ignora-de-proposito: sem junction: cai pro python/py do sistema */ }
  }
}

/**
 * Mede de verdade: diff base...HEAD (+ index), réplica na base com os testes do HEAD, duas rodadas.
 * @returns {{estado, motivo, testes, fontes, saidaBase?, saidaHead?}}
 */
export function medir({ repo, base, cmd = null, incluirIndex = true } = {}) {
  const stackPython = stackDoProjeto(repo) === 'python'; // esteira.json inválido LANÇA → main() trata como NÃO MEDIU
  const mergeBase = git(['merge-base', base, 'HEAD'], repo);
  const doCommit = git(['diff', '--name-only', `${mergeBase}..HEAD`], repo).split('\n').filter(Boolean);
  const doIndex = incluirIndex ? git(['diff', '--name-only', '--cached'], repo).split('\n').filter(Boolean) : [];
  const arquivos = [...new Set([...doCommit, ...doIndex])];
  const { testes, fontes } = classificarDiff(arquivos, stackPython);
  if (testes.length === 0 || fontes.length === 0) return { ...julgar({ testes, fontes }), testes, fontes };

  const replica = mkdtempSync(join(tmpdir(), 'crg-'));
  try {
    git(['worktree', 'add', '--detach', replica, mergeBase], repo);
    const nm = join(repo, 'node_modules');
    if (existsSync(nm) && !existsSync(join(replica, 'node_modules'))) {
      try { execFileSync('cmd', ['/c', 'mklink', '/J', join(replica, 'node_modules'), nm], { stdio: 'ignore' }); } catch { /* ignora-de-proposito: sem junction: o teste roda sem deps */ }
    }
    linkarVenvNaReplica(repo, replica);
    for (const t of testes) {
      const destino = join(replica, t);
      mkdirSync(dirname(destino), { recursive: true });
      if (existsSync(join(repo, t))) copyFileSync(join(repo, t), destino);
    }
    const naBase = rodarTestes(replica, testes, cmd, stackPython);
    if (naBase.ferramentaAusente) return { estado: R.FERRAMENTA_AUSENTE, motivo: naBase.saida, testes, fontes };
    const noHead = rodarTestes(repo, testes, cmd, stackPython);
    if (noHead.ferramentaAusente) return { estado: R.FERRAMENTA_AUSENTE, motivo: noHead.saida, testes, fontes };
    const r = julgar({ testes, fontes, vermelhoNaBase: !naBase.ok, verdeNoHead: noHead.ok });
    return { ...r, testes, fontes, saidaBase: naBase.saida, saidaHead: noHead.saida };
  } finally {
    // remove → apaga o que sobrou → prune: se o remove falhar (lock do Windows), o prune
    // desregistra a réplica assim que a pasta some. Nunca fica worktree fantasma.
    try { git(['worktree', 'remove', '--force', replica], repo); } catch { /* ignora-de-proposito: segue para o rm + prune */ }
    try { rmSync(replica, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock do Windows */ }
    try { git(['worktree', 'prune'], repo); } catch { /* ignora-de-proposito: best-effort */ }
  }
}

async function baseDoProjeto() {
  try { const { getEsteira } = await import('../lib/esteira.mjs'); const c = getEsteira(process.cwd()); return `${c.remote}/${c.branchBase}`; } catch { return null; }
}

async function main() {
  const argv = process.argv.slice(2);
  const valor = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const base = valor('--base') || (await baseDoProjeto());
  const cmd = valor('--cmd') || null;
  if (!base) { console.error(`[${NOME}] NÃO MEDIU: informe --base <remote>/<branch> (ou rode num projeto com esteira.json).`); process.exitCode = 2; return; }
  let repo;
  try { repo = git(['rev-parse', '--show-toplevel'], process.cwd()); } catch { console.error(`[${NOME}] NÃO MEDIU: não estou num repositório git.`); process.exitCode = 2; return; }
  // Repo sem nenhum commit (o PRIMEIRO commit de um projeto recém-nascido): não há "antes" para morder.
  // Sem isto o pre-commit bloqueava o commit inicial de todo projeto do bootstrap (medido, issue #15).
  try { git(['rev-parse', '--verify', 'HEAD'], repo); } catch { console.log(`[${NOME}] NAO_APLICAVEL: repositório ainda sem commit — não há base para comparar (primeiro commit).`); process.exitCode = 0; return; }
  try { git(['rev-parse', '--verify', base], repo); } catch { console.error(`[${NOME}] NÃO MEDIU: a base "${base}" não existe — git fetch primeiro.`); process.exitCode = 2; return; }

  let r;
  try { r = medir({ repo, base, cmd }); }
  catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; return; }

  console.log(`[${NOME}] base ${base} · ${r.testes.length} teste(s) · ${r.fontes.length} fonte(s) no diff`);
  if (r.testes.length) console.log(`   testes: ${r.testes.join(', ')}`);
  if (r.saidaBase !== undefined) { console.log(`   --- na base ---\n${r.saidaBase}`); console.log(`   --- no HEAD ---\n${r.saidaHead}`); }
  if (r.estado === R.FERRAMENTA_AUSENTE) {
    console.error(`[${NOME}] NÃO MEDIU: ${r.motivo}`);
    console.error('   sem a ferramenta real, este guard não afirma vermelho NEM verde (LEI DO NÃO-CHUTE).');
    process.exitCode = 2;
    return;
  }
  const ok = r.estado === R.PROVOU_O_FIX || r.estado === R.NAO_APLICAVEL;
  console.log(`[${NOME}] ${ok ? '✅' : '❌'} ${r.estado}: ${r.motivo}`);
  if (!ok) {
    console.error('   FIX-HINT: o teste do item 4 do PLANO tem que ficar VERMELHO com o código de antes e VERDE com o de agora.');
    console.error('   NAO_MORDE_A_BASE → o teste não exercita o comportamento consertado: reescreva o teste, nunca o veredito.');
    console.error('   VERMELHO_NO_HEAD → o conserto não está pronto, ou o teste espera outra coisa.');
  }
  process.exitCode = ok ? 0 : 1;
}

// ─── contra-prova com repo REAL ──────────────────────────────────────────────
function repoTemporario() {
  const dir = mkdtempSync(join(tmpdir(), 'crg-self-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  mkdirSync(join(dir, 'src')); mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'src', 'soma.mjs'), 'export const soma = (a, b) => a - b; // bug\n');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base com bug']);
  g(['branch', 'base']);
  return { dir, g };
}

// R6 (2026-09-11): repo temporário Python — fonte + teste + esteira.json declarando "stack":"python".
// `fonteBaseConteudo` decide se o FAKE pytest (self-test, ver `PYTEST_FAKE_FONTE` abaixo) vê o marcador
// `BUG_AQUI` em src/soma.py (vermelho) ou não (verde) — o fake lê o CWD (replica=base / repo=HEAD), não
// o conteúdo do teste: é a mesma semântica de um pytest de verdade (o teste HEAD roda contra a fonte de
// cada lado — vermelho-na-base/verde-no-head depende da FONTE, não do texto do teste).
function repoTemporarioPython(testeBaseConteudo, fonteBaseConteudo = 'def soma(a, b):\n    return a - b  # BUG_AQUI\n') {
  const dir = mkdtempSync(join(tmpdir(), 'crg-py-self-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', env: envSemGit() });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'src', 'soma.py'), fonteBaseConteudo);
  writeFileSync(join(dir, 'tests', 'test_soma.py'), testeBaseConteudo);
  writeFileSync(join(dir, 'esteira.json'), JSON.stringify({ stack: 'python' }));
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
  g(['branch', 'base']);
  return { dir, g, teste: join(dir, 'tests', 'test_soma.py'), fonte: join(dir, 'src', 'soma.py') };
}

// Módulo `pytest.py` FALSO (não é pytest de verdade — esta máquina não tem pytest instalado, ver nota do
// coordenador): `python -m pytest` importa o PRIMEIRO módulo chamado "pytest" que achar em sys.path; com
// este arquivo na frente via PYTHONPATH, `-m pytest` roda ESTE código em vez de procurar o pacote real.
// Ele IGNORA os argumentos (os caminhos de teste) e olha `src/soma.py` relativo ao CWD — que É a réplica
// da BASE numa rodada e o repo no HEAD na outra (a mesma distinção que o mecanismo real usa: o teste do
// HEAD roda contra a fonte de cada lado) — decidindo vermelho (exit 1) se a fonte contém `BUG_AQUI`,
// verde (exit 0) senão. Prova a mecânica vermelho-na-base/verde-no-head sem depender de pytest instalado.
const PYTEST_FAKE_FONTE = [
  'import sys',
  'def main():',
  '    vermelho = False',
  '    try:',
  '        with open("src/soma.py", encoding="utf-8") as f:',
  '            if "BUG_AQUI" in f.read():',
  '                vermelho = True',
  '    except OSError:',
  '        pass',
  '    sys.exit(1 if vermelho else 0)',
  'if __name__ == "__main__":',
  '    main()',
  '',
].join('\n');

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // decisão pura
  check('julgar: vermelho na base + verde no HEAD → PROVOU_O_FIX', julgar({ testes: ['t'], fontes: ['f'], vermelhoNaBase: true, verdeNoHead: true }).estado === R.PROVOU_O_FIX);
  check('BYPASS: teste que passa na base → NAO_MORDE_A_BASE (mesmo verde no HEAD)', julgar({ testes: ['t'], fontes: ['f'], vermelhoNaBase: false, verdeNoHead: true }).estado === R.NAO_MORDE_A_BASE);
  check('BYPASS: teste vermelho no HEAD → VERMELHO_NO_HEAD', julgar({ testes: ['t'], fontes: ['f'], vermelhoNaBase: true, verdeNoHead: false }).estado === R.VERMELHO_NO_HEAD);
  check('sem teste no diff → NAO_APLICAVEL', julgar({ testes: [], fontes: ['f'] }).estado === R.NAO_APLICAVEL);
  check('só teste no diff → NAO_APLICAVEL', julgar({ testes: ['t'], fontes: [] }).estado === R.NAO_APLICAVEL);

  // repo real — o incidente: conserto + teste que MORDE
  let t;
  try {
    t = repoTemporario();
    const { dir, g } = t;
    writeFileSync(join(dir, 'src', 'soma.mjs'), 'export const soma = (a, b) => a + b;\n');
    writeFileSync(join(dir, 'tests', 'soma.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { soma } from '../src/soma.mjs'; test('soma', () => assert.equal(soma(2, 3), 5));\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'fix + companion']);
    const r1 = medir({ repo: dir, base: 'base' });
    check('REPO REAL: conserto + teste que morde → PROVOU_O_FIX', r1.estado === R.PROVOU_O_FIX);
    check('REPO REAL: classificou 1 teste e 1 fonte', r1.testes.length === 1 && r1.fontes.length === 1);
    // PORTA (issue #17): o guard como processo, exit code cobrado
    const porta = (cwd, args) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { cwd, encoding: 'utf8', timeout: 120_000, env: { ...envSemGit(), npm_lifecycle_event: '' } }).status;
    check('PORTA: PROVOU_O_FIX → exit 0', porta(dir, ['--base', 'base']) === 0);
    check('PORTA: fora de repositório git → exit 2', porta(tmpdir(), ['--base', 'base']) === 2);
    check('PORTA: base inexistente → exit 2', porta(dir, ['--base', 'nao-existe']) === 2);

    // BYPASS: teste que não exercita o conserto (passa na base também)
    writeFileSync(join(dir, 'tests', 'soma.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { soma } from '../src/soma.mjs'; test('trivial', () => assert.equal(typeof soma, 'function'));\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'teste que nao morde']);
    check('BYPASS REPO REAL: teste que passa na base → NAO_MORDE_A_BASE', medir({ repo: dir, base: 'base' }).estado === R.NAO_MORDE_A_BASE);
    check('PORTA: NAO_MORDE_A_BASE → exit 1', porta(dir, ['--base', 'base']) === 1);

    // VERMELHO_NO_HEAD: teste espera outra coisa
    writeFileSync(join(dir, 'tests', 'soma.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { soma } from '../src/soma.mjs'; test('errado', () => assert.equal(soma(2, 3), 6));\n");
    g(['add', '-A']); g(['commit', '-q', '-m', 'teste errado']);
    check('REPO REAL: teste vermelho no HEAD → VERMELHO_NO_HEAD', medir({ repo: dir, base: 'base' }).estado === R.VERMELHO_NO_HEAD);

    // NAO_APLICAVEL: só doc
    g(['checkout', '-q', 'base']); g(['checkout', '-q', '-b', 'doc']);
    writeFileSync(join(dir, 'README.md'), 'y\n'); g(['add', '-A']); g(['commit', '-q', '-m', 'doc']);
    check('REPO REAL: diff só de doc → NAO_APLICAVEL', medir({ repo: dir, base: 'base' }).estado === R.NAO_APLICAVEL);

    // index (mudança staged, sem commit) também entra no diff
    g(['checkout', '-q', 'main']);
    writeFileSync(join(dir, 'tests', 'soma.test.mjs'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { soma } from '../src/soma.mjs'; test('soma', () => assert.equal(soma(2, 3), 5));\n");
    g(['add', '-A']);
    check('REPO REAL: teste consertado só no INDEX (staged) já conta → PROVOU_O_FIX', medir({ repo: dir, base: 'base' }).estado === R.PROVOU_O_FIX);
    // o repo temporário se chama crg-self-*; a réplica, crg-* sem "self" — o check distingue os dois
    check('réplica não deixa worktree registrada', !/[\\/]crg-(?!self-)/.test(git(['worktree', 'list'], dir)));
  } catch (e) {
    check(`REPO REAL: montagem falhou (${e?.message || e})`, false);
  } finally {
    if (t) { try { rmSync(t.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock */ } }
  }

  // ── ADAPTAÇÃO LOCAL (issue #4, 2026-09-12): linkarVenvNaReplica — sem depender de Python de
  //    verdade instalado, só dois diretórios quaisquer e um arquivo-marcador ──
  {
    let repoDir, replicaDir;
    try {
      repoDir = mkdtempSync(join(tmpdir(), 'crg-venv-repo-'));
      replicaDir = mkdtempSync(join(tmpdir(), 'crg-venv-replica-'));
      mkdirSync(join(repoDir, '.venv'), { recursive: true });
      writeFileSync(join(repoDir, '.venv', 'marcador.txt'), 'ok');
      linkarVenvNaReplica(repoDir, replicaDir);
      check(
        'linkarVenvNaReplica: .venv do repo aparece do outro lado do link, na réplica (marcador visível)',
        existsSync(join(replicaDir, '.venv', 'marcador.txt')),
      );
    } finally {
      if (repoDir) rmSync(repoDir, { recursive: true, force: true });
      if (replicaDir) rmSync(replicaDir, { recursive: true, force: true });
    }
  }
  {
    let repoDir, replicaDir;
    try {
      repoDir = mkdtempSync(join(tmpdir(), 'crg-sem-venv-repo-'));
      replicaDir = mkdtempSync(join(tmpdir(), 'crg-sem-venv-replica-'));
      linkarVenvNaReplica(repoDir, replicaDir); // repo SEM .venv — nunca deve criar nada nem lançar
      check('BYPASS: sem .venv no repo → não cria nada na réplica (nem quebra)', !existsSync(join(replicaDir, '.venv')));
    } finally {
      if (repoDir) rmSync(repoDir, { recursive: true, force: true });
      if (replicaDir) rmSync(replicaDir, { recursive: true, force: true });
    }
  }

  // ── STACK (R6, 2026-09-11): reconhece teste Python e roda pytest via lib/python-runtime.mjs ──

  // rodarTestes é função do MÓDULO (não exportada) — o self-test é inline no mesmo arquivo, então chama
  // direto (BANCA SUBSTITUIR: o `resolver` injetável prova o ramo "python ausente" sem depender da máquina).
  check(
    'rodarTestes (Python): resolver injetado devolve null → ferramentaAusente, mensagem "python não encontrado"',
    (() => { const r = rodarTestes(tmpdir(), ['x.py'], null, true, () => null); return r.ferramentaAusente === true && /python não encontrado/i.test(r.saida); })(),
  );
  check(
    'rodarTestes (Python): resolver REAL — pytest de verdade AUSENTE nesta máquina → ferramentaAusente com dica "pip install pytest" (nunca ok true/false)',
    (() => { const r = rodarTestes(tmpdir(), ['nao-existe-mesmo.py'], null, true); return r.ferramentaAusente === true && /pip install pytest/i.test(r.saida) && r.ok === undefined; })(),
  );
  check(
    'rodarTestes: --cmd explícito vence mesmo com stackPython=true (resolver nem é chamado)',
    rodarTestes(tmpdir(), ['qualquer.py'], process.platform === 'win32' ? 'exit 0' : 'true', true, () => null).ok === true,
  );

  // fake pytest.py (ver PYTEST_FAKE_FONTE) via PYTHONPATH — prova vermelho-na-base/verde-no-head SEM
  // depender de pytest estar instalado; a chamada é DIRETA (medir() roda git+spawnSync no processo atual),
  // então basta setar process.env.PYTHONPATH pro spawnSync interno herdar via envSemGit().
  const pyFakeDir = mkdtempSync(join(tmpdir(), 'crg-pyfake-'));
  writeFileSync(join(pyFakeDir, 'pytest.py'), PYTEST_FAKE_FONTE);
  const pythonPathAntigo = process.env.PYTHONPATH;
  process.env.PYTHONPATH = pythonPathAntigo ? `${pyFakeDir}${process.platform === 'win32' ? ';' : ':'}${pythonPathAntigo}` : pyFakeDir;
  const testeSomaPy = 'def test_soma():\n    assert soma(2, 3) == 5\n';
  let tPy;
  try {
    tPy = repoTemporarioPython(testeSomaPy, 'def soma(a, b):\n    return a - b  # BUG_AQUI\n');
    writeFileSync(tPy.fonte, 'def soma(a, b):\n    return a + b\n'); // conserta: marcador sai da fonte
    writeFileSync(tPy.teste, testeSomaPy + '# companion tocado\n');
    tPy.g(['add', '-A']); tPy.g(['commit', '-q', '-m', 'fix + companion python (fake pytest)']);
    check('STACK (Python, fake pytest): conserto + teste que morde → PROVOU_O_FIX', medir({ repo: tPy.dir, base: 'base' }).estado === R.PROVOU_O_FIX);
  } catch (e) {
    check(`STACK (Python, PROVOU_O_FIX): montagem falhou (${e?.message || e})`, false);
  } finally {
    if (tPy) { try { rmSync(tPy.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock */ } }
  }
  let tPyBase;
  try {
    tPyBase = repoTemporarioPython(testeSomaPy, 'def soma(a, b):\n    return a + b\n'); // fonte já correta na base: sem BUG_AQUI
    writeFileSync(tPyBase.fonte, 'def soma(a, b):\n    return a + b  # tweak sem efeito\n');
    writeFileSync(tPyBase.teste, testeSomaPy + '# companion tocado\n');
    tPyBase.g(['add', '-A']); tPyBase.g(['commit', '-q', '-m', 'fonte muda, mas já passava na base (fake pytest)']);
    check('STACK (Python, fake pytest): teste que passa na base → NAO_MORDE_A_BASE', medir({ repo: tPyBase.dir, base: 'base' }).estado === R.NAO_MORDE_A_BASE);
  } catch (e) {
    check(`STACK (Python, NAO_MORDE_A_BASE): montagem falhou (${e?.message || e})`, false);
  } finally {
    if (tPyBase) { try { rmSync(tPyBase.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock */ } }
  }
  let tPyHead;
  try {
    tPyHead = repoTemporarioPython(testeSomaPy, 'def soma(a, b):\n    return a - b  # BUG_AQUI\n'); // vermelho na base
    writeFileSync(tPyHead.fonte, 'def soma(a, b):\n    return a - b  # BUG_AQUI ainda\n'); // "conserto" não tirou o marcador — continua vermelho
    writeFileSync(tPyHead.teste, testeSomaPy + '# companion tocado\n');
    tPyHead.g(['add', '-A']); tPyHead.g(['commit', '-q', '-m', 'fonte muda mas o bug continua (fake pytest)']);
    check('STACK (Python, fake pytest): teste vermelho no HEAD → VERMELHO_NO_HEAD', medir({ repo: tPyHead.dir, base: 'base' }).estado === R.VERMELHO_NO_HEAD);
  } catch (e) {
    check(`STACK (Python, VERMELHO_NO_HEAD): montagem falhou (${e?.message || e})`, false);
  } finally {
    if (tPyHead) { try { rmSync(tPyHead.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock */ } }
  }
  if (pythonPathAntigo === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = pythonPathAntigo;

  // PORTA (subprocesso, exit code de main()): PROVOU_O_FIX via fake pytest passado por env explícito, e
  // NÃO MEDIU quando o pytest de VERDADE (ausente nesta máquina) falha por "No module named pytest".
  const portaComEnv = (dir, args, envExtra) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000, env: { ...envSemGit(), npm_lifecycle_event: '', ...envExtra } }).status;
  let tPyPorta;
  try {
    tPyPorta = repoTemporarioPython(testeSomaPy, 'def soma(a, b):\n    return a - b  # BUG_AQUI\n');
    writeFileSync(tPyPorta.fonte, 'def soma(a, b):\n    return a + b\n');
    writeFileSync(tPyPorta.teste, testeSomaPy + '# companion tocado\n');
    tPyPorta.g(['add', '-A']); tPyPorta.g(['commit', '-q', '-m', 'fix python via porta']);
    check('STACK PORTA (Python, fake pytest via PYTHONPATH): PROVOU_O_FIX → exit 0', portaComEnv(tPyPorta.dir, ['--base', 'base'], { PYTHONPATH: pyFakeDir }) === 0);
    check(
      'STACK PORTA (Python, pytest de VERDADE ausente nesta máquina — sem PYTHONPATH fake): NÃO MEDIU explícito → exit 2 (nunca verde)',
      portaComEnv(tPyPorta.dir, ['--base', 'base'], {}) === 2,
    );
  } catch (e) {
    check(`STACK PORTA (Python): montagem falhou (${e?.message || e})`, false);
  } finally {
    if (tPyPorta) { try { rmSync(tPyPorta.dir, { recursive: true, force: true }); } catch { /* ignora-de-proposito: lock */ } }
    rmSync(pyFakeDir, { recursive: true, force: true });
  }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) { if (selfTestPedido()) selfTest(); else main(); }
