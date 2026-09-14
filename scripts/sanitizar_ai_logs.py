# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Exporta e sanitiza as transcricoes de IA para `ai-logs/` (issue #15, secao "ai-logs").

Cobre o `.jsonl` PRINCIPAL de cada sessao e as transcricoes de SUBAGENTE (pasta `subagents/`,
inclusive `subagents/workflows/`) -- achado da coordenacao: uma chave real do OpenRouter vazou
numa transcricao de subagente de outra frente, e uma varredura que so olha o `.jsonl` principal
nao veria isso.

O QUE ESTE SCRIPT FAZ, em ordem:
  1. Le a lista de padroes de SUBSTITUICAO de `_local/ai-logs-config.json` (NUNCA commitado --
     ver `_local/.gitignore` / `.gitignore` da raiz). Sem esse arquivo, para com erro: dado real
     ausente bloqueia a exportacao, nunca fabrica um padrao vazio (LEI 2).
  1b. Le, SEPARADAMENTE, a lista de padroes PESSOAIS de `_local/padroes_pessoais.txt` (tambem
     nunca commitado) -- um arquivo distinto do de cima, DE PROPOSITO: este e criado pelo DONO,
     nao pela mesma sessao que decide a substituicao da config, para ser um segundo par de olhos
     independente (achado do ensaio de congelamento, issue #15: `snapshot.trackedFileBackups`
     vazava nome completo e usuario do Windows por uma CHAVE de dict que a substituicao da config
     nunca cobria). Arquivo ausente ou vazio = ERRO, ANTES de escrever qualquer coisa. Desde o
     achado da exportacao real (S1), estes padroes NAO SAO SO CONFERIDOS -- sao SUBSTITUIDOS por
     `[DADO PESSOAL REMOVIDO]` (passo 3), porque ninguem pode ler o valor que casou pra decidir o
     conserto na mao; a verificacao final (passo 5) continua rodando depois, como rede de
     seguranca, nao como unico defensor.
  2. Para cada sessao configurada, le o `.jsonl` principal e cada `.jsonl` de `subagents/`
     (recursivo), PULANDO os arquivos da lista `excluir` (ex.: a transcricao do incidente).
     Antes de sanitizar, tira um RETRATO de cada arquivo (S3, `shutil.copy2` pra uma pasta
     temporaria) e sanitiza SO o retrato, nunca o arquivo vivo -- achado da exportacao real: a
     sessao de origem pode estar sendo escrita ao mesmo tempo que a exportacao roda, e ler o
     arquivo vivo linha a linha pode pegar uma linha final pela metade. Se a ULTIMA linha do
     retrato nao termina em `\n` (escrita pela metade no instante exato da copia), essa linha
     final e descartada (so ela), com aviso da contagem -- linha invalida no MEIO do arquivo
     continua so pulada e contada (nao aborta aqui; aborta na verificacao final, passo 4, se sobrar
     no que foi ESCRITO).
  3. Em cada linha (um evento JSON por linha), NUMA PASTA DE STAGING TEMPORARIA (S2, fora de
     `ai-logs/`): substitui todo bloco `{"type": "image", ...}` por um bloco de texto `[IMAGEM
     REMOVIDA: captura de tela do dono]`; aplica os padroes de substituicao da config, o redator de
     PII sintetica (`dominio.redator_pii.redigir_texto`) e os padroes PESSOAIS do passo 1b em TODO
     valor string da arvore, E em toda CHAVE de dict (nao so em campos de texto conhecidos -- a
     estrutura das sessoes tem muitos tipos de evento, e caminho/segredo pode aparecer em qualquer
     um deles, inclusive como chave).
  4. VERIFICACAO FINAL, sobre o STAGING (nunca sobre a memoria): conta ocorrencias dos padroes de
     segredo conhecidos (prefixos de token), dos padroes PESSOAIS remanescentes (chave ou valor --
     esperado zero, ja que o passo 3 os substitui; fica como rede de seguranca) e de blocos de
     imagem remanescentes, e confere que toda linha de todo arquivo gerado continua sendo JSON
     valido -- "linha" separada so por `\n` REAL, em bytes (S4), nunca por `str.splitlines()`, que
     trata U+0085/U+2028/U+2029 (nao escapados por `json.dumps`) como quebra de linha e
     fragmentaria 1 registro valido em "linhas" falsas. Qualquer ocorrencia ABORTA a exportacao
     inteira e imprime a LISTA DE ARQUIVOS afetados -- nunca o valor que casou. `ai-logs/` (o
     destino real) nunca chega a ser tocado.
  5. Só se a verificação passar: troca, em `ai-logs/`, SÓ as pastas de SESSÃO exportadas (S2) --
     nunca a pasta inteira. `ai-logs/README.md` e `ai-logs/codex/` (conteúdo que não é pasta de
     sessão nenhuma) nunca são apagados nem tocados, porque não fazem parte da troca.

