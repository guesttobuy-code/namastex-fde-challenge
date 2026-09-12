/**
 * varredura.mjs — DONO ÚNICO do walker de árvore de arquivos que os scanners de guard (empty-catch,
 * secret-leak, file-loc-ceiling, text-encoding, await-unhandled, catch-silent-blocker) e `listarCodigo`
 * (importes.mjs) compartilhavam por CÓPIA — seis (e mais um) `escanear`/`listarCodigo` quase idênticos,
 * cada um podendo divergir por um conserto aplicado num e esquecido nos outros (LEI 11).
 *
 * SEMÂNTICA (idêntica à de todos os walkers de hoje): a RAIZ (`dir`) é SEMPRE varrida, mesmo se seu nome
 * estivesse em `pular` (só SUBPASTA pula por nome). Uma subpasta é pulada se seu NOME está em `pular` OU
 * se é outro checkout git DE VERDADE (`ehOutroCheckout`, git-base.mjs — um `.git` FALSO não esconde
 * nada). Raiz ILEGÍVEL (readdir falha) LANÇA — vira NÃO MEDIU no chamador, nunca "pasta vazia, tudo
 * limpo". Subpasta ilegível no MEIO da varredura (sumiu entre o readdir do pai e a leitura) é pulada em
 * silêncio, como sempre foi. Um arquivo aceito (`aceitar(nome, caminho)`) cujo tamanho passa de
 * `maxBytes` NÃO some calado: vai para `naoMedidos` — quem chama decide o que fazer (ignorar, virar
 * achado, virar NÃO MEDIU — a PORTA continua no guard, não aqui).
 *
 * `comoBuffer` decide o tipo de `conteudo`: `false` (padrão) lê como string UTF-8 (`readFileSync(p,
 * 'utf8')` — o que os scanners de PADRÃO DE TEXTO usam); `true` lê como `Buffer` (bytes crus — o que
 * precisa decidir "é binário?" ou validar encoding ANTES de decodificar).
 *
 * O QUE NÃO FAZ: não decide "binário" (isso é ehBinario, específico de cada guard — o walker não sabe se
 * quem chama vai checar isso); não decide "reprovar" (isso é do guard, a PORTA fica no arquivo dele —
 * governance/COMO-CRIAR-GUARD.md Parte 3/8: a prova-de-vida muta a porta no próprio arquivo do guard).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ehOutroCheckout } from './git-base.mjs';

/**
 * Varre `dir` recursivamente.
 * @param {string} dir
 * @param {object} opts
 * @param {(nome:string, caminho:string) => boolean} [opts.aceitar] arquivo entra na varredura? (nome =
 *   `ent.name`, caminho = caminho completo). Padrão: aceita tudo que é arquivo.
 * @param {Set<string>|{has:(nome:string, caminho:string)=>boolean}} [opts.pular] nomes de subpasta a
 *   pular. Aceita um `Set` comum (só olha o nome, como os 6 scanners fazem) ou qualquer objeto com
 *   `.has(nome, caminho)` pra quem precisa de mais contexto (glob por caminho, como `listarCodigo`).
 * @param {number} [opts.maxBytes] teto de tamanho; arquivo acima vai pra `naoMedidos` em vez de `arquivos`.
 * @param {boolean} [opts.comoBuffer=false] `conteudo` como Buffer (bytes crus) em vez de string utf8.
 * @returns {{arquivos:{caminho:string, conteudo:(string|Buffer)}[], naoMedidos:{caminho:string, motivo:string}[]}}
 */
// Adaptação local (2026-09-11, projeto Python): a lista padrão pulava só o equivalente do Node
// (node_modules). Num projeto Python, as dependências de terceiros moram em `.venv/Lib/site-packages`, e
// sem pular isso o file-loc-ceiling reprovava o commit por causa do tamanho de arquivos do `packaging` e
// do `pluggy` — código que não é nosso e que o .gitignore já exclui. Reportado ao kit para o perfil python.
export function varrerArvore(dir, { aceitar = () => true, pular = new Set(['node_modules', '.git', 'referencia', '.venv', 'venv', '.uv', '__pycache__', 'site-packages']), maxBytes, comoBuffer = false } = {}) {
  const arquivos = [];
  const naoMedidos = [];
  const pilha = [dir];
  while (pilha.length) {
    const atual = pilha.pop();
    let entradas;
    try {
      entradas = readdirSync(atual, { withFileTypes: true });
    } catch (e) {
      if (atual === dir) throw e; // raiz ilegível → NÃO MEDIU sobe pro chamador (nunca "pasta vazia")
      continue; // subpasta que sumiu no meio da varredura: pulada em silêncio
    }
    for (const ent of entradas) {
      const p = join(atual, ent.name);
      // subpasta que é outro checkout git DE VERDADE (worktree/submódulo/repo aninhado) não é varrida: é
      // outra árvore, com outra base. Um `.git` FALSO não conta (ehOutroCheckout). A raiz (`atual ===
      // dir`, nunca aqui — este bloco só trata ENTRADAS de um `atual`) sempre continua varrida.
      if (ent.isDirectory()) { if (!pular.has(ent.name, p) && !ehOutroCheckout(p)) pilha.push(p); continue; }
      if (!ent.isFile() || !aceitar(ent.name, p)) continue;
      let size;
      try { size = statSync(p).size; } catch { continue; } // erro transitório de stat: pulado, como sempre
      if (Number.isFinite(maxBytes) && size > maxBytes) { naoMedidos.push({ caminho: p, motivo: `${size} bytes > teto de ${maxBytes}` }); continue; }
      let conteudo;
      try { conteudo = comoBuffer ? readFileSync(p) : readFileSync(p, 'utf8'); } catch { continue; } // erro transitório de leitura: pulado
      arquivos.push({ caminho: p, conteudo });
    }
  }
  return { arquivos, naoMedidos };
}

