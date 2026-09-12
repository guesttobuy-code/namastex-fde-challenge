#!/usr/bin/env node
/**
 * ─── INTENÇÃO (certidão de nascimento) ───────────────────────────────────────
 * POR QUE EXISTE: ADR-0004 — recurso NUMERADO e compartilhado (ADR, migration) colide quando duas
 *   frentes em paralelo (1 chat = 1 branch = 1 worktree) escolhem "o próximo número" olhando só a
 *   própria árvore. Medido no projeto de origem: 4 números de ADR duplicados, e a 1ª versão da reserva
 *   de migration (só a árvore local) causou 8 colisões numa tarde.
 *
 * O QUE FAZ: `node scripts/reservar-numero.mjs <tipo> "<slug>"` reserva o PRÓXIMO número livre de
 *   `<tipo>` (config em `governance/RESERVAS.json`) em três camadas:
 *     1. trava local ATÔMICA em `<git-common-dir>/esteira-reservas/<tipo>/<valor-canônico>` (open 'wx')
 *        — chaveada pelo VALOR do número (`String(Number(n))`), NUNCA pelo texto formatado: "015" e
 *        "0015" são o MESMO número e travam o MESMO arquivo (RN-01 — largura mista entre worktrees não
 *        duplica mais). `<git-common-dir>` é compartilhado por TODOS os worktrees do clone (git
 *        rev-parse --path-format=absolute --git-common-dir), então duas frentes na mesma máquina nunca
 *        colidem;
 *     2. reserva VERSIONADA em `governance/reservas/<tipo>/<numero-formatado>.md` (frontmatter: numero,
 *        slug, branch, data, status) — colisão vinda de OUTRO clone/máquina vira conflito de merge
 *        explícito;
 *     3. se o tipo tem `criarDoModelo`, cria `<dir>/<numero>-<slug>.md` a partir do molde, com número/
 *        título/data preenchidos, e marca a reserva `status: criado`.
 *   `--listar [tipo]` lista as reservas versionadas. `--liberar <tipo> <numero>` apaga a trava local e a
 *   reserva — só quando existe reserva versionada NESTA árvore com o branch ATUAL (RN-03: uma frente
 *   nunca libera o número de outra), `<numero>` só de dígitos e o caminho resolvido dentro das pastas de
 *   reserva/trava (RN-04: sem isso, `--liberar migration ../../../CHANGELOG` apagava arquivo do repo).
 *
 * O SLUG É NORMALIZADO ao reservar (RN-C6): sem acento, minúsculas, `[^a-z0-9]+` → `-`; vazio depois
 *   disso = exit 2 (nunca grava um slug em branco ou com caractere que quebra o nome do arquivo).
 *
 * PRÓXIMO NÚMERO = max(itens numerados em `dir` — RN-06: recursivo, arquivo OU pasta, não conta o molde
 *   nem o `dir` de outro tipo aninhado —, reservas em `governance/reservas/<tipo>/*.md`, travas em
 *   `<git-common-dir>/esteira-reservas/<tipo>/*`) + 1, formatado com `largura` zeros — ou, para
 *   `padrao: "timestamp"`, `AAAAMMDDhhmmss` em UTC (RN-09), nunca menor que o maior já existente + 1s
 *   (RN-09 — um timestamp futuro no dir não faz o CLI devolver um número menor). Se a trava atômica
 *   falhar (EEXIST — outro processo venceu a corrida), tenta de novo (até 20x), recalculando as três
 *   fontes a cada tentativa (a trava do concorrente já aparece nelas).
 *
 * ERRO DEPOIS DE TRAVAR DEVOLVE A TRAVA (RN-08): slug, molde e `dir` do tipo são validados ANTES de
 *   tentar travar; se mesmo assim algo falhar depois da trava (disco cheio, mkdir sem permissão), um
 *   `finally` remove a trava tomada — nunca deixa um número queimado por uma tentativa que não terminou.
 *
 * O QUE ESTE SCRIPT NÃO FAZ: não decide buraco/duplicata/largura-divergente na numeração histórica
 *   (isso é do guard `reserva-de-numero`, dono único dessa regra — ADR-0004 "Regras fixadas"); não fala
 *   com o GitHub — push/PR continuam do dono; duas MÁQUINAS diferentes reservando o mesmo número só
 *   colidem no merge (conflito explícito em `governance/reservas/`) — limite DECLARADO do ADR-0004.
 *
 * CONTRA-PROVA: node scripts/reservar-numero.mjs --self-test
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync,
  openSync, closeSync, unlinkSync,
} from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { ehEntrypoint, selfTestPedido } from './lib/guard-doctrine.mjs';
import { git, repoRaiz, ehOutroCheckout } from './lib/git-base.mjs';
import {
  RE_RESERVA_ARQUIVO, formatarSequencial, valorCanonico, extrairNumeros,
  proximoNumeroComTrava, slugificar, preencherModelo,
  frontmatterReserva, parseFrontmatterReserva, listarItensNumerados, dentroDe,
} from './lib/reservas.mjs';

// A suíte de self-test mora em ./selftest/reservar-numero.mjs (arquivo ≤ 600 linhas visuais — regra do
// coordenador). `--self-test` a importa dinamicamente; ela roda ao ser importada e seta process.exitCode.

const NOME = 'reservar-numero';
const RESERVAS_CONFIG_REL = 'governance/RESERVAS.json';
const RESERVAS_DIR_REL = 'governance/reservas';
const LOCK_SUBDIR = 'esteira-reservas';
const MAX_TENTATIVAS_LOCK = 20;
const RE_LOCK_ARQUIVO = /^(\d+)$/;

class ErroReserva extends Error {
  constructor(exitCode, mensagem) { super(mensagem); this.exitCode = exitCode; }
}

// ─── I/O: leitura das três fontes e a trava real ─────────────────────────────

function listarSeExiste(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/** dirAbs de um tipo, JÁ VALIDADO: relativo, dentro do repo (RN-05/F3 — CLI nunca escreve fora do
 *  repo). Não exige que exista (a 1ª reserva de um tipo pode ser antes da pasta existir). */
