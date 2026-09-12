/**
 * guard-doctrine.mjs — as perguntas que todo guard do kit faz antes de rodar.
 * Portado da esteira de origem; só as funções que os guards do kit usam.
 *
 * REGRA: na dúvida, RODA. Guard que roda a mais custa um commit lento; guard que não roda custa um
 * incidente. Por isso `ehEntrypoint` é fail-OPEN e resolve junction/symlink (o Windows executa
 * arquivo por junction e a comparação de string de caminho dizia "não sou eu" — guard mudo).
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function mesmoArquivo(a, b, resolver = realpathSync) {
  if (!a || !b) return false;
  const norm = (p) => {
    let r;
    try { r = resolver(p); } catch { r = p; }
    return String(r).replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  };
  return norm(a) === norm(b);
}

/** Este módulo é o programa que o usuário mandou rodar (não um import)? Fail-open. */
export function ehEntrypoint(importMetaUrl, argv1 = process.argv[1], resolver = realpathSync) {
  if (!argv1) return true;
  let meu;
  try { meu = fileURLToPath(importMetaUrl); } catch { return true; }
  return mesmoArquivo(meu, argv1, resolver);
}

/**
 * `--self-test` foi pedido de verdade, ou é passthrough do npm?
 * `npm run <guard> -- --self-test` anexa a flag e o guard sairia 0 com a violação intacta (bypass
 * medido). Honra a flag só em `node <arquivo> --self-test` ou `npm run <guard>:selftest`.
 */
export function selfTestPedido(argv = process.argv, env = process.env, avisar = console.error) {
  if (!argv.includes('--self-test')) return false;
  const evento = String(env.npm_lifecycle_event || '');
  if (!evento) return true;
  if (/self-?test$/i.test(evento)) return true;
  avisar(`[guard] IGNORANDO "--self-test": chegou como passthrough de \`npm run ${evento}\`. O guard vai rodar normalmente. Para a contra-prova: npm run ${evento}:selftest`);
  return false;
}

/** Imprime os casos e devolve o exit code. Casos que começam com "BYPASS" são tentativas de burla. */
export function relatarSelfTest(nome, casos) {
  for (const c of casos) console.log(`  ${c.ok ? '✓' : '✗'} ${c.nome}`);
  const falhas = casos.filter((c) => !c.ok);
  if (falhas.length) { console.error(`[${nome}] SELF-TEST FALHOU: ${falhas.length}/${casos.length}`); return 1; }
  const bypasses = casos.filter((c) => c.nome.startsWith('BYPASS')).length;
  console.log(`[${nome}] SELF-TEST OK — ${casos.length}/${casos.length} casos (incl. ${bypasses} tentativas de bypass).`);
  return 0;
}