Uso:
    uv run scripts/sanitizar_ai_logs.py --config _local/ai-logs-config.json
    uv run scripts/sanitizar_ai_logs.py --config ... --saida _local/ai-logs-teste  (ensaio, nao mexe em ai-logs/)
    uv run scripts/sanitizar_ai_logs.py --self-test   (roteiro de mutacao: planta chave falsa, mostra abortando)

Padroes pessoais: `_local/padroes_pessoais.txt`, um LITERAL por linha (nao regex), comparacao sem
caixa, linhas vazias/'#' ignoradas -- criado pelo DONO, nunca por esta sessao. Sem ele, o script
recusa exportar (nenhum ai-logs sai sem essa rede de seguranca). Cada ocorrência é SUBSTITUÍDA por
`[DADO PESSOAL REMOVIDO]`; o script imprime só a CONTAGEM por índice da lista, nunca o valor.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "src"))

# Padroes de SEGREDO -- genericos, nao-pessoais, seguros para commitar (achado da coordenacao,
# incidente da chave do OpenRouter vazada numa transcricao de subagente). A checagem final aborta
# se QUALQUER um destes casar no que foi ESCRITO, depois da sanitizacao.
PADROES_DE_SEGREDO: dict[str, re.Pattern[str]] = {
    "openrouter": re.compile(r"sk-or-v1-[A-Za-z0-9]"),
    # >=20 chars depois do prefixo -- uma chave real tem dezenas de caracteres; menos que isso e
    # quase sempre documentacao mencionando o FORMATO ("sk-ant-admin...", "sk-ant-api03-..."),
    # achado ao vivo na sessao da coordenacao (docs da Admin API, nao uma chave de verdade).
    "anthropic": re.compile(r"sk-ant-[A-Za-z0-9_-]{20,}"),
    "github_pat_classico": re.compile(r"ghp_[A-Za-z0-9]{10,}"),
    "github_pat_fino": re.compile(r"github_pat_[A-Za-z0-9_]{10,}"),
    "nvidia": re.compile(r"nvapi-[A-Za-z0-9-]{10,}"),
    "bearer_token": re.compile(r"Bearer\s+[A-Za-z0-9._-]{20,}"),
}

PLACEHOLDER_IMAGEM = {"type": "text", "text": "[IMAGEM REMOVIDA: captura de tela do dono]"}