function dirValidadoDoTipo(repoRoot, tipo, def) {
  if (isAbsolute(def.dir)) {
    throw new ErroReserva(2, `tipo "${tipo}": "dir" é um caminho absoluto ("${def.dir}") — configure caminho relativo à raiz do projeto.`);
  }
  const dirAbs = resolve(repoRoot, def.dir);
  if (!dentroDe(dirAbs, repoRoot)) throw new ErroReserva(2, `tipo "${tipo}": "dir" ("${def.dir}") sai da árvore do projeto.`);
  return dirAbs;
}

/** itens numerados de `dirAbs` (recursivo — dono único em lib/reservas.mjs), isentando o MOLDE do
 *  próprio tipo (RN-C6: "o molde não é ADR") e o `dir` de qualquer OUTRO tipo ligado (RN-07: não invadir
 *  o dir de um tipo aninhado no do outro). Junction/symlink dentro do dir também vira NÃO MEDIU aqui. */
function coletarDirNums({ repoRoot, config, tipo, def, dirAbs }) {
  if (!existsSync(dirAbs)) return new Set(); // 1ª reserva do tipo, antes de a pasta existir: nada usado ainda
  const pularCaminhos = new Set();
  if (def.criarDoModelo) pularCaminhos.add(resolve(repoRoot, def.criarDoModelo));
  for (const [outroTipo, outroDef] of Object.entries(config.tipos || {})) {
    if (outroTipo === tipo || !outroDef?.dir) continue;
    try { pularCaminhos.add(dirValidadoDoTipo(repoRoot, outroTipo, outroDef)); }
    catch { /* ignora-de-proposito: tipo mal configurado não impede ESTA reserva */ }
  }
  const { itens, naoMedidos } = listarItensNumerados(dirAbs, { pularCaminhos, ehOutroCheckout });
  if (naoMedidos.length) {
    throw new ErroReserva(2, `tipo "${tipo}": ${naoMedidos.map((n) => `${n.motivo} em ${n.caminho}`).join('; ')}.`);
  }
  return extrairNumeros(itens.map((it) => it.numero), /^(\d+)$/);
}

function coletarNumerosExistentes(ctx) {
  const { reservasDirAbs, lockDirAbs } = ctx;
  return {
    dirNums: coletarDirNums(ctx),
    reservaNums: extrairNumeros(listarSeExiste(reservasDirAbs), RE_RESERVA_ARQUIVO),
    lockNums: extrairNumeros(listarSeExiste(lockDirAbs), RE_LOCK_ARQUIVO),
  };
}

/** open(..., 'wx') — cria o arquivo só se NÃO existir. true = travou; false = EEXIST (outro venceu).
 *  Trava pelo VALOR CANÔNICO do número (RN-01) — quem chama já resolveu isso em `numeroStr`.
 *  exportado: a suíte de self-test mede o EEXIST real de filesystem direto (sem passar pelo processo). */
