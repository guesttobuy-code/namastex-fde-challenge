/**
 * despirCodigo(fonte) → mesma string, mas com COMENTÁRIOS (de linha e de bloco), STRINGS
 * ('...', "...", crase) E LITERAIS REGEX (/.../ ) substituídos por espaços, PRESERVANDO comprimento
 * e quebras de linha.
 *
 * POR QUE EXISTE: um scanner de padrão de código (empty-catch, dead-code, …) que casa texto cru
 * se AUTO-ACUSA (o padrão aparece na própria certidão/fixtures) e dá falso-positivo quando o padrão
 * aparece num comentário/string. O comprimento é preservado pra que o índice do match mapeie de volta
 * ao ORIGINAL (nº de linha e checagem de marcadores no texto real).
 *
 * POR QUE REGEX IMPORTA (achado da auditoria do empty-catch): um literal `/'/` ou `/"/` tem uma ASPA
 * dentro; sem tratar regex, o scanner entraria em estado de string na aspa de dentro da regex e NUNCA
 * fecharia — apagando o resto do arquivo e ESCONDENDO um catch vazio a jusante (falso-negativo mudo).
 * Aqui `/` é regex ou divisão pelo token anterior (heurística padrão de lexer JS): depois de operador/
 * pontuação/palavra-chave é regex; depois de identificador/`)`/número/string é divisão.
 *
 * DUAS PROTEÇÕES contra a heurística se enganar e APAGAR código de verdade (achado da auditoria do
 * await-unhandled, classe do HOLE-1): (1) uma palavra-chave PRECEDIDA de `.` é PROPRIEDADE, não keyword —
 * `stats.in / n`, `map.of / n`, `cache.delete / n` são DIVISÃO, não início de regex (senão o `/` abriria
 * uma "regex" que corre até o fim do arquivo apagando o código a jusante); (2) uma regex literal NÃO cruza
 * quebra de linha — se o estado 'regex' chega a um `\n`, o `/` era divisão: aborta pro 'code' e limita o
 * estrago àquela linha (nunca ao arquivo inteiro).
 *
 * LIMITE: heurística, não parser. Uma regex literal logo depois de `)` (ex.: `if (x) /re/.test(y)`) é
 * lida como divisão, então o CONTEÚDO dela vaza como código — pode gerar um match falso RARO (distinguir
 * exige saber se o `)` fecha um `if/while` ou uma expressão — coisa de parser); um `${...}` com crase é
 * tratado como string opaca (código dentro da interpolação some). Fora esses casos declarados, só APAGA.
 */

// tail já vem sem espaços à direita relevantes; decide se um `/` inicia um literal regex.
function ehInicioRegex(tail) {
  const t = tail.replace(/\s+$/, '');
  if (t === '') return true;
  const c = t[t.length - 1];
  if ('([{,;:=!&|?+-*/%~^<>'.includes(c)) return true;
  // Palavra-chave que inicia regex — MAS não se vier precedida de `.` (aí é PROPRIEDADE: `stats.in`,
  // `map.of`, `cache.delete` → o `/` seguinte é DIVISÃO, não regex). O `.` entra na classe negada.
  return /(?:^|[^\w$.])(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|throw)$/.test(t);
}

/** FUNÇÃO PURA: índice do fecho de `abre` por profundidade balanceada (`{`→`}` por padrão, ou `ini`/`fim`
 *  dados — ex.: `(`→`)`), ou -1 se `s` acaba sem fechar. DONO ÚNICO: quem extrai um bloco delimitado por
 *  par balanceado (corpo de catch, parâmetro entre parênteses, …) usa esta, não reinventa a contagem. */
export function fechar(s, abre, ini = '{', fim = '}') {
  let prof = 0;
  for (let i = abre; i < s.length; i++) {
    if (s[i] === ini) prof++;
    else if (s[i] === fim) { prof--; if (prof === 0) return i; }
  }
  return -1;
}

/**
 * FUNÇÃO PURA: despirMarkdown(texto) → mesmo texto, mas com (1) blocos `<!-- … -->`, (2) blocos de código
 * cercados por ``` ou ~~~ (INCLUINDO as linhas da cerca) e (3) code spans `` `…` `` DE UMA LINHA trocados
 * por espaço — preservando `\n` (o número da linha não muda). O BOM inicial (se houver) é REMOVIDO (não
 * substituído: não é `\n`, não desloca a contagem de linha).
 *
 * POR QUE EXISTE: é o que o Claude Code (e um scanner de padrão de texto) NÃO leem como texto normal — um
 * comentário HTML, um bloco de código cercado ou um code-span citando um padrão (ex.: um "BYPASS: catch
 * vazio" dentro de um ```exemplo``` de documentação) não pode contar como o padrão estando "no texto real".
 *
 * LIMITE (heurística, não parser CommonMark): a cerca de abertura é reconhecida por estar no início de
 * linha (ignorando indentação) com 3+ do MESMO caractere (` ou ~); a de fechamento é a primeira linha
 * seguinte, sozinha (só espaço + o caractere, em quantidade ≥ à de abertura) — sem cerca de fechamento,
 * consome até o fim do texto (igual comentário de bloco sem `-->`). Code span é APENAS o par de UM
 * backtick (não trata o duplo-backtick `` `` usado pra citar um backtick literal) e nunca cruza `\n`.
 */
