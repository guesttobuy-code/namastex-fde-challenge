// Teste-semente da esteira -base. Existe para que `npm run test:ci` (node --test tests/) e o
// `full-check` do projeto recém-nascido rodem verdes de cara (issue #15 do kit), e para servir de
// modelo de companion: importa a fonte, afirma um comportamento, falha se ele mudar.
// Substitua/complete com os companions de cada módulo (tests/contracts/<modulo>.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('esteira.json existe na raiz e tem os campos obrigatórios', () => {
  const cfg = JSON.parse(readFileSync(new URL('../esteira.json', import.meta.url), 'utf8'));
  for (const campo of ['projeto', 'repo', 'remote', 'branch_base', 'wt_root', 'codigo']) {
    assert.ok(campo in cfg, `esteira.json sem '${campo}'`);
  }
  assert.match(cfg.wt_root, /^[A-Za-z]:\/[^/]+\/[^/]+/, 'wt_root precisa de ≥2 segmentos abaixo do drive');
});
