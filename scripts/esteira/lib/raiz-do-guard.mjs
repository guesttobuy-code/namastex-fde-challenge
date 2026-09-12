/**
 * raiz-do-guard.mjs — DONO ÚNICO (LEI 11) de "qual é a RAIZ do projeto, vista de dentro de
 * scripts/guards/?" — usado por guards-catalog.mjs e minefield.mjs (issue #21).
 *
 * POR QUE EXISTE: os dois guards calculavam `RAIZ = dirname(dirname(GUARDS_DIR))`
 * ("scripts/guards -> scripts -> raiz") — comentário fiel ao LAYOUT DO KIT, mas só ao dele. Num
 * projeto nascido do bootstrap os guards moram em `<codigo>/scripts/esteira/guards/` (e `<codigo>`
 * pode ter qualquer profundidade abaixo da raiz do repo, quando `esteira.json.codigo` não é `.`) —
 * dois níveis acima de `guards/` para no meio do caminho (`scripts/` ou `scripts/esteira/`), nunca na
 * raiz. `guards-catalog` gravava/comparava `governance/GUARDS_CATALOG.md` no lugar errado e nascia
 * vermelho em todo projeto novo; `minefield` calculava um `referencia/` errado (inofensivo hoje só
 * porque `referencia/` nunca é copiado para projeto nenhum — item separado, ver `minefield.mjs`).
 *
 * O QUE FAZ: sobe a partir de `guardsDir` procurando `esteira.json` — a MESMA subida de
 * `findEsteiraRoot` (`./esteira.mjs`, dono único da LEITURA/busca de `esteira.json`; aqui só
 * REUSAMOS, não duplicamos). Achou → essa é a raiz (kit OU bootstrapado, qualquer profundidade de
 * `codigo`). Não achou (guard rodando fora de um projeto da esteira, ou árvore de teste isolada) →
 * cai no comportamento de sempre: dois níveis acima de `scripts/guards/` — nenhum caso antigo muda.
 *
 * CONTRA-PROVA: casos em `guards-catalog.mjs --self-test` e `minefield.mjs --self-test` (layout do
 * kit, layout bootstrapado com esteira.json mais acima, e sem esteira.json em lugar nenhum — este
 * último injeta `finder` para não depender de %TEMP% estar livre de um esteira.json perdido, o que
 * já foi medido como falso na máquina do dono).
 */
import { dirname } from 'node:path';
import { findEsteiraRoot } from './esteira.mjs';

/**
 * @param {string} guardsDir pasta `scripts/guards` (ou `scripts/esteira/guards`) do projeto.
 * @param {(dir: string) => string|null} [finder] seam de teste — default é `findEsteiraRoot` de verdade.
 * @returns {string}
 */
export function raizDoProjeto(guardsDir, finder = findEsteiraRoot) {
  return finder(guardsDir) || dirname(dirname(guardsDir));
}
