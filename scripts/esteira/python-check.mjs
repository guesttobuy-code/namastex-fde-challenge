#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: R6 (2026-09-11) — perfil de stack Python do kit (projeto Namastex). Os 8 guards que só
 *   leem JS/TS (empty-catch, await-unhandled, catch-silent-blocker, duplicate-logic, import-boundaries,
 *   cross-module-impact, cochange-companion, todo-debt-ratchet) saem NAO_APLICAVEL num projeto declarado
 *   "stack":"python" — mas isso NÃO pode virar "full-check verde sem medir nada de verdade". Este script é
 *   o QUE MEDE de fato o código Python: `ruff check` (lint) e `pytest` (teste), a mesma prova que os guards
 *   JS/TS já cobrem pro código deles.
 *
 * O QUE FAZ: `node scripts/python-check.mjs` — projeto NÃO-python (esteira.json sem "stack":"python", ou
 *   sem esteira.json) sai NAO_APLICAVEL exit 0 rápido, ANTES de tentar qualquer coisa. Projeto python SEM
 *   nenhum `.py` rastreado pelo git sai NAO_APLICAVEL. Projeto python SEM `pyproject.toml` na raiz sai
 *   NAO_APLICAVEL (decisão do coordenador: num FORK, o código do repo-pai também é `.py` — só a config do
 *   projeto — `extend-exclude` do ruff, `testpaths` do pytest — diz o que é código do candidato; sem ela
 *   este script mediria código alheio). Daí em diante resolve o Python (lib/python-runtime.mjs — MESMA
 *   ordem de `.venv/Scripts/python.exe` → `.venv/bin/python` → `python` → `py -3` que companion-red-green
 *   usa) e roda `<python> -m ruff check .` + `<python> -m pytest -q`.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. ruff/pytest AUSENTE virando "✅" por engano — sai NÃO MEDIU (exit 2) com a dica de instalação, NUNCA
 *      exit 0 (LEI DO NÃO-CHUTE: sem a ferramenta real, não há como afirmar "está limpo");
 *   2. ruff ou pytest reprovando e o script sair 0 mesmo assim.
 *
 * O QUE NUNCA PODE BLOQUEAR (família de falsos-positivos):
 *   - projeto node (sem "stack":"python") — NAO_APLICAVEL, nunca tenta rodar ruff/pytest;
 *   - projeto python sem nenhum `.py` rastreado — NAO_APLICAVEL;
 *   - projeto python sem `pyproject.toml` — NAO_APLICAVEL (config ainda não existe: pendência da 1ª frente,
 *     não uma reprovação);
 *   - `pytest` sem nenhum teste coletado (exit 5) — AVISO, não FALHA (projeto pode estar só começando).
 *
 * O QUE ESTE SCRIPT **NÃO** VÊ: (a) qualidade das regras do `pyproject.toml` (`[tool.ruff]`/
 *   `[tool.pytest.ini_options]`) — só confere que o arquivo EXISTE; (b) cobertura de teste — só que o
 *   pytest RODOU (0 testes coletados vira aviso, não é medido como "insuficiente"); (c) instalação de
 *   dependências do projeto (`pip install -e .`) — isso é do bootstrap/CI, não deste script; (d) ambiente
 *   virtual quebrado (existe mas o python de dentro não responde) — `resolverPython` cai pro próximo
 *   candidato da lista, então um `.venv` corrompido não trava: só é ignorado.
 *
 * CONTRA-PROVA: node scripts/python-check.mjs --self-test — executáveis Python FALSOS (módulos `ruff.py`/
 *   `pytest.py` via PYTHONPATH, mesma técnica de scripts/guards/companion-red-green.mjs) cobrem: ok
 *   (exit 0/0), falha de ruff, falha de pytest, pytest sem testes coletados (exit 5), ferramenta ausente
 *   (python não resolve — resolver injetável) e ferramenta ausente DE VERDADE (ruff/pytest genuinamente não
 *   instalados nesta máquina — sem fake nenhum). Self-test de COMANDO fora de scripts/guards/: listado em
 *   `SELFTESTS_FORA_DE_GUARDS` (scripts/guards/guards-esperados.mjs), mesmo padrão do reservar-numero.mjs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ehEntrypoint, selfTestPedido, relatarSelfTest } from './lib/guard-doctrine.mjs';
