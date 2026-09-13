#!/usr/bin/env node
/**
 * Gera `docs/design/paises.json`: a lista de países para o seletor de DDI do chat (issue #46,
 * decisão do dono no briefing #41 — "lista vinda da libphonenumber, nomes em pt-BR"). Roda uma
 * vez, o artefato commitado é o que o `<script>` do chat consome — nada digitado à mão (LEI 2).
 *
 * Fonte dos códigos de discagem (DDI): `libphonenumber-js` (devDependency só deste script — nunca
 * roda em produção, `pyproject.toml`/runtime continuam zero-dependência, ADR-0004). Fonte do nome
 * do país em português: `Intl.DisplayNames` da própria stdlib do Node (zero dependência extra). A
 * bandeira é derivada matematicamente do código ISO-3166 alpha-2 (par de Regional Indicator
 * Symbols do Unicode) — não é dado de terceiro, é aritmética sobre o próprio ISO já obtido.
 *
 * Uso: `node scripts/gerar-paises-whatsapp.mjs` (escreve `docs/design/paises.json`).
 */
import { getCountries, getCountryCallingCode } from 'libphonenumber-js'
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SAIDA = join(__dirname, '..', 'docs', 'design', 'paises.json')

function bandeira(iso2) {
  // Regional Indicator Symbol Letter A = U+1F1E6; 'A'.charCodeAt(0) = 65 — cada letra do ISO
  // vira o símbolo correspondente, os dois juntos formam o emoji da bandeira (padrão Unicode,
  // não uma tabela de bandeiras baixada de algum lugar).
  return [...iso2.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join('')
}

function gerar() {
  const nomes = new Intl.DisplayNames(['pt-BR'], { type: 'region' })
  const paises = getCountries()
    .map((iso) => ({
      iso,
      nome: nomes.of(iso),
      ddi: Number(getCountryCallingCode(iso)),
      bandeira: bandeira(iso),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'node_modules', 'libphonenumber-js', 'package.json'), 'utf8'))
  const saida = {
    _origem: `libphonenumber-js ${pkg.version} (npm) + Intl.DisplayNames(['pt-BR']) do Node — gerado por scripts/gerar-paises-whatsapp.mjs em ${new Date().toISOString().slice(0, 10)}`,
    paises,
  }
  writeFileSync(SAIDA, JSON.stringify(saida, null, 2) + '\n', 'utf8')
  console.log(`gerado: ${SAIDA} (${paises.length} países)`)
}

gerar()