export function despirMarkdown(texto) {
  let s = String(texto ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1); // BOM inicial: removido (não é \n, não desloca linha)
  const n = s.length;
  const out = [];
  const branco = (ch) => out.push(ch === '\n' ? '\n' : ' ');
  const inicioDeLinha = (i) => { let k = i; while (k > 0 && s[k - 1] !== '\n') k--; return s.slice(k, i).trim() === ''; };
  let i = 0;
  while (i < n) {
    if (s.startsWith('<!--', i)) {
      const f = s.indexOf('-->', i + 4);
      const fim = f < 0 ? n : f + 3;
      for (let k = i; k < fim; k++) branco(s[k]);
      i = fim;
      continue;
    }
    if ((s[i] === '`' || s[i] === '~') && inicioDeLinha(i)) {
      const marca = s[i];
      let j = i;
      while (j < n && s[j] === marca) j++;
      const tam = j - i;
      if (tam >= 3) {
        let fimAbre = s.indexOf('\n', j);
        fimAbre = fimAbre < 0 ? n : fimAbre;
        let cursor = fimAbre < n ? fimAbre + 1 : n;
        let fimBloco = n; // sem fechamento → consome até o fim (igual comentário de bloco sem -->)
        while (cursor <= n) {
          let fimLinha = s.indexOf('\n', cursor);
          fimLinha = fimLinha < 0 ? n : fimLinha;
          const linha = s.slice(cursor, fimLinha).trim();
          if (linha.length >= tam && [...linha].every((c) => c === marca)) { fimBloco = fimLinha; break; }
          if (fimLinha >= n) { fimBloco = n; break; }
          cursor = fimLinha + 1;
        }
        for (let k = i; k < fimBloco; k++) branco(s[k]);
        i = fimBloco;
        continue;
      }
    }
    if (s[i] === '`') {
      let fimLinha = s.indexOf('\n', i);
      fimLinha = fimLinha < 0 ? n : fimLinha;
      const fecho = s.indexOf('`', i + 1);
      if (fecho >= 0 && fecho < fimLinha) {
        for (let k = i; k <= fecho; k++) branco(s[k]);
        i = fecho + 1;
        continue;
      }
    }
    out.push(s[i]);
    i++;
  }
  return out.join('');
}

export function despirCodigo(fonte) {
  const s = String(fonte ?? '');
  const out = [];
  let st = 'code'; // code | line | block | sq | dq | tpl | regex | class
  let tail = '';   // últimos chars de CÓDIGO real emitido (com espaços), pra decidir / regex vs divisão
  const codigo = (ch) => { out.push(ch); tail = (tail + ch).slice(-16); };
  const branco = (ch) => out.push(ch === '\n' ? '\n' : ' ');
  const fechou = (marca) => { tail = (tail + marca).slice(-16); }; // string/regex fechada = token não-operador
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = i + 1 < s.length ? s[i + 1] : '';
    if (st === 'code') {
      if (c === '/' && n === '/') { branco(c); branco(n); i++; st = 'line'; }
      else if (c === '/' && n === '*') { branco(c); branco(n); i++; st = 'block'; }
      else if (c === '/' && ehInicioRegex(tail)) { branco(c); st = 'regex'; }
      else if (c === "'") { branco(c); st = 'sq'; }
      else if (c === '"') { branco(c); st = 'dq'; }
      else if (c === '`') { branco(c); st = 'tpl'; }
      else codigo(c);
    } else if (st === 'line') {
      if (c === '\n') { out.push('\n'); st = 'code'; } else out.push(' ');
    } else if (st === 'block') {
      if (c === '*' && n === '/') { branco(c); branco(n); i++; st = 'code'; } else branco(c);
    } else if (st === 'regex') {
      if (c === '\n') { out.push('\n'); st = 'code'; } // regex não cruza linha → o `/` era divisão; aborta (limita o estrago à linha)
      else if (c === '\\') { branco(c); if (n) { branco(n); i++; } }
      else if (c === '[') { branco(c); st = 'class'; }
      else if (c === '/') { branco(c); fechou('r'); st = 'code'; }
      else branco(c);
    } else if (st === 'class') { // dentro de [...] de uma regex, `/` não fecha
      if (c === '\n') { out.push('\n'); st = 'code'; } // idem: [...] de regex também não cruza linha
      else if (c === '\\') { branco(c); if (n) { branco(n); i++; } }
      else if (c === ']') { branco(c); st = 'regex'; }
      else branco(c);
    } else { // sq | dq | tpl
      const fim = st === 'sq' ? "'" : st === 'dq' ? '"' : '`';
      if (c === '\\') { branco(c); if (n) { branco(n); i++; } }
      else if (c === fim) { branco(c); fechou('s'); st = 'code'; }
      else branco(c);
    }
  }
  return out.join('');
}
