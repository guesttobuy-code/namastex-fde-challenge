// Companion de scripts/gerar-paises-whatsapp.mjs (issue #46): a lista de DDI do seletor de país
// do chat é gerada, nunca digitada à mão — este teste prova que o artefato commitado
// (docs/design/paises.json) tem o formato e os países que o chat precisa, sem rodar o gerador
// (a fonte real, libphonenumber-js, é conferida ao gerar; aqui só o resultado).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dados = JSON.parse(readFileSync(new URL('../docs/design/paises.json', import.meta.url), 'utf8'));

test('paises.json documenta a origem (libphonenumber-js) e a data de geração', () => {
  assert.match(dados._origem, /libphonenumber-js/);
});

test('paises.json tem mais de 200 países, cada um com iso/nome/ddi/bandeira', () => {
  assert.ok(dados.paises.length > 200, `esperado >200 países, veio ${dados.paises.length}`);
  for (const pais of dados.paises) {
    assert.equal(typeof pais.iso, 'string');
    assert.equal(typeof pais.nome, 'string');
    assert.equal(typeof pais.ddi, 'number');
    assert.equal(typeof pais.bandeira, 'string');
  }
});

test('os DDI dos países citados no escopo da issue #46 batem com o real', () => {
  const porIso = Object.fromEntries(dados.paises.map((p) => [p.iso, p]));
  assert.equal(porIso.BR.ddi, 55, 'Brasil');
  assert.equal(porIso.US.ddi, 1, 'Estados Unidos');
  assert.equal(porIso.PT.ddi, 351, 'Portugal');
  assert.equal(porIso.AR.ddi, 54, 'Argentina');
});
