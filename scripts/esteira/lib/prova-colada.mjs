/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: corpo de PR que NARRA resultado sem COLAR a saída passou por prova três vezes
 *   numa semana na esteira de origem — "dumps SUBIRAM" com zero uploads no log; "idempotente" no
 *   changelog com o caminho idempotente saindo antes do bloco novo; LOC digitados diferentes dos
 *   reais. Em todos, prosa com verbo de resultado e nenhum bloco de saída; o CI verde não olha o
 *   corpo. Refino 2 (auditoria externa): UM bloco irrelevante lavava a seção inteira; aspas,
 *   título `##` e "funcionou — não inclui X" compravam isenção. Tudo fechado aqui.
 *
 * O QUE ESTA LIB DECIDE (funções PURAS — sem gh, sem fs): `julgarCorpo(body)` aplica 3 regras de
 *   FORMATO: (1) seção de prova com ≥1 bloco de saída NÃO-vazio; (2) seção "O que NÃO verifiquei"
 *   com ≥1 item; (3) cada frase com palavra-quente exige um bloco ADJACENTE (logo abaixo, com no
 *   máximo 1 linha de introdução; ou logo acima, sem prosa entre) e CADA BLOCO PROVA UMA FRASE SÓ.
 *   Negação isenta só o que vem depois dela na mesma oração. Citação vai em blockquote.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. frase-quente sem bloco de saída ao lado;
 *   2. corpo sem seção de prova com bloco — prova narrada não é prova;
 *   3. corpo sem "O que NÃO verifiquei" — limite omitido é teatro;
 *   4. bloco VAZIO contar como saída;
 *   5. UM bloco lavar a seção inteira;
 *   6. aspas, título `##` ou "— não inclui X" comprarem isenção.
 *
 * LIMITE CONHECIDO: julga FORMATO, não verdade — a verdade é da auditoria (passo 4), que
 *   re-executa. A lista de palavras-quentes é curta de propósito e cresce por incidente, com caso
 *   no self-test. Só `## ` abre seção. Identificador em crases sem espaço não é claim; frase é.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const R = Object.freeze({
  CLAIM_SEM_BLOCO: 'CLAIM_SEM_BLOCO',
  SEM_BLOCO_DE_PROVA: 'SEM_BLOCO_DE_PROVA',
  SEM_NAO_VERIFIQUEI: 'SEM_NAO_VERIFIQUEI',
});