import { stackDoProjeto } from './lib/stack.mjs';
import { resolverPython } from './lib/python-runtime.mjs';

const NOME = 'python-check';

/** FUNÇÃO PURA: julga o resultado de `<python> -m ruff check .`. */
export function julgarRuff({ status = null, stdout = '', stderr = '', error } = {}) {
  const saida = `${stdout || ''}${stderr || ''}`;
  if (error || /No module named ['"]?ruff/i.test(saida)) return { estado: 'FERRAMENTA_AUSENTE', saida };
  return { estado: status === 0 ? 'OK' : 'FALHA', saida };
}

/** FUNÇÃO PURA: julga o resultado de `<python> -m pytest -q`. exit 5 = nenhum teste coletado (aviso). */
export function julgarPytest({ status = null, stdout = '', stderr = '', error } = {}) {
  const saida = `${stdout || ''}${stderr || ''}`;
  if (error || /No module named ['"]?pytest/i.test(saida)) return { estado: 'FERRAMENTA_AUSENTE', saida };
  if (status === 0) return { estado: 'OK', saida };
  if (status === 5) return { estado: 'AVISO_SEM_TESTES', saida };
  return { estado: 'FALHA', saida };
}

/** FUNÇÃO PURA: combina os dois julgamentos num exit code. Ferramenta ausente em QUALQUER um vence sempre
 *  (nunca 0/1 sem a ferramenta real — LEI DO NÃO-CHUTE); falha real é exit 1; senão exit 0 (com aviso se
 *  pytest não coletou nada). */
export function combinarResultados(ruffJulgado, pytestJulgado) {
  if (ruffJulgado.estado === 'FERRAMENTA_AUSENTE' || pytestJulgado.estado === 'FERRAMENTA_AUSENTE') {
    return { exitCode: 2, motivo: 'FERRAMENTA_AUSENTE' };
  }
  if (ruffJulgado.estado === 'FALHA' || pytestJulgado.estado === 'FALHA') return { exitCode: 1, motivo: 'FALHA' };
  return { exitCode: 0, motivo: pytestJulgado.estado === 'AVISO_SEM_TESTES' ? 'OK_SEM_TESTES' : 'OK' };
}

function listarPyRastreados(dir) {
  return execFileSync('git', ['-C', dir, 'ls-files', '*.py'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

/**
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {(dir:string)=>({cmd:string,args:string[]}|null)} [opts.resolver] injetável — BANCA SUBSTITUIR.
 * @returns {number} exit code
 */
export function principal({ cwd = process.cwd(), resolver = resolverPython } = {}) {
  let stack;
  try { stack = stackDoProjeto(cwd); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); return 2; }
  if (stack !== 'python') { console.log(`[${NOME}] NAO_APLICAVEL: projeto não declarado python no esteira.json.`); return 0; }

  let arquivosPy;
  try { arquivosPy = listarPyRastreados(cwd); }
  catch (e) { console.error(`[${NOME}] NÃO MEDIU: não consegui listar arquivos .py rastreados em ${cwd}: ${e?.message || e}`); return 2; }
  if (arquivosPy.length === 0) { console.log(`[${NOME}] NAO_APLICAVEL: nenhum .py rastreado neste projeto.`); return 0; }

  if (!existsSync(join(cwd, 'pyproject.toml'))) {
    console.log(`[${NOME}] NAO_APLICAVEL: projeto python sem pyproject.toml: ruff e pytest ainda não configurados — crie o pyproject.toml (com [tool.ruff] e [tool.pytest.ini_options]) na primeira frente.`);
    return 0;
  }

  const py = resolver(cwd);
  if (!py) {
    console.error(`[${NOME}] NÃO MEDIU: python não encontrado (.venv/Scripts, .venv/bin, python, py -3).`);
    console.error(`[${NOME}] COMO PASSAR: instale Python 3 (ou crie .venv na raiz do projeto) antes de rodar este check.`);
    return 2;
  }

  const rRuff = spawnSync(py.cmd, [...py.args, '-m', 'ruff', 'check', '.'], { cwd, encoding: 'utf8', timeout: 300_000 });
  const ruffJulgado = julgarRuff(rRuff);
  const rPytest = spawnSync(py.cmd, [...py.args, '-m', 'pytest', '-q'], { cwd, encoding: 'utf8', timeout: 600_000 });
  const pytestJulgado = julgarPytest(rPytest);
  const { exitCode, motivo } = combinarResultados(ruffJulgado, pytestJulgado);

  console.log(`[${NOME}] ruff: ${ruffJulgado.estado}`);
  if (ruffJulgado.saida.trim()) console.log(ruffJulgado.saida.trim());
  console.log(`[${NOME}] pytest: ${pytestJulgado.estado}`);
  if (pytestJulgado.saida.trim()) console.log(pytestJulgado.saida.trim());

  if (motivo === 'FERRAMENTA_AUSENTE') {
    console.error(`[${NOME}] NÃO MEDIU: ruff e/ou pytest não estão instalados nesse Python.`);
    console.error(`[${NOME}] COMO PASSAR: ${py.cmd}${py.args.length ? ` ${py.args.join(' ')}` : ''} -m pip install ruff pytest`);
    return 2;
  }
  if (motivo === 'FALHA') {
    console.error(`[${NOME}] FALHA: ruff ou pytest reprovou — veja a saída acima.`);
    return 1;
  }
  if (motivo === 'OK_SEM_TESTES') console.log(`[${NOME}] AVISO: pytest não coletou nenhum teste (exit 5) — seguindo mesmo assim.`);
  console.log(`[${NOME}] ✅ ruff e pytest passaram.`);
  return exitCode;
}

// ─── contra-prova ─────────────────────────────────────────────────────────────
function repoPython({ comPyproject = true, comPy = true, stack = 'python' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pc-self-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); g(['config', 'core.autocrlf', 'false']);
  writeFileSync(join(dir, 'esteira.json'), JSON.stringify({ stack }));
  if (comPy) { mkdirSync(join(dir, 'src'), { recursive: true }); writeFileSync(join(dir, 'src', 'a.py'), 'x = 1\n'); }
  if (comPyproject) writeFileSync(join(dir, 'pyproject.toml'), '[tool.ruff]\nline-length = 100\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
  return dir;
}

// Módulos FALSOS `ruff.py`/`pytest.py` (mesma técnica de companion-red-green.mjs: `-m <nome>` importa o
// PRIMEIRO módulo com esse nome em sys.path — com PYTHONPATH apontando pra cá, roda ESTE código em vez do
// pacote real). Não dependem de ruff/pytest estarem instalados.
function pastaFerramentasFalsas({ ruffExit = 0, pytestExit = 0 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pc-fake-'));
  writeFileSync(join(dir, 'ruff.py'), `import sys\nif __name__ == "__main__":\n    sys.exit(${ruffExit})\n`);
  writeFileSync(join(dir, 'pytest.py'), `import sys\nif __name__ == "__main__":\n    sys.exit(${pytestExit})\n`);
  return dir;
}

function comPythonPath(dirFake, fn) {
  const antigo = process.env.PYTHONPATH;
  process.env.PYTHONPATH = antigo ? `${dirFake}${process.platform === 'win32' ? ';' : ':'}${antigo}` : dirFake;
  try { return fn(); }
  finally { if (antigo === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = antigo; }
}

function selfTest() {
  const casos = [];
  const check = (nome, cond) => casos.push({ nome, ok: Boolean(cond) });

  // ── funções puras ──
  check('julgarRuff: exit 0 → OK', julgarRuff({ status: 0 }).estado === 'OK');
  check('julgarRuff: exit 1 → FALHA', julgarRuff({ status: 1, stdout: 'algum.py:1:1: E501\n' }).estado === 'FALHA');
  check('julgarRuff: "No module named ruff" → FERRAMENTA_AUSENTE', julgarRuff({ status: 1, stderr: "No module named 'ruff'" }).estado === 'FERRAMENTA_AUSENTE');
  check('julgarRuff: spawnSync error (ENOENT) → FERRAMENTA_AUSENTE', julgarRuff({ error: new Error('ENOENT') }).estado === 'FERRAMENTA_AUSENTE');
  check('julgarPytest: exit 0 → OK', julgarPytest({ status: 0 }).estado === 'OK');
  check('julgarPytest: exit 1 → FALHA', julgarPytest({ status: 1, stdout: '1 failed' }).estado === 'FALHA');
  check('julgarPytest: exit 5 (nenhum teste coletado) → AVISO_SEM_TESTES (nunca FALHA)', julgarPytest({ status: 5, stdout: 'no tests ran' }).estado === 'AVISO_SEM_TESTES');
  check('julgarPytest: "No module named pytest" → FERRAMENTA_AUSENTE', julgarPytest({ status: 1, stderr: "No module named 'pytest'" }).estado === 'FERRAMENTA_AUSENTE');
  check('combinarResultados: OK+OK → exit 0', combinarResultados({ estado: 'OK' }, { estado: 'OK' }).exitCode === 0);
  check('combinarResultados: OK+AVISO_SEM_TESTES → exit 0, motivo OK_SEM_TESTES', (() => { const r = combinarResultados({ estado: 'OK' }, { estado: 'AVISO_SEM_TESTES' }); return r.exitCode === 0 && r.motivo === 'OK_SEM_TESTES'; })());
  check('combinarResultados: FALHA em qualquer um → exit 1', combinarResultados({ estado: 'FALHA' }, { estado: 'OK' }).exitCode === 1 && combinarResultados({ estado: 'OK' }, { estado: 'FALHA' }).exitCode === 1);
  check('BYPASS: FERRAMENTA_AUSENTE vence FALHA (nunca 1 sem a ferramenta real)', combinarResultados({ estado: 'FERRAMENTA_AUSENTE' }, { estado: 'FALHA' }).exitCode === 2);
  check('BYPASS: FERRAMENTA_AUSENTE de qualquer lado → exit 2, nunca 0', combinarResultados({ estado: 'FERRAMENTA_AUSENTE' }, { estado: 'OK' }).exitCode === 2 && combinarResultados({ estado: 'OK' }, { estado: 'FERRAMENTA_AUSENTE' }).exitCode === 2);

  // ── principal() — projeto NÃO-python / sem .py / sem pyproject.toml → NAO_APLICAVEL, ANTES de tentar rodar nada ──
  let dNode, dSemPy, dSemPyproject;
  try {
    dNode = repoPython({ stack: 'node' });
    check('NAO_APLICAVEL: projeto node (stack explícito) → exit 0', principal({ cwd: dNode }) === 0);
    dSemPy = repoPython({ comPy: false });
    check('NAO_APLICAVEL: projeto python sem nenhum .py rastreado → exit 0', principal({ cwd: dSemPy }) === 0);
    dSemPyproject = repoPython({ comPyproject: false });
    check('NAO_APLICAVEL: projeto python SEM pyproject.toml → exit 0 (config ainda não existe — pendência, não reprovação)', principal({ cwd: dSemPyproject }) === 0);
  } finally {
    for (const d of [dNode, dSemPy, dSemPyproject]) if (d) rmSync(d, { recursive: true, force: true });
  }

  // ── BYPASS: resolver injetado devolve null (python ausente) → NÃO MEDIU, nunca 0 ──
  let dResolverNulo;
  try {
    dResolverNulo = repoPython();
    check('BYPASS: resolver() → null (python não encontrado) → exit 2, nunca 0/1', principal({ cwd: dResolverNulo, resolver: () => null }) === 2);
  } finally { if (dResolverNulo) rmSync(dResolverNulo, { recursive: true, force: true }); }

  // ── ferramenta ausente DE VERDADE (esta máquina não tem ruff/pytest — sem fake nenhum) ──
  let dFerramentaReal;
  try {
    dFerramentaReal = repoPython();
    check(
      'BYPASS: ruff/pytest genuinamente AUSENTES nesta máquina (resolver REAL, sem PYTHONPATH fake) → exit 2 NÃO MEDIU (nunca ✅ por ferramenta ausente)',
      principal({ cwd: dFerramentaReal }) === 2,
    );
  } finally { if (dFerramentaReal) rmSync(dFerramentaReal, { recursive: true, force: true }); }

  // ── executáveis Python FALSOS via PYTHONPATH: cobre os ramos que dependem de ruff/pytest responderem ──
  let dOk, dRuffFalha, dPytestFalha, dSemTestes;
  try {
    dOk = repoPython();
    let fake = pastaFerramentasFalsas({ ruffExit: 0, pytestExit: 0 });
    try { check('FAKE (ok): ruff e pytest passam → exit 0', comPythonPath(fake, () => principal({ cwd: dOk })) === 0); }
    finally { rmSync(fake, { recursive: true, force: true }); }

    dRuffFalha = repoPython();
    fake = pastaFerramentasFalsas({ ruffExit: 1, pytestExit: 0 });
    try { check('FAKE: ruff reprova → exit 1 FALHA', comPythonPath(fake, () => principal({ cwd: dRuffFalha })) === 1); }
    finally { rmSync(fake, { recursive: true, force: true }); }

    dPytestFalha = repoPython();
    fake = pastaFerramentasFalsas({ ruffExit: 0, pytestExit: 1 });
    try { check('FAKE: pytest reprova → exit 1 FALHA', comPythonPath(fake, () => principal({ cwd: dPytestFalha })) === 1); }
    finally { rmSync(fake, { recursive: true, force: true }); }

    dSemTestes = repoPython();
    fake = pastaFerramentasFalsas({ ruffExit: 0, pytestExit: 5 });
    try { check('FAKE: pytest exit 5 (nenhum teste coletado) → exit 0 (AVISO, nunca FALHA)', comPythonPath(fake, () => principal({ cwd: dSemTestes })) === 0); }
    finally { rmSync(fake, { recursive: true, force: true }); }
  } finally {
    for (const d of [dOk, dRuffFalha, dPytestFalha, dSemTestes]) if (d) rmSync(d, { recursive: true, force: true });
  }

  // ── PORTA (issue #17): processo real ──
  const meu = fileURLToPath(import.meta.url);
  const porta = (dir, envExtra = {}) => spawnSync(process.execPath, [meu], { cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...process.env, npm_lifecycle_event: '', ...envExtra } }).status;
  let dPortaNode, dPortaFake, dPortaReal;
  try {
    dPortaNode = repoPython({ stack: 'node' });
    check('PORTA: projeto node → exit 0', porta(dPortaNode) === 0);

    dPortaFake = repoPython();
    const fakeDir = pastaFerramentasFalsas({ ruffExit: 0, pytestExit: 0 });
    try { check('PORTA (fake pytest/ruff via PYTHONPATH): ok → exit 0', porta(dPortaFake, { PYTHONPATH: fakeDir }) === 0); }
    finally { rmSync(fakeDir, { recursive: true, force: true }); }

    dPortaReal = repoPython();
    check('PORTA: ruff/pytest ausentes de verdade (sem PYTHONPATH fake) → exit 2 NÃO MEDIU', porta(dPortaReal, {}) === 2);
  } finally {
    for (const d of [dPortaNode, dPortaFake, dPortaReal]) if (d) rmSync(d, { recursive: true, force: true });
  }

  process.exitCode = relatarSelfTest(NOME, casos);
}

if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) selfTest();
  else { try { process.exitCode = principal(); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; } }
}