def carregar_padroes_pessoais_verificacao(caminho: Path) -> list[str]:
    """Le a lista de padroes PESSOAIS para a VERIFICACAO FINAL (issue #15, achado do ensaio de
    congelamento: `snapshot.trackedFileBackups` vazava nome completo e usuario do Windows por uma
    CHAVE de dict que a substituicao nunca cobria, e a verificacao final antiga so conferia
    segredo -- passava limpa mesmo com o vazamento). Arquivo separado de `_local/ai-logs-config.json`
    DE PROPOSITO: quem cria este é o DONO, nao a mesma sessao que decide a substituicao -- um
    segundo par de olhos independente, nao o mesmo conhecimento repetido (se os dois vierem da
    mesma fonte, os dois tem o mesmo ponto cego).

    Um padrao LITERAL por linha (nao regex -- o dono nao precisa saber regex), comparacao sem
    caixa; linha vazia ou comecando com '#' e comentario, ignorada. Arquivo ausente OU vazio =
    ERRO, sanitizacao para ANTES de escrever qualquer coisa -- nunca segue como se nao houvesse
    padrao pessoal nenhum para checar (LEI 2, dado real ausente bloqueia, nunca se fabrica um
    padrao vazio)."""
    if not caminho.is_file():
        raise SystemExit(
            f"[sanitizar_ai_logs] padroes pessoais ausentes ({caminho}): nao publico ai-logs sem "
            "essa checagem. Peca ao dono para criar o arquivo (um padrao LITERAL por linha -- "
            "nome completo, usuario do Windows, e-mail, nome de outro projeto... -- comparacao "
            "sem caixa; linhas vazias/'#' sao ignoradas). O arquivo mora em _local/, ja coberto "
            "pelo .gitignore da raiz -- nunca sera commitado."
        )
    padroes = [
        linha.strip() for linha in caminho.read_text(encoding="utf-8").splitlines()
        if linha.strip() and not linha.strip().startswith("#")
    ]
    if not padroes:
        raise SystemExit(
            f"[sanitizar_ai_logs] {caminho} existe mas esta vazio (so linhas em branco/comentario): "
            "nao publico ai-logs sem pelo menos um padrao pessoal para checar."
        )
    return padroes


def compilar_padroes_pessoais_substituicao(padroes: list[str]) -> list[re.Pattern[str]]:
    """Compila cada padrao PESSOAL (literal, ja carregado por `carregar_padroes_pessoais_verificacao`)
    num regex de substituicao -- `re.escape` porque o dono escreve literal, nao regex; sem caixa,
    porque o mesmo nome pode aparecer com maiuscula/minuscula diferente em lugares diferentes."""
    return [re.compile(re.escape(p), re.IGNORECASE) for p in padroes]


PLACEHOLDER_PADRAO_PESSOAL = "[DADO PESSOAL REMOVIDO]"


def _contem_padrao_pessoal(valor, padroes_lower: list[str]) -> bool:
    """Varre CHAVE e valor, recursivamente -- o achado do ensaio de congelamento foi exatamente um
    padrao pessoal vazando por CHAVE de dict (`snapshot.trackedFileBackups`), que uma checagem só
    de valor nunca pegaria."""
    if isinstance(valor, dict):
        for k, v in valor.items():
            if isinstance(k, str) and any(p in k.lower() for p in padroes_lower):
                return True
            if _contem_padrao_pessoal(v, padroes_lower):
                return True
        return False
    if isinstance(valor, list):
        return any(_contem_padrao_pessoal(v, padroes_lower) for v in valor)
    if isinstance(valor, str):
        return any(p in valor.lower() for p in padroes_lower)
    return False


def carregar_config(caminho: Path) -> dict:
    if not caminho.exists():
        raise SystemExit(
            f"[sanitizar_ai_logs] DADO REAL AUSENTE: {caminho} nao existe. "
            "Este script recusa fabricar um padrao vazio (LEI 2) -- crie o arquivo "
            "(modelo em scripts/ai-logs-config.exemplo.json, com valores FICTICIOS) antes de exportar."
        )
    dados = json.loads(caminho.read_text(encoding="utf-8"))
    obrigatorios = ["raiz_projects", "prefixo_frentes", "substituicoes"]
    faltando = [k for k in obrigatorios if k not in dados]
    if faltando:
        raise SystemExit(f"[sanitizar_ai_logs] config incompleta: faltam as chaves {faltando}")
    return dados


