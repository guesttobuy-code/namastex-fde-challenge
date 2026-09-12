/**
 * despir-python.mjs — DONO ÚNICO (LEI 11) de "apagar comentário/string Python preservando índice e
 * linha", para quem precisa CONTAR padrões em código Python sem contar o que está dentro de comentário
 * ou string — o mesmo papel que `despir-codigo.mjs` cumpre para JS/TS, com dono separado porque a
 * sintaxe (aspas triplas, `#` de comentário) é outra (R6, 2026-09-11 — perfil de stack Python do kit).
 *
 * Heurística, não um parser Python completo (mesmo espírito de `despir-codigo.mjs`): reconhece
 * comentário de linha (`# ...` até `\n`), string TRIPLA (`'''…'''`/`"""…"""`, pode atravessar linha) e
 * string simples (`'…'`/`"…"`, `\` escapa o caractere seguinte, não atravessa `\n` sem barra antes dele).
 * Comprimento SEMPRE preservado: cada byte apagado vira um espaço (menos `\n`, que fica `\n`) — o índice
 * do resultado mapeia 1:1 pro original, como `despirCodigo`.
 *
 * O QUE NÃO VÊ: f-strings com `{expressão}` — o conteúdo dentro de `{}` é tratado como parte da string
 * (apagado); r-strings/b-strings (prefixo antes da aspa) são reconhecidas como string normal a partir da
 * aspa (o prefixo antes fica como código, o que é inofensivo pra quem só conta `def test_`).
 */

function ehAspaTripla(s, i, aspa) {
  return s[i] === aspa && s[i + 1] === aspa && s[i + 2] === aspa;
}

/** @param {string} fonte @returns {string} mesmo comprimento, comentário/string viram espaço (menos `\n`). */
export function despirPython(fonte) {
  const s = String(fonte ?? '');
  const n = s.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = s[i];

    if (c === '#') {
      while (i < n && s[i] !== '\n') { out += ' '; i++; }
      continue;
    }

    if ((c === '"' || c === "'") && ehAspaTripla(s, i, c)) {
      out += '   '; i += 3;
      while (i < n && !ehAspaTripla(s, i, c)) { out += s[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '   '; i += 3; } else { /* string tripla não fechada até o fim do arquivo */ }
      continue;
    }

    if (c === '"' || c === "'") {
      const aspa = c;
      out += ' '; i++;
      while (i < n && s[i] !== aspa && s[i] !== '\n') {
        if (s[i] === '\\' && i + 1 < n) { out += '  '; i += 2; continue; }
        out += ' '; i++;
      }
      if (i < n && s[i] === aspa) { out += ' '; i++; } // fechou normal
      // se parou em '\n' ou fim de arquivo sem fechar: string mal-formada, segue do jeito que está (fail-open)
      continue;
    }

    out += c;
    i++;
  }
  return out;
}