/** O buffer TEM byte NUL nos primeiros 4096 bytes? Heurística padrão pra "é binário, não é texto" —
 *  usada por quem lê `comoBuffer: true` e precisa decidir se aplica um scanner de PADRÃO DE TEXTO em
 *  cima. DONO ÚNICO (LEI 11): empty-catch, secret-leak e file-loc-ceiling tinham a MESMA função
 *  copiada três vezes. */
export function ehBinario(buf) {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/**
 * `varrerArvore` + "aplica UM detector por arquivo e empilha os achados com `arquivo` na frente" — o
 * laço que vários scanners de padrão de texto (await-unhandled, catch-silent-blocker, empty-catch,
 * secret-leak, text-encoding) repetiam idêntico a menos do detector/opções (LEI 11).
 *
 * `detector(conteudo, caminho)` decide os achados DAQUELE arquivo (array de objetos sem `arquivo` — esta
 * função acrescenta). `pularBinario: true` descarta arquivo binário (via `ehBinario`) ANTES de chamar o
 * detector — quem não usa `comoBuffer` não precisa disso (a fonte já chega como string). `incluirNaoMedidos:
 * true` devolve `{achados, naoMedidos}` em vez de só `achados` — pra quem (como text-encoding) reporta
 * arquivo acima do teto como NÃO MEDIU em vez de ignorar calado.
 */
export function varrerEDetectar(dir, { aceitar, pular, maxBytes, comoBuffer = false, pularBinario = false, detector, incluirNaoMedidos = false } = {}) {
  const achados = [];
  const { arquivos, naoMedidos } = varrerArvore(dir, { aceitar, pular, maxBytes, comoBuffer });
  for (const { caminho, conteudo } of arquivos) {
    if (pularBinario && ehBinario(conteudo)) continue;
    for (const a of detector(conteudo, caminho)) achados.push({ arquivo: caminho, ...a });
  }
  if (incluirNaoMedidos) return { achados, naoMedidos: naoMedidos.map((nm) => ({ arquivo: nm.caminho, motivo: nm.motivo })) };
  return achados;
}

// Config de "código-fonte clássico" que await-unhandled e catch-silent-blocker usavam BYTE A BYTE igual
// (mesma extensão, mesma pasta pulada, mesmo teto) — LEI 11 (R4): `escanear(dir)` dos dois guards já não
// tinha NADA além do detector pra diferenciar, então `varrerEDetectar` sozinho não bastava (o guard
// duplicate-logic ainda flagrava o wrapper). Só use este atalho quando o conjunto é MESMO idêntico ao do
// guard — um guard com extensão/pasta/teto diferente chama `varrerEDetectar` direto, não este.
export const EXT_CODIGO_PADRAO = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/;
// Adaptação local (2026-09-11, projeto Python): ver comentário em varrerArvore — o ambiente virtual e os
// caches do Python entram na lista de pastas puladas, pelo mesmo motivo que node_modules já estava nela.
export const PULAR_DIR_PADRAO = new Set(['node_modules', '.git', 'referencia', '.venv', 'venv', '.uv', '__pycache__', 'site-packages']);
export const MAX_BYTES_PADRAO = 1024 * 1024;

/** `varrerEDetectar` com a config de código-fonte clássico acima — atalho pra guard cujo `escanear(dir)`
 *  não tem NADA além do detector (ver comentário da config acima). */
export function escanearCodigoPadrao(dir, detector) {
  return varrerEDetectar(dir, { aceitar: (nome) => EXT_CODIGO_PADRAO.test(nome), pular: PULAR_DIR_PADRAO, maxBytes: MAX_BYTES_PADRAO, detector });
}