def descobrir_sessoes(config: dict) -> list[dict]:
    """Enumera as pastas de sessao PELO DISCO, nunca por uma lista fixa -- uma lista digitada a
    mao fica velha assim que uma frente nova abre ou uma sessao reinicia (achado da coordenacao).

    Regra de mapeamento, na ordem:
      1. `mapa_fixo[nome_da_pasta]` -- as poucas pastas que nao seguem o padrao de frente
         (coordenacao, auditoria fria, sondagem inicial); nao crescem com o tempo.
      2. pasta que comeca com `prefixo_frentes` -- uma por frente aberta via `frente:abrir`; o
         slug e o que sobra depois do prefixo. Cobre frente nova SEM precisar editar a config.
      3. nao bate com nenhum dos dois, ou esta em `excluir_pastas` -- ignorada (nao e desta
         esteira, ou foi excluida explicitamente, ex.: pasta antiga com nome sensivel no path).
    """
    raiz = Path(config["raiz_projects"])
    mapa_fixo: dict[str, str] = config.get("mapa_fixo", {})
    prefixo = config["prefixo_frentes"]
    excluir_pastas = set(config.get("excluir_pastas", []))

    if not raiz.is_dir():
        raise SystemExit(f"[sanitizar_ai_logs] raiz_projects nao existe: {raiz}")

    sessoes = []
    for pasta in sorted(raiz.iterdir()):
        if not pasta.is_dir() or pasta.name in excluir_pastas:
            continue
        if pasta.name in mapa_fixo:
            sessoes.append({"slug": mapa_fixo[pasta.name], "pasta": str(pasta)})
        elif pasta.name.startswith(prefixo):
            sessoes.append({"slug": pasta.name[len(prefixo):], "pasta": str(pasta)})
    return sessoes


def compilar_substituicoes(regras: list[dict]) -> list[tuple[re.Pattern[str], str]]:
    compiladas = []
    for regra in regras:
        flags = re.IGNORECASE if "i" in regra.get("flags", "") else 0
        compiladas.append((re.compile(regra["regex"], flags), regra["por"]))
    return compiladas


def redator_pii_sintetica():
    try:
        from dominio.redator_pii import redigir_texto
    except ImportError as exc:
        raise SystemExit(
            f"[sanitizar_ai_logs] nao consegui importar dominio.redator_pii.redigir_texto: {exc}. "
            "Rode com PYTHONPATH=src ou de dentro do venv do projeto."
        )
    else:
        return redigir_texto


# Rede extra, SO' desta exportacao -- achado ensaiando contra as sessoes reais: o CEP de exemplo do
# enunciado (`01310-100`) sobrevivia em transcricoes de codigo/docstring porque a docstring de
# `interfaces/cli.py` mostra `\n` como TEXTO literal (nao quebra de linha real) antes do CEP -- "n"
# eh caractere de palavra, "0" tambem, entao o `\b` que `dominio.redator_pii` exige antes do CEP
# nunca casa ali. Nao eh bug do redator (ele foi desenhado pra texto de conversa, nao pra
# transcricao de sessao de IA citando codigo-fonte) -- e' o contexto novo que este script introduz.
# Ambos os padroes abaixo sao SEM fronteira de propósito, so' para esta exportacao (nao mexe em
# `dominio/redator_pii.py`, que continua do jeito que a F4/#7 desenhou e testou).
PADROES_PII_SEM_FRONTEIRA: tuple[re.Pattern[str], ...] = (
    re.compile(r"\d{5}-\d{3}"),  # CEP (com hifen), sem exigir \b antes/depois
    re.compile(r"\d{3}\.\d{3}\.\d{3}-\d{2}"),  # CPF com pontuacao, sem exigir \b antes/depois
)


def sanitizar_string(
    texto: str,
    substituicoes: list[tuple[re.Pattern[str], str]],
    redigir,
    padroes_pessoais_sub: list[re.Pattern[str]] = (),
    contagens_padroes_pessoais: list[int] | None = None,
) -> str:
    for padrao, por in substituicoes:
        texto = padrao.sub(por, texto)
    texto = redigir(texto)
    for padrao in PADROES_PII_SEM_FRONTEIRA:
        texto = padrao.sub("[REDIGIDO]", texto)
    # S1 (achado da exportacao real, issue #15): os padroes PESSOAIS do dono (antes só conferidos
    # na verificacao final) agora tambem sao SUBSTITUIDOS aqui, pela MESMA travessia de chave+valor
    # -- ninguem pode ler o valor que casou, entao o unico conserto possivel e trocar sem imprimir
    # (a verificacao final continua rodando depois, como rede de seguranca, nao como unico defensor).
    for indice, padrao in enumerate(padroes_pessoais_sub):
        texto, n = padrao.subn(PLACEHOLDER_PADRAO_PESSOAL, texto)
        if n and contagens_padroes_pessoais is not None:
            contagens_padroes_pessoais[indice] += n
    return texto


