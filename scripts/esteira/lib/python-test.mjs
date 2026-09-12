/**
 * python-test.mjs — DONO ÚNICO (LEI 11) da convenção "isto é um arquivo de teste Python?" (e "isto é
 * fonte Python?"), usada por `testes-catraca.mjs` (a catraca de casos) e `companion-red-green.mjs` (roda
 * pytest do teste tocado). R6, 2026-09-11 — perfil de stack Python do kit (Namastex).
 */

/** Teste Python: `test_*.py`, `*_test.py`, ou QUALQUER `.py` sob uma pasta `tests/`. */
export const RE_TESTE_PY = /(?:^|\/)(?:test_[^/]+\.py|[^/]*_test\.py|tests\/(?:[^/]+\/)*[^/]+\.py)$/i;

/** Fonte Python: qualquer `.py` que NÃO seja teste (quem chama já filtra com `RE_TESTE_PY`). */
export const RE_FONTE_PY = /\.py$/i;
