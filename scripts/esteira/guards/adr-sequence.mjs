#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: ADR é registro permanente (LEI DO REGISTRO) e é referenciado por NÚMERO (#ADR-0003,
 *   "substituída por ADR-0007"): se dois ADRs nascerem com o MESMO número, ou se um número sumir da
 *   sequência (deletado, renumerado à mão, merge de duas frentes que escolheram o mesmo próximo número),
 *   a referência cruzada aponta para o registro ERRADO ou para nada — e ninguém percebe até procurar.
 *   Este guard é o dono único da integridade MECÂNICA da numeração — não do conteúdo da decisão.
 *
 * O QUE FAZ: em `<dir>/governance/adr` (--dir, ou cwd), lê todo arquivo `.md` (caixa insensível na
 *   extensão). Quem casa `^(\d{3,6})-.+\.md$` (extensão em minúscula; o kit usa 4 dígitos, a LEI aqui
 *   exige "3 a 6" — largura maior vira nome-fora-do-padrao, não trava o guard) vira candidato a ADR
 *   (o `0000-template.md` CONTA como número 0 — é o modelo, mas ocupa um número). Reprova:
 *   (1) `numero-duplicado` — dois arquivos com o MESMO número (valor, não largura: `002-x.md` e
 *   `0002-y.md` colidem); (2) `buraco` — falta algum inteiro entre o piso (1, ou 0 se o próprio 0
 *   existir) e o maior número presente; (3) `adr-sem-status` — ADR de número > 0 sem a linha de Status
 *   (0000, o molde, é isento); (4) `nome-fora-do-padrao` — `.md` na pasta que não casa o padrão acima e
 *   não está na lista permitida (README.md, index.md); (5) `titulo-diverge-do-nome` — o `# ADR-N` do
 *   corpo do arquivo diverge do número do NOME do arquivo (0000 isento); (6) `pasta-adr-ausente` —
 *   `governance/adr` não existe, mas a pasta `--dir` tem cara de projeto da esteira (`esteira.json`,
 *   `.arch-layers.json` ou uma pasta `governance/` sem `adr` dentro): o registro inteiro sumiu, não é
 *   "nada a medir". Se `--dir` não é sequer um projeto da esteira e `governance/adr` não existe →
 *   NAO_APLICAVEL, exit 0.
 *
 * RN-C5 (ADR-0004, "Dono único da numeração"): quando `--dir/governance/RESERVAS.json` liga um tipo
 *   (`tipos.<t>.dir`, relativo, resolvido) que aponta EXATAMENTE para a pasta de ADR aqui medida, este
 *   guard CEDE a numeração — não julga `buraco` nem `numero-duplicado` (imprime que a numeração é do
 *   `reserva-de-numero`) e segue julgando o resto (`nome-fora-do-padrao`, `adr-sem-status`,
 *   `titulo-diverge-do-nome`) normalmente. Sem `RESERVAS.json`, com o tipo desligado (`dir: null`) ou
 *   ligado a OUTRA pasta, ou com `RESERVAS.json` malformado/JSON inválido: comportamento de hoje, sem
 *   inventar — este guard volta a ser o único dono de buraco/duplicata.
 *
 * O QUE NUNCA MAIS PODE PASSAR:
 *   1. dois ADRs com o mesmo número (`numero-duplicado`);
 *   2. sequência com buraco entre o piso (1, ou 0 quando 0 existe) e o maior número presente (`buraco`);
 *   3. ADR (número > 0) sem a linha `- **Status:**` (aceitando `[-*+]`, dois-pontos dentro/fora do
 *      negrito e caixa livre — `adr-sem-status`);
 *   4. `.md` na pasta fingindo não ser ADR pra escapar da varredura — renomear, trocar hífen por `_`,
 *      prefixar `ADR-`, brincar de maiúscula na extensão ou de caractere invisível no nome
 *      (`nome-fora-do-padrao`);
 *   5. ADR cujo título (`# ADR-N`) diz um número diferente do nome do arquivo (`titulo-diverge-do-nome`);
 *   6. `governance/adr` inteira apagada de um projeto que claramente é da esteira, ou `--dir` que não é
 *      uma pasta, virando "nada a medir" em vez de reprovação/NÃO MEDIU (`pasta-adr-ausente`).
 *
 * INCIDENTE DE ORIGEM: preventivo — decisão do dono 2026-09-11 (ADR-0003, #21).
 *
 * O QUE ESTE GUARD **NÃO** VÊ: (a) o VALOR do Status — só a PRESENÇA da linha no formato decidido;
 *   `- **Status:** banana` passa; (b) se "substituída por ADR-NNNN" aponta para um ADR que existe de
 *   verdade (referência cruzada solta); (c) as outras seções do template (Contexto/Decisão/
 *   Consequências/Alternativas); (d) ADR numerado dentro de uma SUBPASTA de `governance/adr` — a
 *   convenção é lista plana, este guard não recursa; (e) uma linha de Status dentro de um bloco
 *   ```` ``` ```` de código ou de um comentário HTML `<!-- -->` ainda conta como presente — não faz
 *   parsing de Markdown, só regex de linha sobre o texto cru (decisão conservadora: nunca falso-positivo
 *   no núcleo); (f) Status sem NENHUM marcador de lista (`**Status:** solto) e front matter YAML
 *   (`status: accepted`) continuam REPROVADOS — a gramática aceita (ADR-05) só cobre `[-*+]` + negrito
 *   dentro/fora do dois-pontos + caixa livre, não "sem bullet" nem front matter (fora do que o
 *   coordenador decidiu na Rodada 1); (g) `--dir` apontando para a pasta-mãe ERRADA (ex.: `<raiz>/governance`
 *   em vez de `<raiz>`, com `governance/adr` um nível acima de onde o guard está olhando) continua
 *   NAO_APLICAVEL — detectar "raiz errada" exigiria subir a árvore, fora do escopo desta rodada
 *   (resíduo declarado de ADR-07/H3); (h) RN-C5: com o tipo ligado (reserva cedida), este guard NÃO
 *   enxerga buraco nem duplicata NENHUMA — nem a inofensiva (frentes paralelas) nem a real (dois arquivos
 *   com o mesmo número); quem cobre as duas nesse cenário é o `reserva-de-numero` (dono único da
 *   numeração — ADR-0004), não este guard.
 *   LIMITE DECLARADO (ADR-03): o portão "passa no limpo" do `minefield` (`referencia/limpo`) é vazio
 *   para este guard porque essa árvore não tem `governance/adr` — e `referencia/limpo` é um recurso
 *   COMPARTILHADO pelos 8 guards da Rodada 1, fora do escopo desta reconciliação (só posso tocar
 *   `scripts/guards/adr-sequence.mjs` e a mina `referencia/minado/adr-sequence/`). A prova real de "não
 *   reprova árvore sã" vem do self-test PORTA (spawn real contra árvore tmp com sequência legítima
 *   0000..0003, e — quando disponível — o próprio `governance/adr` deste kit), não do minefield.
 *   LIMITE DECLARADO (ADR-06): `docs/MODELO-PADRAO-DE-PROJETO.md:32` manda ADRs para
 *   `docs/ADR/ADR-NNN-<titulo>.md`, grafia que este guard não vigia (ele vigia `governance/adr/NNNN-*`,
 *   alinhado com ADR-0003 e `DOCS_OBRIGATORIOS.json`). A correção do texto do MODELO fica para a R4
 *   (cabeamento, fora do escopo de um guard individual) — até lá, um projeto que siga o MODELO ao pé da
 *   letra usa uma grafia que o ADR-01 (acima) já reprova como `nome-fora-do-padrao` em vez de ignorar,
 *   mas o guard segue olhando só `governance/adr`.
 *
 * MODO DE FALHA JÁ ESCAPADO (auditoria adversarial 2026-09-11, 8/8 achados FURADO — consertados nesta
 *   rodada, exceto os dois declarados acima):
 *   - ADR-01: `.md` fora do padrão era ignorado em silêncio — duplicata escondida atrás de um nome
 *     diferente, ADR mais alto renomeado, caractere invisível/BOM no nome, extensão `.MD`, hífen trocado
 *     por `_`, prefixo `ADR-` — todos passavam exit 0. Agora viram `nome-fora-do-padrao` (ou, quando o
 *     invisível apenas mascarava um nome já existente, `numero-duplicado` de verdade).
 *   - ADR-02: número sem teto — `parseInt` perdia precisão acima de 2^53 e o laço de buraco trava(va)
 *     (n++ deixa de avançar) ou despejava centenas de MB em stderr (convenção de data `YYYYMMDD`).
 *     `RE_ADR` agora exige 3 a 6 dígitos; fora disso, vira `nome-fora-do-padrao` — sem laço, sem trava.
 *   - ADR-03: o portão de "não reprova árvore sã" do minefield era vazio para este guard — ver LIMITE
 *     DECLARADO (ADR-03) acima.
 *   - ADR-04: o self-test não travava o FORMATO da linha de Status — uma regex frouxa (sem âncora de
 *     início de linha, ou sem exigir o marcador de lista) sobrevivia 24/24. A nova `RE_STATUS` exige
 *     `^` + marcador de lista antes do negrito, então "texto **Status:** x" no meio de um parágrafo não
 *     conta mais como presente.
 *   - ADR-05: grafias legítimas de Status — bullet `*`/`+`, dois-pontos fora do negrito, `status`
 *     minúsculo — davam falso-positivo (reprovavam ADR válido). `RE_STATUS` passou a aceitar as três
 *     variações (decisão do coordenador; "sem bullet" e front matter continuam fora, ver "NÃO VÊ" (f)).
 *   - ADR-06: divergência entre este guard e `docs/MODELO-PADRAO-DE-PROJETO.md:32` sobre onde ficam os
 *     ADRs — ver LIMITE DECLARADO (ADR-06) acima.
 *   - ADR-07: apagar `governance/adr` inteira, ou apontar `--dir` para um ARQUIVO, saíam exit 0
 *     (NAO_APLICAVEL) mesmo num projeto claramente da esteira. Agora: sinais de projeto (`esteira.json`,
 *     `.arch-layers.json`, ou `governance/` sem `adr` dentro) + pasta ausente → reprova
 *     (`pasta-adr-ausente`); `--dir` que existe mas não é pasta → NÃO MEDIU. "Raiz errada dentro de
 *     governance/" (H3) segue como limite declarado, ver "NÃO VÊ" (g).
 *   - ADR-08: (a) o número do TÍTULO (`# ADR-N`) nunca era conferido contra o nome do arquivo — um ADR
 *     renumerado que manteve o título antigo colado passava limpo; agora vira
 *     `titulo-diverge-do-nome`. (b) uma falha de leitura de arquivo virava `conteudo=''` no catch e o
 *     guard reportava "falta a linha Status" em vez de "não consegui medir" — `listarAdrs` agora deixa
 *     a falha de leitura propagar (exit 2 no rodapé), com leitor injetável para o self-test provar isso
 *     sem depender de ACL real.
 *   - RN-C5 (ADR-0004, #21, 2026-09-11): antes desta integração, `adr-sequence` e `reserva-de-numero`
 *     tinham os DOIS uma opinião sobre buraco/duplicata — em frentes paralelas isso reprovava a fusão
 *     inocente (buraco esperado, LEI 11 sem dono único). Agora o `adr-sequence` CEDE buraco e duplicata
 *     quando `governance/RESERVAS.json` liga um tipo à pasta de ADR medida (ver RN-C5 acima e "NÃO VÊ" (h));
 *     `nome-fora-do-padrao`, `adr-sem-status` e `titulo-diverge-do-nome` continuam sendo julgados aqui — a
 *     numeração muda de dono, o conteúdo não.
 *
 * BANCA — as 10 classes:
 *   BANCA: VAZIO — TRATADA: pasta ausente E `--dir` sem cara de projeto da esteira (sem `esteira.json`,
 *     `.arch-layers.json` ou `governance/`) → NAO_APLICAVEL/0 achados, nunca reprova por falta de
 *     entrada real (casos no self-test). Pasta ausente COM sinal de projeto da esteira → reprova
 *     (`pasta-adr-ausente`, ADR-07) — deixou de ser tratado como "vazio". `--dir` que existe mas não é
 *     uma pasta → NÃO MEDIU (exit 2), nunca 0.
 *   BANCA: STRING/COMENTÁRIO — NÃO SE APLICA: não há despir-de-código aqui; o alvo é Markdown de
 *     governança, não código-fonte de programação. Ver (e) em "O QUE NÃO VÊ".
 *   BANCA: IMPORT/PATH — NÃO SE APLICA: lê `--dir/governance/adr` direto via `readdirSync`; não segue
 *     import/alias; se a própria pasta for symlink/junction o SO resolve (não é decisão deste guard).
 *   BANCA: BASELINE — NÃO SE APLICA: sem allowlist de exceção além de README.md/index.md (ADR-01, lista
 *     curta e fixa no código, não configurável por arquivo externo); todo `.md` da pasta é medido, sempre.
 *   BANCA: RENOMEAR — TRATADA (reforçada por ADR-01): renomear um ADR pra perder o prefixo numérico
 *     (fugir da varredura) não esconde mais nada em silêncio — o arquivo renomeado vira
 *     `nome-fora-do-padrao` DIRETAMENTE, e o número que ele representava ainda pode virar `buraco`
 *     separadamente. Isso fecha os casos de borda que só viravam buraco quando o número sumido estava no
 *     MEIO da sequência (o `numero-duplicado`/`nome-fora-do-padrao` cobre as bordas — maior número,
 *     início da sequência via o piso mínimo 1). Trocar o número de dois arquivos entre si não muda o
 *     CONJUNTO de números presentes — não é ataque a este guard (é reautoria, não reforma de contagem).
 *   BANCA: INVISÍVEL — TRATADA: o NOME do arquivo é normalizado (NFKC + remove `U+200B..U+200D`/`U+FEFF`)
 *     ANTES de julgar `.md`/`RE_ADR` — um caractere invisível colado no nome não tira mais o arquivo da
 *     contagem: ou ele revela um nome que já existe (`numero-duplicado`, de verdade) ou um nome que não
 *     casa nada (`nome-fora-do-padrao`). Dentro do CONTEÚDO, quebra de linha CRLF é aceita (`\r?\n`); um
 *     invisível colado NA PALAVRA "Status" quebra o match e o guard erra para o lado SEGURO (reprova
 *     pedindo a linha), nunca aprova por engano.
 *   BANCA: NULO — TRATADA: `conteudo` `null`/`undefined`/vazio em ADR de número > 0 vira `String(...)` ''
 *     → a checagem de Status falha → `adr-sem-status` (nunca "sem violação"); lista de arquivos `null`/
 *     ausente (pasta ilegível) é NÃO MEDIU (exit 2), nunca 0 — e a falha de LEITURA de um arquivo
 *     individual (não a pasta inteira) também propaga em vez de virar `conteudo=''` mascarado
 *     (ADR-04/ADR-08b): mesma regra, aplicada no nível certo.
 *   BANCA: TRUNCADO/TAMANHO — NÃO SE APLICA: não há teto de tamanho aqui (ADR é prosa curta por
 *     natureza; `file-loc-ceiling` já cobre arquivo grande em geral). O teto em ADR-02 é de DÍGITOS do
 *     número (3–6), não de bytes do arquivo.
 *   BANCA: SUBSTITUIR — NÃO SE APLICA para a PORTA (roda o processo real via `spawnSync` contra árvores
 *     tmp reais). Para a falha de leitura de arquivo (ADR-04/ADR-08b), o leitor de `listarAdrs` É
 *     injetável (`{ ler }`, default `readFileSync`) — o self-test injeta um leitor que lança pra provar
 *     a propagação sem depender de ACL real do SO.
 *
 * CONTRA-PROVA: node scripts/guards/adr-sequence.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { ehEntrypoint, selfTestPedido } from '../lib/guard-doctrine.mjs';

const NOME = 'adr-sequence';
// número: 3 a 6 dígitos (o kit usa 4; a LEI aqui é "3 a 6" — ADR-02: acima disso, `parseInt` perde
// precisão e o laço de buraco trava/estoura memória, então nem tenta casar — vira nome-fora-do-padrao).
const RE_ADR = /^(\d{3,6})-.+\.md$/;
// linha de Status (ADR-05): marcador de lista [-*+] no INÍCIO da linha (âncora — ADR-04), dois-pontos
// dentro OU fora do negrito, "status" em qualquer caixa. CRLF é aceito via `\r?` implícito no `^`/`m`.
const RE_STATUS = /^[ \t]*[-*+][ \t]*\*\*status(:\*\*|\*\*:)/im;
// título do corpo (ADR-08a): "# ADR-<número>", número com zeros à esquerda opcionais.
const RE_TITULO = /^#\s*ADR-0*(\d+)\b/m;
// caracteres invisíveis que não podem esconder um nome de arquivo do julgamento (ADR-01/INVISÍVEL).
const RE_INVISIVEL = /[​-‍﻿]/g;
// `.md` solto que nunca é ADR, mesmo fora do padrão numérico (ADR-01) — lista curta, fixa no código.
const PERMITIDOS = new Set(['readme.md', 'index.md']);
export const fmt = (n) => String(n).padStart(4, '0');

/**
 * FUNÇÃO PURA: julga a sequência de ADRs. Entrada: array de `{nome, conteudo}` (todo arquivo `.md`
 * visto na pasta — quem não é `.md` é ignorado aqui dentro, não precisa ser pré-filtrado). Sem fs,
 * sem exit. Devolve array de achados: `{tipo, ...}`.
 * `reservaLigada` (RN-C5, ADR-0004): quando true, NÃO julga `numero-duplicado` nem `buraco` — esses dois
 * são do `reserva-de-numero` nesse cenário (dono único da numeração). Tudo o mais (`nome-fora-do-padrao`,
 * `adr-sem-status`, `titulo-diverge-do-nome`) continua julgado igual.
 */
export function julgarSequencia(arquivos, { reservaLigada = false } = {}) {
  const brutos = Array.isArray(arquivos) ? arquivos : [];
  const achados = [];
  const candidatos = [];

  for (const a0 of brutos) {
    const nomeBruto = String(a0?.nome ?? '');
    // ADR-01/INVISÍVEL: normaliza (NFKC) e tira zero-width/BOM ANTES de julgar — um invisível colado no
    // nome não pode mais tirar o arquivo da contagem em silêncio.
    const nomeJulgado = nomeBruto.normalize('NFKC').replace(RE_INVISIVEL, '');
    if (!/\.md$/i.test(nomeJulgado)) continue; // não é markdown — fora do escopo deste guard
    const m = RE_ADR.exec(nomeJulgado);
    if (!m) {
      if (!PERMITIDOS.has(nomeJulgado.toLowerCase())) {
        achados.push({ tipo: 'nome-fora-do-padrao', arquivo: nomeBruto });
      }
      continue; // não entra na contagem numérica — não é um ADR reconhecido
    }
    candidatos.push({ nome: nomeBruto, conteudo: a0?.conteudo, numero: parseInt(m[1], 10) });
  }

  if (candidatos.length === 0) return achados; // VAZIO/NULO: nada pra medir numericamente

  const porNumero = new Map();
  for (const c of candidatos) {
    if (!porNumero.has(c.numero)) porNumero.set(c.numero, []);
    porNumero.get(c.numero).push(c.nome);
  }
  // RN-C5: com a reserva ligada, buraco e duplicata são do reserva-de-numero — não deste guard.
  if (!reservaLigada) {
    for (const [numero, nomes] of [...porNumero.entries()].sort((a, b) => a[0] - b[0])) {
      if (nomes.length > 1) achados.push({ tipo: 'numero-duplicado', numero, arquivos: [...nomes].sort() });
    }

    const numeros = [...porNumero.keys()].sort((a, b) => a - b);
    // ADR-01/A2: a sequência começa em 0 (molde) ou 1 — se o menor presente for maior que 1, o piso do
    // buraco é 1 mesmo assim, pra não deixar "deletar os primeiros" passar batido.
    const piso = Math.min(numeros[0], 1);
    const teto = numeros[numeros.length - 1];
    const faltando = [];
    for (let n = piso; n <= teto; n++) if (!porNumero.has(n)) faltando.push(n);
    if (faltando.length > 0) achados.push({ tipo: 'buraco', faltando, min: piso, max: teto });
  }

  for (const c of candidatos) {
    if (c.numero === 0) continue; // molde: isento de Status e de título
    if (!RE_STATUS.test(String(c.conteudo ?? ''))) {
      achados.push({ tipo: 'adr-sem-status', numero: c.numero, arquivo: c.nome });
    }
    const mt = RE_TITULO.exec(String(c.conteudo ?? ''));
    if (mt) {
      const numeroTitulo = parseInt(mt[1], 10);
      if (numeroTitulo !== c.numero) {
        achados.push({ tipo: 'titulo-diverge-do-nome', arquivo: c.nome, numeroNome: c.numero, numeroTitulo });
      }
    }
  }

  return achados;
}

/** Lê `dirAdr` (arquivos .md diretos, sem recursão; extensão em CAIXA INSENSÍVEL — ADR-01/D1). Pasta
 *  ilegível → LANÇA (o rodapé converte em exit 2). Falha de leitura de um arquivo INDIVIDUAL também
 *  LANÇA — nunca vira `conteudo=''` mascarado (ADR-04/ADR-08b). `ler` é injetável para o self-test
 *  provar a propagação sem depender de ACL real do SO (BANCA: SUBSTITUIR). */
export function listarAdrs(dirAdr, { ler = readFileSync } = {}) {
  const entradas = readdirSync(dirAdr, { withFileTypes: true });
  const arquivos = [];
  for (const ent of entradas) {
    if (!ent.isFile() || !/\.md$/i.test(ent.name)) continue;
    const conteudo = ler(join(dirAdr, ent.name), 'utf8'); // falha PROPAGA — não consegui medir, não "sem violação"
    arquivos.push({ nome: ent.name, conteudo });
  }
  return arquivos;
}

/** ADR-07: `dir` "tem cara" de projeto da esteira o bastante pra que `governance/adr` ausente seja uma
 *  reprovação (o registro sumiu) em vez de "nada a medir". Sinal, não certeza — ver "NÃO VÊ" (g) pro
 *  limite (raiz errada dentro de governance/ não é detectada). */
function pareceProjetoDaEsteira(dir) {
  return existsSync(join(dir, 'esteira.json')) || existsSync(join(dir, '.arch-layers.json')) || existsSync(join(dir, 'governance'));
}

/** RN-C5 (ADR-0004): `dirRepoAbs/governance/RESERVAS.json` liga algum tipo cujo `dir` (relativo, resolvido)
 *  aponta EXATAMENTE para `dirAdrAbs`? JSON ausente/malformado, "tipos" ausente/não-objeto, `dir` ausente
 *  ou absoluto = false, SEM lançar — "config inválido segue o comportamento de hoje sem inventar" (não é
 *  este guard quem cobra a validade de RESERVAS.json; isso é do `reserva-de-numero`/`docs-required`). */
function numeracaoCedidaAoReservaDeNumero(dirRepoAbs, dirAdrAbs) {
  const configPath = join(dirRepoAbs, 'governance', 'RESERVAS.json');
  if (!existsSync(configPath)) return false;
  let config;
  try { config = JSON.parse(readFileSync(configPath, 'utf8')); } catch { return false; }
  const tipos = config && typeof config.tipos === 'object' && config.tipos !== null ? config.tipos : null;
  if (!tipos) return false;
  for (const def of Object.values(tipos)) {
    if (!def || !def.dir || isAbsolute(def.dir)) continue;
    let candidatoAbs;
    try { candidatoAbs = resolve(dirRepoAbs, def.dir); } catch { continue; }
    if (candidatoAbs === resolve(dirAdrAbs)) return true;
  }
  return false;
}

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const i = argv.indexOf('--dir');
  if (i >= 0 && !argv[i + 1]) { console.error(`[${NOME}] NÃO MEDIU: --dir sem caminho.`); return 2; }
  const dir = i >= 0 ? argv[i + 1] : cwd;
  if (!existsSync(dir)) throw new Error(`--dir inexistente: ${dir}`); // raiz do projeto some → lança → rodapé → exit 2
  if (!statSync(dir).isDirectory()) { console.error(`[${NOME}] NÃO MEDIU: --dir não é uma pasta: ${dir}`); return 2; } // ADR-07/H1
  const dirAdr = join(dir, 'governance', 'adr');
  if (!existsSync(dirAdr)) {
    if (pareceProjetoDaEsteira(dir)) {
      // ADR-07: o registro inteiro sumiu de um projeto que claramente é da esteira — não é "nada a medir".
      console.error(`[${NOME}] FALHA: pasta-adr-ausente — ${dirAdr} não existe, mas ${dir} tem sinal de projeto da ` +
        `esteira (esteira.json, .arch-layers.json ou governance/).`);
      console.error(`[${NOME}] COMO PASSAR: recrie governance/adr (ao menos o 0000-template.md) — ADR-0003 chama a pasta de inegociável.`);
      console.error(`[${NOME}] POR QUE EXISTE: apagar o registro inteiro não pode virar "sem violação" só porque a pasta some.`);
      return 1;
    }
    console.log(`[${NOME}] NAO_APLICAVEL: ${dirAdr} não existe — nada a medir.`);
    return 0;
  }
  const reservaLigada = numeracaoCedidaAoReservaDeNumero(resolve(dir), dirAdr);
  if (reservaLigada) {
    console.log(`[${NOME}] RN-C5: numeração cedida ao reserva-de-numero (governance/RESERVAS.json liga um ` +
      `tipo a governance/adr) — buraco e duplicata não são julgados aqui.`);
  }
  const achados = julgarSequencia(listarAdrs(dirAdr), { reservaLigada }); // dirAdr ilegível, ou arquivo ilegível dentro → lança → rodapé → exit 2
  if (achados.length === 0) { console.log(`[${NOME}] ✅ sequência de ADRs íntegra em ${dirAdr}.`); return 0; }
  const MAX_LISTA = 20; // ADR-02: nunca despeje uma lista de centenas de milhares de números em stderr
  for (const a of achados) {
    if (a.tipo === 'numero-duplicado') console.error(`[${NOME}] FALHA: numero-duplicado ADR-${fmt(a.numero)} em ${a.arquivos.join(', ')}`);
    else if (a.tipo === 'buraco') {
      const mostrar = a.faltando.slice(0, MAX_LISTA).map(fmt).join(', ADR-');
      const resto = a.faltando.length - MAX_LISTA;
      console.error(`[${NOME}] FALHA: buraco na sequência — falta(m) ADR-${mostrar}` +
        `${resto > 0 ? ` (+${resto} mais)` : ''} (entre ADR-${fmt(a.min)} e ADR-${fmt(a.max)})`);
    }
    else if (a.tipo === 'adr-sem-status') {
      console.error(`[${NOME}] FALHA: adr-sem-status em ${a.arquivo} — falta a linha "- **Status:**" ` +
        `(aceita [-*+], dois-pontos dentro/fora do negrito, caixa livre)`);
    }
    else if (a.tipo === 'nome-fora-do-padrao') {
      console.error(`[${NOME}] FALHA: nome-fora-do-padrao em ${a.arquivo} — não casa "NNN-titulo.md" (3 a 6 dígitos + hífen) ` +
        `nem está na lista permitida (README.md, index.md)`);
    }
    else if (a.tipo === 'titulo-diverge-do-nome') {
      console.error(`[${NOME}] FALHA: titulo-diverge-do-nome em ${a.arquivo} — o título diz "ADR-${fmt(a.numeroTitulo)}" ` +
        `mas o nome do arquivo é ADR-${fmt(a.numeroNome)}`);
    }
  }
  console.error(`[${NOME}] COMO PASSAR: numere sem duplicata nem lacuna (nunca reedite um ADR aceito — escreva outro que o ` +
    `substitui, com "Status: substituída por ADR-NNNN" no antigo), garanta "- **Status:**"/"* **Status**:"/etc ` +
    `em todo ADR de número > 0, nomeie SEMPRE "NNN-titulo.md" (3 a 6 dígitos) e mantenha o "# ADR-N" do corpo igual ao nome.`);
  console.error(`[${NOME}] POR QUE EXISTE: ADR duplicado/com buraco/mal-nomeado quebra a referência cruzada (#N não aponta ` +
    `pro registro certo); ADR sem Status esconde se a decisão ainda vale; título divergente do nome confunde qual registro é qual.`);
  return 1;
}

// self-test mora em ./selftest/adr-sequence.mjs (companion) — regra do coordenador: arquivo do kit
// nao passa de 600 linhas visuais (file-loc-ceiling). Import dinamico SEM await no topo (o companion
// importa julgarSequencia/listarAdrs/fmt DE VOLTA deste arquivo — await aqui criaria "unsettled
// top-level await"). A suite seta process.exitCode ao ser importada.
if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) {
    import('./selftest/adr-sequence.mjs').catch((e) => {
      console.error(`[${NOME}] NÃO MEDIU: self-test não rodou: ${e?.message || e}`);
      process.exitCode = 2;
    });
  } else {
    try { process.exitCode = principal(); } catch (e) { console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`); process.exitCode = 2; }
  }
}