export function tentarTravar(lockDirAbs, numeroFormatado) {
  mkdirSync(lockDirAbs, { recursive: true });
  const nomeTrava = valorCanonico(numeroFormatado);
  try {
    closeSync(openSync(join(lockDirAbs, nomeTrava), 'wx'));
    return true;
  } catch (e) {
    if (e && e.code === 'EEXIST') return false;
    throw e;
  }
}

function arquivoNumeradoExistente(repoRoot, dirAbs, def, numeroFormatado) {
  const pularCaminhos = new Set();
  if (def.criarDoModelo) pularCaminhos.add(resolve(repoRoot, def.criarDoModelo));
  let itens;
  try { ({ itens } = listarItensNumerados(dirAbs, { pularCaminhos, ehOutroCheckout })); }
  catch { return null; } // dir sumiu/ilegível: não há como estar "em uso" — liberar segue adiante
  const alvo = Number(numeroFormatado);
  const achado = itens.find((it) => Number(it.numero) === alvo);
  return achado ? achado.nome : null;
}

function gitCommonDirDe(repoRoot) {
  return git(['rev-parse', '--path-format=absolute', '--git-common-dir'], repoRoot);
}

// ─── as três operações ────────────────────────────────────────────────────────

function carregarConfig(repoRoot) {
  let bruto;
  try {
    bruto = readFileSync(join(repoRoot, RESERVAS_CONFIG_REL), 'utf8');
  } catch (e) {
    throw new ErroReserva(2, `${RESERVAS_CONFIG_REL} ausente em ${repoRoot} (${e?.message || e}).`);
  }
  let config;
  try {
    config = JSON.parse(bruto);
  } catch (e) {
    throw new ErroReserva(2, `${RESERVAS_CONFIG_REL} não é JSON válido (${e?.message || e}).`);
  }
  const semTipos = !config || typeof config.tipos !== 'object' || config.tipos === null
    || Object.keys(config.tipos).length === 0;
  if (semTipos) throw new ErroReserva(2, `${RESERVAS_CONFIG_REL} sem "tipos" configurado.`);
  return config;
}

function definicaoDoTipo(config, tipo) {
  const def = config.tipos?.[tipo];
  if (!def) throw new ErroReserva(2, `tipo "${tipo}" não existe em ${RESERVAS_CONFIG_REL}.`);
  if (!def.dir) {
    throw new ErroReserva(2, `tipo "${tipo}" está DESLIGADO (dir: null) em ${RESERVAS_CONFIG_REL} — ligue-o antes de reservar.`);
  }
  return def;
}

function reservar({ repoRoot, config, tipo, slug }) {
  if (!slug || /[\\/]/.test(slug)) throw new ErroReserva(2, `slug inválido: "${slug}" (vazio ou com barra).`);
  const slugNormalizado = slugificar(slug);
  if (!slugNormalizado) throw new ErroReserva(2, `slug inválido: "${slug}" (vazio depois de normalizar — sem acento/minúsculas/[a-z0-9]).`);

  const def = definicaoDoTipo(config, tipo);
  const largura = Number.isFinite(def.largura) ? def.largura : 4;
  const padrao = def.padrao === 'timestamp' ? 'timestamp' : 'sequencial';
  const dirAbs = dirValidadoDoTipo(repoRoot, tipo, def);

  // valida slug/molde/pastas ANTES de travar (RN-08: erro depois da trava tem que devolvê-la; aqui nem
  // chega a travar se o molde não existe).
  if (def.criarDoModelo) {
    try { readFileSync(join(repoRoot, def.criarDoModelo), 'utf8'); }
    catch (e) { throw new ErroReserva(2, `criarDoModelo aponta para "${def.criarDoModelo}" e não consegui ler: ${e?.message || e}.`); }
  }

  const reservasDirAbs = join(repoRoot, RESERVAS_DIR_REL, tipo);
  const lockDirAbs = join(gitCommonDirDe(repoRoot), LOCK_SUBDIR, tipo);
  const ctx = { repoRoot, config, tipo, def, dirAbs, reservasDirAbs, lockDirAbs };

  const numero = proximoNumeroComTrava({
    padrao,
    largura,
    coletar: () => coletarNumerosExistentes(ctx),
    travar: (cand) => tentarTravar(lockDirAbs, cand),
    maxTentativas: MAX_TENTATIVAS_LOCK,
  });
  if (!numero) {
    throw new ErroReserva(1, `não consegui travar um número livre para "${tipo}" (${MAX_TENTATIVAS_LOCK} tentativas, todas colidiram).`);
  }

  let reservaGravada = false;
  try {
    let branch = 'HEAD';
    try { branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot); }
    catch { /* ignora-de-proposito: repo recem-nascido sem HEAD */ }
    const data = new Date().toISOString().slice(0, 10);

    let status = 'reservado';
    let arquivoCriadoRel = null;
    if (def.criarDoModelo) {
      const fonteTemplate = readFileSync(join(repoRoot, def.criarDoModelo), 'utf8');
      const conteudo = preencherModelo(fonteTemplate, { numeroFormatado: numero, slug: slugNormalizado, data });
      const alvoPath = join(dirAbs, `${numero}-${slugNormalizado}.md`);
      mkdirSync(dirAbs, { recursive: true });
      writeFileSync(alvoPath, conteudo);
      status = 'criado';
      arquivoCriadoRel = relative(repoRoot, alvoPath).split('\\').join('/');
    }

    mkdirSync(reservasDirAbs, { recursive: true });
    const reservaTexto = frontmatterReserva({ numero, slug: slugNormalizado, branch, data, status });
    writeFileSync(join(reservasDirAbs, `${numero}.md`), reservaTexto);
    reservaGravada = true;

    return { numero, arquivoCriadoRel };
  } finally {
    // RN-08: se a reserva NÃO foi gravada (falhou depois de travar — disco cheio, mkdir sem permissão),
    // devolve a trava: o número não pode ficar queimado por uma tentativa que não terminou.
    if (!reservaGravada) { try { unlinkSync(join(lockDirAbs, valorCanonico(numero))); } catch { /* ignora-de-proposito: melhor esforço */ } }
  }
}