def sanitizar_valor(valor, substituicoes, redigir, padroes_pessoais_sub=(), contagens_padroes_pessoais=None):
    if isinstance(valor, dict):
        if valor.get("type") == "image":
            return dict(PLACEHOLDER_IMAGEM)
        # achado do ensaio de congelamento (issue #15): `snapshot.trackedFileBackups` guarda o
        # caminho absoluto do arquivo como CHAVE do dicionario, nunca como valor -- sanitizar só
        # valores deixava o usuario do Windows e o nome completo do dono vazando ali, mesmo com os
        # padroes pessoais configurados. Chave sanitizada pela MESMA `sanitizar_string` do valor
        # (dono único do texto, LEI 11); colisão de chave (duas chaves diferentes viram a mesma
        # string sanitizada) é logada, nunca silenciosamente sobrescrita.
        resultado = {}
        colisoes = []
        for k, v in valor.items():
            k_sanitizada = (
                sanitizar_string(k, substituicoes, redigir, padroes_pessoais_sub, contagens_padroes_pessoais)
                if isinstance(k, str) else k
            )
            if k_sanitizada in resultado and k_sanitizada != k:
                colisoes.append(k_sanitizada)
            resultado[k_sanitizada] = sanitizar_valor(v, substituicoes, redigir, padroes_pessoais_sub, contagens_padroes_pessoais)
        if colisoes:
            raise ValueError(
                f"colisao de chave apos sanitizar (dado real ausente se omite, nunca se funde em "
                f"silencio): {len(colisoes)} chave(s) sanitizada(s) colidiram no mesmo dict"
            )
        return resultado
    if isinstance(valor, list):
        return [sanitizar_valor(v, substituicoes, redigir, padroes_pessoais_sub, contagens_padroes_pessoais) for v in valor]
    if isinstance(valor, str):
        return sanitizar_string(valor, substituicoes, redigir, padroes_pessoais_sub, contagens_padroes_pessoais)
    return valor


def sanitizar_arquivo_jsonl(
    origem: Path, destino: Path, substituicoes, redigir,
    padroes_pessoais_sub=(), contagens_padroes_pessoais=None,
) -> int:
    destino.parent.mkdir(parents=True, exist_ok=True)
    linhas_com_erro = 0
    with origem.open(encoding="utf-8") as f_in, destino.open("w", encoding="utf-8", newline="\n") as f_out:
        for numero, linha in enumerate(f_in, start=1):
            linha = linha.rstrip("\n")
            if not linha.strip():
                continue
            try:
                evento = json.loads(linha)
            except json.JSONDecodeError:
                linhas_com_erro += 1
                continue
            sanitizado = sanitizar_valor(evento, substituicoes, redigir, padroes_pessoais_sub, contagens_padroes_pessoais)
            f_out.write(json.dumps(sanitizado, ensure_ascii=False) + "\n")
    return linhas_com_erro


def deve_excluir(caminho_relativo: str, excluir: list[str]) -> bool:
    return any(padrao in caminho_relativo for padrao in excluir)


