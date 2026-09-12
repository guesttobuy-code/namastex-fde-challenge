/**
 * python-runtime.mjs — DONO ÚNICO (LEI 11) de "qual Python roda este projeto?" — usado por
 * `companion-red-green.mjs` (roda pytest do teste tocado) e `scripts/python-check.mjs` (roda
 * ruff+pytest do projeto inteiro). R6, 2026-09-11 — perfil de stack Python do kit (Namastex).
 *
 * ORDEM DE RESOLUÇÃO (a mesma nos dois consumidores — dono único, não dois palpites que divergem):
 *   1. `<projeto>/.venv/Scripts/python.exe` (venv, Windows)
 *   2. `<projeto>/.venv/bin/python` (venv, POSIX)
 *   3. `python` no PATH
 *   4. `py -3` no PATH (launcher do Windows)
 * O primeiro candidato que responde a `--version` com exit 0 vence. Devolve `{ cmd, args }` pronto pra
 * `spawnSync(cmd, [...args, ...resto])`, ou `null` se NENHUM candidato respondeu — quem chama trata
 * `null` como "ferramenta ausente" (NÃO MEDIU explícito, nunca verde por ausência de ferramenta — LEI DO
 * NÃO-CHUTE: sem Python real, não há como afirmar vermelho NEM verde).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CANDIDATOS_VENV = [
  ['.venv', 'Scripts', 'python.exe'],
  ['.venv', 'bin', 'python'],
];

/** @param {string} [cwd] raiz do projeto (onde procurar .venv/). @returns {{cmd:string, args:string[]}|null} */
export function resolverPython(cwd = process.cwd()) {
  const candidatos = [
    ...CANDIDATOS_VENV.map((partes) => ({ cmd: join(cwd, ...partes), args: [], ehCaminho: true })),
    { cmd: 'python', args: [], ehCaminho: false },
    { cmd: 'py', args: ['-3'], ehCaminho: false },
  ];
  for (const cand of candidatos) {
    if (cand.ehCaminho && !existsSync(cand.cmd)) continue; // caminho de venv que não existe: nem tenta
    let r;
    try { r = spawnSync(cand.cmd, [...cand.args, '--version'], { stdio: 'ignore', timeout: 10_000 }); }
    catch { continue; }
    if (!r.error && r.status === 0) return { cmd: cand.cmd, args: cand.args };
  }
  return null;
}