function listar({ repoRoot, config, tipoFiltro }) {
  if (tipoFiltro && !config.tipos?.[tipoFiltro]) {
    throw new ErroReserva(2, `tipo "${tipoFiltro}" não existe em ${RESERVAS_CONFIG_REL}.`);
  }
  const tipos = tipoFiltro ? [tipoFiltro] : Object.keys(config.tipos || {});
  for (const tipo of tipos) {
    const dir = join(repoRoot, RESERVAS_DIR_REL, tipo);
    const nomes = listarSeExiste(dir).filter((n) => RE_RESERVA_ARQUIVO.test(n)).sort();
    if (nomes.length === 0) { console.log(`[${NOME}] ${tipo}: nenhuma reserva.`); continue; }
    console.log(`[${NOME}] ${tipo}:`);
    for (const nome of nomes) {
      const fm = parseFrontmatterReserva(readFileSync(join(dir, nome), 'utf8')) || {};
      const numero = fm.numero ?? nome.replace(/\.md$/, '');
      console.log(`  ${numero}  ${fm.status ?? '?'}  ${fm.slug ?? '?'}  (branch ${fm.branch ?? '?'}, ${fm.data ?? '?'})`);
    }
  }
}

function liberar({ repoRoot, config, tipo, numeroEntrada }) {
  // RN-04: número só de dígitos — path traversal (../../../CHANGELOG) nem chega a virar caminho.
  if (!/^\d+$/.test(String(numeroEntrada ?? ''))) {
    throw new ErroReserva(2, `--liberar exige número só de dígitos: "${numeroEntrada}".`);
  }
  const def = definicaoDoTipo(config, tipo);
  const dirAbs = dirValidadoDoTipo(repoRoot, tipo, def);
  const largura = Number.isFinite(def.largura) ? def.largura : 4;
  const numeroFormatado = def.padrao === 'timestamp' ? String(numeroEntrada) : formatarSequencial(Number(numeroEntrada), largura);

  const reservasDirAbs = join(repoRoot, RESERVAS_DIR_REL, tipo);
  const lockDirAbs = join(gitCommonDirDe(repoRoot), LOCK_SUBDIR, tipo);
  const reservaPath = join(reservasDirAbs, `${numeroFormatado}.md`);
  const lockPath = join(lockDirAbs, valorCanonico(numeroFormatado));

  // RN-04: caminho resolvido tem que ficar DENTRO das pastas de reserva/trava (defesa em profundidade —
  // com número só-dígitos isto já é garantido, mas a regra do ADR pede a checagem explícita).
  if (!dentroDe(reservaPath, reservasDirAbs) || !dentroDe(lockPath, lockDirAbs)) {
    throw new ErroReserva(2, `--liberar: caminho resolvido fora das pastas de reserva/trava para ${tipo}/${numeroFormatado}.`);
  }

  // RN-03: só libera o que é DESTA frente — a reserva versionada tem que existir NESTA árvore (não numa
  // trava só compartilhada pelo git-common-dir) e o branch da reserva tem que ser o branch ATUAL.
  if (!existsSync(reservaPath)) {
    throw new ErroReserva(1, `recuso liberar ${tipo}/${numeroFormatado}: sem reserva versionada NESTA árvore (não é desta frente, ou já foi liberado).`);
  }
  const fm = parseFrontmatterReserva(readFileSync(reservaPath, 'utf8')) || {};
  let branchAtual = 'HEAD';
  try { branchAtual = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot); }
  catch { /* ignora-de-proposito: repo recem-nascido sem HEAD */ }
  if (fm.branch !== branchAtual) {
    throw new ErroReserva(1, `recuso liberar ${tipo}/${numeroFormatado}: a reserva é do branch "${fm.branch ?? '?'}", branch atual é "${branchAtual}".`);
  }

  const existente = arquivoNumeradoExistente(repoRoot, dirAbs, def, numeroFormatado);
  if (existente) {
    throw new ErroReserva(1, `recuso liberar ${tipo}/${numeroFormatado}: "${existente}" já existe — o número está em uso de verdade.`);
  }

  unlinkSync(reservaPath);
  if (existsSync(lockPath)) unlinkSync(lockPath);
  return { numeroStr: numeroFormatado };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const USO = 'uso: node scripts/reservar-numero.mjs <tipo> "<slug>" | --listar [tipo] | --liberar <tipo> <numero>.';