def coletar_arquivos_da_sessao(pasta_sessao: Path, slug: str, excluir: list[str]) -> list[tuple[Path, str]]:
    """Devolve [(caminho_absoluto, caminho_relativo_dentro_de_ai-logs/<slug>/)].

    A pasta de um projeto do Claude Code guarda um `<uuid-da-sessao>.jsonl` por conversa
    DIRETAMENTE dentro dela (pode haver mais de uma, se a sessao reiniciou), e uma subpasta
    `<uuid-da-sessao>/subagents/` (recursiva, inclusive `subagents/workflows/`) por sessao com
    subagentes. Cobre os dois -- e so os dois, para nao varrer nada fora do padrao conhecido.
    """
    arquivos: list[tuple[Path, str]] = []
    if pasta_sessao.is_dir():
        for principal in sorted(pasta_sessao.glob("*.jsonl")):
            arquivos.append((principal, f"{slug}/{principal.stem}.jsonl"))
        for arq in sorted(pasta_sessao.rglob("*.jsonl")):
            partes = arq.relative_to(pasta_sessao).parts
            if "subagents" in partes:
                rel = arq.relative_to(pasta_sessao).as_posix()
                arquivos.append((arq, f"{slug}/{rel}"))
    return [
        (abs_, rel) for abs_, rel in arquivos
        if not deve_excluir(rel, excluir) and not deve_excluir(str(abs_), excluir)
    ]


def verificacao_final(pasta_saida: Path, padroes_pessoais: list[str]) -> list[str]:
    """Varre TODO arquivo escrito. Devolve a lista de problemas (arquivo + motivo), NUNCA o valor
    que casou. Lista vazia == pode ficar. Caminho relatado é RELATIVO a `pasta_saida` (que pode ser
    uma pasta de staging temporária, issue #15/S2) -- nunca expõe o caminho absoluto do temp dir."""
    padroes_pessoais_lower = [p.lower() for p in padroes_pessoais]
    problemas: list[str] = []
    for arq in sorted(pasta_saida.rglob("*.jsonl")):
        rel = arq.relative_to(pasta_saida)
        texto = arq.read_text(encoding="utf-8")
        for nome, padrao in PADROES_DE_SEGREDO.items():
            if padrao.search(texto):
                problemas.append(f"{rel}: padrao de segredo '{nome}' presente apos sanitizacao")
        if '"type": "image"' in texto or '"type":"image"' in texto:
            problemas.append(f"{rel}: ainda tem bloco de imagem nao removido")
        # S4 (achado da exportacao real, issue #15): NUNCA `texto.splitlines()` aqui -- ele quebra em
        # ~9 caracteres (\n, \r, \v, \f, \x1c-\x1e, U+0085, U+2028, U+2029), mas `json.dumps` (linha
        # 308, ensure_ascii=False) so' e' obrigado a escapar controle U+0000-U+001F -- um valor string
        # com U+0085/U+2028/U+2029 sobrevive CRU na saida. Um so' registro valido com um desses
        # embutido virava 2+ "linhas" falsas aqui, cada uma invalida isolada (achado ao vivo: 2
        # registros reais da sessao da coordenacao geraram 4 "linhas invalidas" reportadas, nenhuma
        # de verdade quebrada). So' separar por `\n` REAL, em bytes, corresponde 1:1 ao que
        # `sanitizar_arquivo_jsonl` escreveu.
        for numero, bruto in enumerate(arq.read_bytes().split(b"\n"), start=1):
            linha = bruto.decode("utf-8")
            if not linha.strip():
                continue
            try:
                evento = json.loads(linha)
            except json.JSONDecodeError:
                problemas.append(f"{rel}:{numero}: linha nao e JSON valido depois da sanitizacao")
                continue
            if _contem_padrao_pessoal(evento, padroes_pessoais_lower):
                problemas.append(f"{rel}:{numero}: padrao pessoal presente apos sanitizacao (chave ou valor)")
    return problemas