export function normalizarTitulo(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[*_`#]/g, '').trim();
}

export const RE_SECAO_PROVA = /\b(prova|proof|refuta|evidenc)/;
export const RE_SECAO_NAO_VERIFIQUEI = /((nao|not)\s+(verifi|verified|checked|tested|testei)|limites?\s+(declarad|conhecid)|o que (nao|not)\s)/;

export const RE_CLAIM = /\b(subiu|subiram|funcion(a|am|ou|aram|ando)|idempotente|backfill|aplicad[ao]s?\s+(em|na|no|nas|nos)\s+(prod\w*|staging|homolog\w*)|em\s+produ[cç][aã]o|(rodou|roda|rodaram)\s+com\s+sucesso|com\s+sucesso)\b/i;
const RE_CLAIM_G = new RegExp(RE_CLAIM.source, 'gi');
const RE_CLAIM_SUBSTANTIVO = /^(idempotente|backfill)$/i;
// "nunca funcionou" é a linha de regressão do fecho ("defeito que nunca funcionou") — declaração, não claim.
export const RE_NEGATIVA = /\b((n[aã]o|nunca)\s+(rod(ei|ado|ada|amos|ou)|verifi(quei|cado|cada|ca)|aplic[aá]vel|test(ei|ado|ada|a)|medi|medido|medida|cobre|pega|conserta|inclui|entra|faz|funcion\w*|subiu|subiram)|n\/a|nao\s+aplicavel)\b/i;

export function ehDeclaracaoNegativa(linha) { return RE_NEGATIVA.test(String(linha || '')); }

const RE_ORACAO = /\s[—–]\s|;\s|\.\s|\s-\s/;

export function textoSemIdentificadores(texto) { return String(texto || '').replace(/`[^`\s]+`/g, ' '); }

export function achaClaim(texto) {
  const t = textoSemIdentificadores(texto);
  if (/^\s*>/.test(t)) return null;
  if (/^\s*<!--[\s\S]*-->\s*$/.test(t)) return null;
  const oracoes = t.split(RE_ORACAO);
  for (let i = 0; i < oracoes.length; i++) {
    const oracao = oracoes[i];
    const neg = oracao.match(RE_NEGATIVA);
    const negProxima = (oracoes[i + 1] || '').match(RE_NEGATIVA);
    const proximaComecaNegando = Boolean(negProxima) && negProxima.index <= 12;
    RE_CLAIM_G.lastIndex = 0;
    let m;
    while ((m = RE_CLAIM_G.exec(oracao)) !== null) {
      if (neg && neg.index < m.index) continue;
      if (RE_CLAIM_SUBSTANTIVO.test(m[0]) && proximaComecaNegando) continue;
      return m[0];
    }
  }
  return null;
}

export function extrairSecoes(body) {
  const linhas = String(body || '').split(/\r?\n/);
  const secoes = [{ titulo: '', inicio: 1, linhas: [], blocos: [] }];
  let cerca = null;
  let comentario = false; // dentro de <!-- ... --> multilinha (instrução de template): nem prosa, nem claim
  linhas.forEach((texto, i) => {
    const n = i + 1;
    const cur = secoes[secoes.length - 1];
    if (comentario) { if (/-->/.test(texto)) comentario = false; return; }
    if (/<!--/.test(texto) && !/-->/.test(texto)) { comentario = true; return; }
    const f = texto.match(/^\s*(```+|~~~+)/);
    if (f) {
      const ch = f[1][0];
      if (!cerca) { cerca = { char: ch, linhaInicio: n, linhas: [] }; return; }
      if (cerca.char === ch) { cur.blocos.push({ linhaInicio: cerca.linhaInicio, linhaFim: n, linhas: cerca.linhas }); cerca = null; return; }
    }
    if (cerca) { if (texto.trim() !== '') cerca.linhas.push(texto); return; }
    const h = texto.match(/^##\s+(.+?)\s*$/);
    if (h) { secoes.push({ titulo: h[1], inicio: n, linhas: [{ n, texto: h[1], titulo: true }], blocos: [] }); return; }
    cur.linhas.push({ n, texto });
  });
  if (cerca) secoes[secoes.length - 1].blocos.push({ linhaInicio: cerca.linhaInicio, linhaFim: linhas.length, linhas: cerca.linhas });
  return secoes;
}

const temBlocoNaoVazio = (s) => s.blocos.some((b) => b.linhas.length > 0);
const ehComentarioHtml = (texto) => /^\s*<!--[\s\S]*-->\s*$/.test(texto);
// Marcador de lista sem texto ("-", "*", "- [ ]") é o template vazio, não um item.
const ehMarcadorVazio = (texto) => /^\s*([-*+]|\d+\.)(\s*\[\s*[xX ]?\s*\])?\s*$/.test(texto);
const ehProsa = (l) => !l.titulo && l.texto.trim() !== '' && !ehComentarioHtml(l.texto) && !ehMarcadorVazio(l.texto);

export function blocoAdjacente(l, s, blocos) {
  const prosaEntre = (a, b) => s.linhas.filter((x) => x.n > a && x.n < b && ehProsa(x)).length;
  const abaixo = blocos.filter((b) => !b.usado && b.linhaInicio > l.n && prosaEntre(l.n, b.linhaInicio) <= 1).sort((a, b) => a.linhaInicio - b.linhaInicio)[0];
  if (abaixo) return abaixo;
  const acima = blocos.filter((b) => !b.usado && b.linhaFim < l.n && prosaEntre(b.linhaFim, l.n) === 0).sort((a, b) => b.linhaFim - a.linhaFim)[0];
  return acima || null;
}

export function julgarCorpo(body) {
  const secoes = extrairSecoes(body);
  const faltas = [];
  for (const s of secoes) {
    if (RE_SECAO_NAO_VERIFIQUEI.test(normalizarTitulo(s.titulo))) continue;
    const blocos = s.blocos.filter((b) => b.linhas.length > 0).map((b) => ({ ...b, usado: false }));
    for (const l of s.linhas) {
      if (l.texto.trim() === '') continue;
      const claim = achaClaim(l.texto);
      if (!claim) continue;
      const bloco = blocoAdjacente(l, s, blocos);
      if (bloco) { bloco.usado = true; continue; }
      faltas.push({
        regra: R.CLAIM_SEM_BLOCO, linha: l.n, trecho: (l.titulo ? `## ${l.texto}` : l.texto).trim().slice(0, 120),
        motivo: `frase de resultado ("${claim}") sem bloco de saída AO LADO na seção "${s.titulo || '(preâmbulo)'}" — cole o comando e a saída literal entre crases triplas logo abaixo desta frase (um bloco prova uma frase só), ou escreva "não rodei/não verifiquei" antes dela, ou cite em blockquote (> …)`,
      });
    }
  }
  const prova = secoes.filter((s) => RE_SECAO_PROVA.test(normalizarTitulo(s.titulo)));
  if (!prova.some(temBlocoNaoVazio)) {
    faltas.push({
      regra: R.SEM_BLOCO_DE_PROVA, linha: prova[0] ? prova[0].inicio : 1, trecho: prova[0] ? `## ${prova[0].titulo}` : '(sem seção de prova)',
      motivo: prova[0]
        ? 'a seção de prova existe mas não tem nenhum bloco de saída não-vazio — prova narrada não é prova; cole a saída do comando'
        : 'falta uma seção "Prova executada" (ou "Prova de refutação") com pelo menos um bloco de saída colada',
    });
  }
  const nv = secoes.filter((s) => RE_SECAO_NAO_VERIFIQUEI.test(normalizarTitulo(s.titulo)));
  if (!nv.some((s) => s.linhas.some(ehProsa))) {
    faltas.push({
      regra: R.SEM_NAO_VERIFIQUEI, linha: nv[0] ? nv[0].inicio : 1, trecho: nv[0] ? `## ${nv[0].titulo}` : '(sem seção)',
      motivo: nv[0]
        ? 'a seção "O que NÃO verifiquei" está vazia — limite omitido é teatro; escreva ao menos um item (ou "nada além do diff: cobri X, Y, Z")'
        : 'falta a seção "O que NÃO verifiquei (e por quê)" — declarar o limite é obrigatório',
    });
  }
  faltas.sort((a, b) => a.linha - b.linha);
  return { ok: faltas.length === 0, faltas, secoes };
}