export function principal({ argv = process.argv.slice(2), cwd = process.cwd() } = {}) {
  const repoRoot = repoRaiz(cwd) || cwd;
  try {
    const config = carregarConfig(repoRoot);

    if (argv[0] === '--listar') {
      listar({ repoRoot, config, tipoFiltro: argv[1] || null });
      return 0;
    }

    if (argv[0] === '--liberar') {
      const [, tipo, numero] = argv;
      if (!tipo || !numero) { console.error(`[${NOME}] NÃO MEDIU: uso: --liberar <tipo> <numero>.`); return 2; }
      const r = liberar({ repoRoot, config, tipo, numeroEntrada: numero });
      console.log(`[${NOME}] liberado: ${tipo}/${r.numeroStr} (trava e reserva removidas).`);
      return 0;
    }

    const [tipo, slug] = argv;
    if (!tipo || !slug) { console.error(`[${NOME}] NÃO MEDIU: ${USO}`); return 2; }
    const r = reservar({ repoRoot, config, tipo, slug });
    const sufixo = r.arquivoCriadoRel ? ` — criado ${r.arquivoCriadoRel}` : '';
    console.log(`[${NOME}] reservado: ${tipo}/${r.numero}${sufixo}`);
    if (r.arquivoCriadoRel) console.log(r.arquivoCriadoRel);
    return 0;
  } catch (e) {
    if (e instanceof ErroReserva) {
      console.error(`[${NOME}] ${e.exitCode === 1 ? 'FALHA' : 'NÃO MEDIU'}: ${e.message}`);
      return e.exitCode;
    }
    throw e;
  }
}

// ─── entrypoint ───────────────────────────────────────────────────────────────
// self-test mora em ./selftest/reservar-numero.mjs (companion): calcula o caminho DESTE arquivo a
// partir do próprio import.meta.url (não de process.argv) pra continuar correto quando a prova-de-vida
// copia scripts/ inteira pra um tmp e muta só este arquivo. Import dinâmico SEM await no topo (o
// companion importa ESTE arquivo de volta — com `await` aqui o ciclo vira "unsettled top-level await" e
// o Node aborta com exit 13; SEM await, não sobra top-level await neste arquivo, o ciclo resolve normal
// e o processo só termina depois que o import() — e o self-test síncrono dentro dele — de fato acabar,
// porque o próprio import() ainda é E/S pendente aos olhos do event loop). A suíte seta process.exitCode
// ao ser importada — mesma saída/exit de sempre.
if (ehEntrypoint(import.meta.url)) {
  if (selfTestPedido()) {
    import('./selftest/reservar-numero.mjs').catch((e) => {
      console.error(`[${NOME}] NÃO MEDIU: self-test não rodou: ${e?.message || e}`);
      process.exitCode = 2;
    });
  } else {
    try { process.exitCode = principal(); } catch (e) {
      console.error(`[${NOME}] NÃO MEDIU: ${e?.message || e}`);
      process.exitCode = 2;
    }
  }
}