def _copiar_para_retrato(origem: Path, destino: Path) -> int:
    """S3 (achado da exportação real, issue #15): copia `origem` para `destino` -- um RETRATO
    (fotografia do arquivo naquele instante), porque a sessão de origem pode estar sendo ESCRITA ao
    mesmo tempo que a exportação roda (achado ao vivo: a sessão da coordenação, ainda ativa, causou
    4 linhas finais quebradas no meio da exportação, porque o script lia o arquivo vivo linha a
    linha enquanto ele crescia). Dali em diante, sanitizar/ler só olha para a CÓPIA, nunca mais para
    o arquivo vivo. Se a última linha da cópia não termina em `\n` (escrita pela metade no instante
    exato da cópia), descarta só essa linha final e devolve 1; senão devolve 0. Linha inválida no
    MEIO do arquivo não é tratada aqui -- continua indo para `sanitizar_arquivo_jsonl`, que já pula
    e conta linhas de origem que não são JSON válido."""
    destino.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(origem, destino)
    dados = destino.read_bytes()
    if dados and not dados.endswith(b"\n"):
        pos = dados.rfind(b"\n")
        destino.write_bytes(dados[: pos + 1] if pos != -1 else b"")
        return 1
    return 0


def _sanitizar_todas_as_sessoes(
    config, apenas_sessoes, excluir, staging, retrato, substituicoes, redigir,
    padroes_pessoais_sub, contagens_padroes_pessoais,
) -> tuple[set[str], int, int, int]:
    """Sanitiza cada sessão descoberta para dentro de `staging`, lendo sempre de um RETRATO (S3) em
    `retrato`, nunca do arquivo vivo. Devolve (slugs exportados, total de arquivos, total de linhas
    de origem que não eram JSON válido, total de linhas finais incompletas descartadas)."""
    total_linhas_invalidas = 0
    total_linhas_finais_descartadas = 0
    total_arquivos = 0
    slugs_exportados: set[str] = set()
    for sessao in descobrir_sessoes(config):
        slug = sessao["slug"]
        if apenas_sessoes and slug not in apenas_sessoes:
            continue
        pasta_sessao = Path(sessao["pasta"])
        if not pasta_sessao.is_dir():
            print(f"[sanitizar_ai_logs] AVISO: sessao '{slug}' nao encontrada em {pasta_sessao} -- pulando")
            continue
        slugs_exportados.add(slug)
        for origem, rel in coletar_arquivos_da_sessao(pasta_sessao, slug, excluir):
            retrato_arquivo = retrato / rel
            total_linhas_finais_descartadas += _copiar_para_retrato(origem, retrato_arquivo)
            destino = staging / rel
            total_linhas_invalidas += sanitizar_arquivo_jsonl(
                retrato_arquivo, destino, substituicoes, redigir, padroes_pessoais_sub, contagens_padroes_pessoais
            )
            total_arquivos += 1
    return slugs_exportados, total_arquivos, total_linhas_invalidas, total_linhas_finais_descartadas


def _trocar_pastas_de_sessao(saida: Path, staging: Path, slugs_exportados: set[str]) -> None:
    """S2: troca em `saida` SÓ as pastas de sessão exportadas -- nunca a pasta inteira, então
    qualquer outra coisa que já more em `saida` (`README.md`, `codex/`, uma pasta de sessão de uma
    exportação anterior que não fez parte desta rodada) nunca é tocada."""
    saida.mkdir(parents=True, exist_ok=True)
    for slug in slugs_exportados:
        alvo = saida / slug
        if alvo.exists():
            shutil.rmtree(alvo)
        origem_staging = staging / slug
        if origem_staging.exists():
            shutil.move(str(origem_staging), str(alvo))


