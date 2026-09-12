/**
 * stack.mjs — DONO ÚNICO (LEI 11) de "qual é o stack declarado deste projeto?" no lado JS do kit.
 * Gêmeo de `Get-Esteira`/`Find-EsteiraRoot` (scripts/lib/Esteira.ps1) para o campo opcional `stack` de
 * `esteira.json` — decisão do dono, R6 (2026-09-11): kit precisa reconhecer projeto Python (Namastex)
 * sem fingir medir JS/TS onde não há nenhum.
 *
 * POR QUE UM MÓDULO À PARTE: os 8 guards que só leem JS/TS (empty-catch, await-unhandled,
 * catch-silent-blocker, duplicate-logic, import-boundaries, cross-module-impact, cochange-companion,
 * todo-debt-ratchet) precisam da MESMA resposta — um só dono, não 8 cópias do "sobe até achar
 * esteira.json" (LEI 11).
 *
 * REGRA: sobe a partir de `dir` até achar `esteira.json`, PARANDO na raiz do repo git (não sobe pra fora
 * do repo — evita ler o esteira.json de um projeto VIZINHO/alheio numa pasta-mãe compartilhada). Sem
 * `esteira.json` em toda a subida (até a raiz do git, ou até a raiz do filesystem se `dir` não está em
 * nenhum repo git) = "node" (default do schema). `esteira.json` achado mas com JSON sintaticamente
 * inválido = LANÇA — quem chama (o guard) trata isso como NÃO MEDIU (exit 2), nunca "node" silencioso.
 * `stack` ausente ou com qualquer valor que não seja exatamente "python" = "node" (mesmo default do
 * schema; a VALIDAÇÃO de "só node|python" é do Esteira.ps1 no bootstrap — aqui só se LÊ o que já foi
 * validado lá, fail-soft para não travar o guard por um valor estranho gravado à mão).
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { repoRaiz } from './git-base.mjs';

/**
 * @param {string} dir pasta a partir de onde subir (não precisa existir).
 * @returns {'node'|'python'}
 */
export function stackDoProjeto(dir) {
  const inicio = resolve(String(dir ?? '.'));
  const raizGit = repoRaiz(inicio); // null se `inicio` não está em nenhum repo git
  let atual = inicio;
  for (;;) {
    const cfgPath = `${atual}/esteira.json`.replace(/\\/g, '/');
    if (existsSync(cfgPath)) {
      let cfg;
      try {
        cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      } catch (e) {
        throw new Error(`esteira.json inválido em ${cfgPath}: ${e?.message || e}`);
      }
      return cfg && cfg.stack === 'python' ? 'python' : 'node';
    }
    const chegouNaRaizDoGit = raizGit && resolve(atual) === resolve(raizGit);
    if (chegouNaRaizDoGit) return 'node'; // parou na raiz do repo git sem achar esteira.json
    const pai = dirname(atual);
    if (!pai || pai === atual) return 'node'; // raiz do filesystem (fora de qualquer repo git)
    atual = pai;
  }
}