def exportar(
    config_path: Path,
    saida: Path,
    apenas_sessoes: list[str] | None = None,
    padroes_pessoais_path: Path | None = None,
) -> int:
    import tempfile

    # Falha cedo, ANTES de escrever qualquer coisa (mais barato que sanitizar tudo e só então
    # descobrir que a rede de segurança de saída não existe).
    padroes_pessoais = carregar_padroes_pessoais_verificacao(
        padroes_pessoais_path or (RAIZ / "_local" / "padroes_pessoais.txt")
    )
    padroes_pessoais_sub = compilar_padroes_pessoais_substituicao(padroes_pessoais)
    contagens_padroes_pessoais = [0] * len(padroes_pessoais)
    config = carregar_config(config_path)
    substituicoes = compilar_substituicoes(config["substituicoes"])
    excluir = config.get("excluir", [])
    redigir = redator_pii_sintetica()

    # S2 (achado da exportacao real, issue #15): escreve primeiro numa pasta de STAGING fora de
    # `saida` -- `saida` (por padrao `ai-logs/`) só é tocada se a verificação final passar, e mesmo
    # assim só nas pastas de SESSÃO exportadas (nunca `ai-logs/README.md` nem `ai-logs/codex/`,
    # porque essas não são pasta de sessão nenhuma). Antes disto, um `shutil.rmtree(saida)` na
    # pasta inteira apagava conteúdo pré-existente que este script nunca gerou.
    with tempfile.TemporaryDirectory(prefix="sanitizar_ai_logs_") as tmp:
        staging = Path(tmp) / "saida"
        staging.mkdir()
        # S3 (achado da exportacao real, issue #15): retrato -- copia de cada arquivo de sessao no
        # instante da exportacao, porque a sessao de origem pode estar sendo escrita ao mesmo tempo
        # (achado ao vivo: a sessao da coordenacao, ainda ativa, quebrou 4 linhas no meio da leitura
        # porque o script lia o arquivo vivo enquanto ele crescia). Dali em diante, tudo le so o
        # retrato, nunca mais o arquivo vivo.
        retrato = Path(tmp) / "retrato"
        retrato.mkdir()

        slugs_exportados, total_arquivos, total_linhas_invalidas, total_linhas_finais_descartadas = (
            _sanitizar_todas_as_sessoes(
                config, apenas_sessoes, excluir, staging, retrato, substituicoes, redigir,
                padroes_pessoais_sub, contagens_padroes_pessoais,
            )
        )
        print(f"[sanitizar_ai_logs] {total_arquivos} arquivo(s) sanitizado(s) (staging, fora de {saida})")
        if total_linhas_invalidas:
            print(f"[sanitizar_ai_logs] AVISO: {total_linhas_invalidas} linha(s) de origem nao eram JSON valido (puladas)")
        if total_linhas_finais_descartadas:
            print(f"[sanitizar_ai_logs] AVISO: {total_linhas_finais_descartadas} linha(s) final(is) incompleta(s) descartada(s) (sessao sendo escrita no instante da copia)")

        problemas = verificacao_final(staging, padroes_pessoais)
        if problemas:
            print("[sanitizar_ai_logs] ABORTADO -- a verificacao final achou:")
            for p in problemas:
                print(f"  - {p}")
            # staging some sozinho no fim do `with` (TemporaryDirectory); `saida` nunca foi tocada.
            return 1

        _trocar_pastas_de_sessao(saida, staging, slugs_exportados)

    print("[sanitizar_ai_logs] verificacao final: zero padrao de segredo, zero padrao pessoal "
          "(chave ou valor), zero bloco de imagem, 100% das linhas JSON validas.")
    for indice, n in enumerate(contagens_padroes_pessoais):
        if n:
            print(f"[sanitizar_ai_logs] padrao #{indice + 1}: {n} substituicao(oes)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=RAIZ / "_local" / "ai-logs-config.json")
    parser.add_argument("--saida", type=Path, default=RAIZ / "ai-logs")
    parser.add_argument("--sessao", action="append", help="exporta so esta sessao (repetivel); default: todas")
    parser.add_argument(
        "--padroes-pessoais", type=Path, default=RAIZ / "_local" / "padroes_pessoais.txt",
        help="lista de padroes pessoais para a VERIFICACAO FINAL (um literal por linha; criado pelo dono)",
    )
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        # import tardio (issue #15): o self-test mora em modulo proprio
        # (`sanitizar_ai_logs_selftest.py`, so' pra caber no teto do guard `file-loc-ceiling`), que
        # por sua vez importa DESTE modulo -- import no topo do arquivo viraria ciclo.
        from sanitizar_ai_logs_selftest import rodar_self_test

        return rodar_self_test()
    return exportar(args.config, args.saida, apenas_sessoes=args.sessao, padroes_pessoais_path=args.padroes_pessoais)


if __name__ == "__main__":
    raise SystemExit(main())
