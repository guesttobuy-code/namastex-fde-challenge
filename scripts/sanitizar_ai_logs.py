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
  1b. Le, SEPARADAMENTE, a lista de padroes PESSOAIS para a VERIFICACAO FINAL de
     `_local/padroes_pessoais.txt` (tambem nunca commitado) -- um arquivo distinto do de cima, DE
     PROPOSITO: este e criado pelo DONO, nao pela mesma sessao que decide a substituicao, para a
     checagem final ser um segundo par de olhos independente (achado do ensaio de congelamento,
     issue #15: `snapshot.trackedFileBackups` vazava nome completo e usuario do Windows por uma
     CHAVE de dict que a substituicao nunca cobria -- e a verificacao antiga so conferia segredo,
     passando limpa mesmo com o vazamento). Arquivo ausente ou vazio = ERRO, ANTES de escrever
     qualquer coisa.
  2. Para cada sessao configurada, le o `.jsonl` principal e cada `.jsonl` de `subagents/`
     (recursivo), PULANDO os arquivos da lista `excluir` (ex.: a transcricao do incidente).
  3. Em cada linha (um evento JSON por linha): substitui todo bloco `{"type": "image", ...}` por
     um bloco de texto `[IMAGEM REMOVIDA: captura de tela do dono]`; aplica os padroes pessoais e
     o redator de PII sintetica (`dominio.redator_pii.redigir_texto`) em TODO valor string da
     arvore, E em toda CHAVE de dict (nao so em campos de texto conhecidos -- a estrutura das
     sessoes tem muitos tipos de evento, e caminho/segredo pode aparecer em qualquer um deles,
     inclusive como chave).
  4. Escreve o resultado em `ai-logs/<slug>/...`, espelhando a mesma estrutura de pastas.
  5. VERIFICACAO FINAL, sobre o que foi ESCRITO (nunca sobre a memoria): conta ocorrencias dos
     padroes de segredo conhecidos (prefixos de token) e dos padroes PESSOAIS do passo 1b (em
     CHAVE e em valor), alem de blocos de imagem remanescentes, e confere que toda linha de todo
     arquivo gerado continua sendo JSON valido. Qualquer ocorrencia ABORTA a exportacao inteira
     (apaga o que foi escrito) e imprime a LISTA DE ARQUIVOS afetados -- nunca o valor que casou.

Uso:
    uv run scripts/sanitizar_ai_logs.py --config _local/ai-logs-config.json
    uv run scripts/sanitizar_ai_logs.py --config ... --saida _local/ai-logs-teste  (ensaio, nao mexe em ai-logs/)
    uv run scripts/sanitizar_ai_logs.py --self-test   (roteiro de mutacao: planta chave falsa, mostra abortando)

Padroes pessoais para a verificacao final: `_local/padroes_pessoais.txt`, um LITERAL por linha
(nao regex), comparacao sem caixa, linhas vazias/'#' ignoradas -- criado pelo DONO, nunca por esta
sessao. Sem ele, o script recusa exportar (nenhum ai-logs sai sem essa rede de seguranca).
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


def sanitizar_string(texto: str, substituicoes: list[tuple[re.Pattern[str], str]], redigir) -> str:
    for padrao, por in substituicoes:
        texto = padrao.sub(por, texto)
    texto = redigir(texto)
    for padrao in PADROES_PII_SEM_FRONTEIRA:
        texto = padrao.sub("[REDIGIDO]", texto)
    return texto


def sanitizar_valor(valor, substituicoes, redigir):
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
            k_sanitizada = sanitizar_string(k, substituicoes, redigir) if isinstance(k, str) else k
            if k_sanitizada in resultado and k_sanitizada != k:
                colisoes.append(k_sanitizada)
            resultado[k_sanitizada] = sanitizar_valor(v, substituicoes, redigir)
        if colisoes:
            raise ValueError(
                f"colisao de chave apos sanitizar (dado real ausente se omite, nunca se funde em "
                f"silencio): {len(colisoes)} chave(s) sanitizada(s) colidiram no mesmo dict"
            )
        return resultado
    if isinstance(valor, list):
        return [sanitizar_valor(v, substituicoes, redigir) for v in valor]
    if isinstance(valor, str):
        return sanitizar_string(valor, substituicoes, redigir)
    return valor


def sanitizar_arquivo_jsonl(origem: Path, destino: Path, substituicoes, redigir) -> int:
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
            sanitizado = sanitizar_valor(evento, substituicoes, redigir)
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
    que casou. Lista vazia == pode ficar."""
    padroes_pessoais_lower = [p.lower() for p in padroes_pessoais]
    problemas: list[str] = []
    for arq in sorted(pasta_saida.rglob("*.jsonl")):
        texto = arq.read_text(encoding="utf-8")
        for nome, padrao in PADROES_DE_SEGREDO.items():
            if padrao.search(texto):
                problemas.append(f"{arq}: padrao de segredo '{nome}' presente apos sanitizacao")
        if '"type": "image"' in texto or '"type":"image"' in texto:
            problemas.append(f"{arq}: ainda tem bloco de imagem nao removido")
        for numero, linha in enumerate(texto.splitlines(), start=1):
            if not linha.strip():
                continue
            try:
                evento = json.loads(linha)
            except json.JSONDecodeError:
                problemas.append(f"{arq}:{numero}: linha nao e JSON valido depois da sanitizacao")
                continue
            if _contem_padrao_pessoal(evento, padroes_pessoais_lower):
                problemas.append(f"{arq}:{numero}: padrao pessoal presente apos sanitizacao (chave ou valor)")
    return problemas


def exportar(
    config_path: Path,
    saida: Path,
    apenas_sessoes: list[str] | None = None,
    padroes_pessoais_path: Path | None = None,
) -> int:
    # Falha cedo, ANTES de escrever qualquer coisa (mais barato que sanitizar tudo e só então
    # descobrir que a rede de segurança de saída não existe).
    padroes_pessoais = carregar_padroes_pessoais_verificacao(
        padroes_pessoais_path or (RAIZ / "_local" / "padroes_pessoais.txt")
    )
    config = carregar_config(config_path)
    substituicoes = compilar_substituicoes(config["substituicoes"])
    excluir = config.get("excluir", [])
    redigir = redator_pii_sintetica()

    if saida.exists():
        shutil.rmtree(saida)
    saida.mkdir(parents=True)

    total_linhas_invalidas = 0
    total_arquivos = 0
    for sessao in descobrir_sessoes(config):
        slug = sessao["slug"]
        if apenas_sessoes and slug not in apenas_sessoes:
            continue
        pasta_sessao = Path(sessao["pasta"])
        if not pasta_sessao.is_dir():
            print(f"[sanitizar_ai_logs] AVISO: sessao '{slug}' nao encontrada em {pasta_sessao} -- pulando")
            continue
        for origem, rel in coletar_arquivos_da_sessao(pasta_sessao, slug, excluir):
            destino = saida / rel
            total_linhas_invalidas += sanitizar_arquivo_jsonl(origem, destino, substituicoes, redigir)
            total_arquivos += 1

    print(f"[sanitizar_ai_logs] {total_arquivos} arquivo(s) sanitizado(s) em {saida}")
    if total_linhas_invalidas:
        print(f"[sanitizar_ai_logs] AVISO: {total_linhas_invalidas} linha(s) de origem nao eram JSON valido (puladas)")

    problemas = verificacao_final(saida, padroes_pessoais)
    if problemas:
        print("[sanitizar_ai_logs] ABORTADO -- a verificacao final achou:")
        for p in problemas:
            print(f"  - {p}")
        shutil.rmtree(saida)
        return 1

    print("[sanitizar_ai_logs] verificacao final: zero padrao de segredo, zero padrao pessoal "
          "(chave ou valor), zero bloco de imagem, 100% das linhas JSON validas.")
    return 0


def rodar_self_test() -> int:
    """Roteiro de mutacao: planta uma chave FALSA num .jsonl de teste, mostra a exportacao
    abortando; remove a chave, mostra passando limpo. Depois, o achado do ensaio de congelamento
    (issue #15): um padrao pessoal FICTICIO plantado numa CHAVE de dict (nao so em valor) tem que
    abortar do mesmo jeito -- e o arquivo de padroes pessoais ausente tem que abortar ANTES de
    escrever qualquer coisa. Nao toca em nada de `_local/` real (todo caminho e temporario)."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        pasta_sessao = tmp / "sessao-teste"
        pasta_sessao.mkdir()
        principal = pasta_sessao / "conv-teste.jsonl"
        config_path = tmp / "config.json"
        padroes_path = tmp / "padroes_pessoais.txt"
        saida = tmp / "saida"

        config = {
            "raiz_projects": str(tmp),
            "prefixo_frentes": "sessao-",
            "mapa_fixo": {},
            "excluir_pastas": [],
            "substituicoes": [{"regex": "USUARIO_FALSO", "flags": "i", "por": "<usuario>"}],
            "excluir": [],
        }
        config_path.write_text(json.dumps(config), encoding="utf-8")
        padroes_path.write_text("# comentario ignorado\n\nPADRAO-FICTICIO-TESTE\n", encoding="utf-8")

        # 1) com chave falsa plantada -> tem que abortar
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "minha chave e sk-or-v1-" + "a" * 64}}) + "\n",
            encoding="utf-8",
        )
        exit_com_chave = exportar(config_path, saida, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_path)
        saida_existe_depois_do_abort = saida.exists()

        # 2) sem a chave -> tem que passar limpo
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "ola, tudo bem, USUARIO_FALSO?"}}) + "\n",
            encoding="utf-8",
        )
        exit_sem_chave = exportar(config_path, saida, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_path)
        arquivo_saida = saida / "teste" / "conv-teste.jsonl"
        conteudo_final = arquivo_saida.read_text(encoding="utf-8") if arquivo_saida.exists() else ""

        # 3) padrao pessoal ficticio numa CHAVE de dict -> tem que abortar (o achado real: so
        #    checar valor nao pega isso)
        principal.write_text(
            json.dumps({"type": "user", "snapshot": {"trackedFileBackups": {"C:\\x\\PADRAO-FICTICIO-TESTE\\a.py": {"v": 1}}}}) + "\n",
            encoding="utf-8",
        )
        exit_padrao_na_chave = exportar(config_path, saida, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_path)
        saida_existe_apos_chave = saida.exists()

        # 4) padrao pessoal ficticio num VALOR -> tem que abortar
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "texto com PADRAO-FICTICIO-TESTE dentro"}}) + "\n",
            encoding="utf-8",
        )
        exit_padrao_no_valor = exportar(config_path, saida, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_path)
        saida_existe_apos_valor = saida.exists()

        # 5) arquivo de padroes pessoais AUSENTE -> tem que abortar ANTES de escrever qualquer
        #    coisa (SystemExit, nunca silencio)
        padroes_ausente = tmp / "nao-existe-padroes.txt"
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "ola, tudo bem, USUARIO_FALSO?"}}) + "\n",
            encoding="utf-8",
        )
        saida_sem_padroes = tmp / "saida-sem-padroes"
        try:
            exportar(config_path, saida_sem_padroes, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_ausente)
            arquivo_ausente_abortou = False
        except SystemExit:
            arquivo_ausente_abortou = True
        saida_sem_padroes_existe = saida_sem_padroes.exists()

    ok = (
        exit_com_chave == 1
        and not saida_existe_depois_do_abort
        and exit_sem_chave == 0
        and "<usuario>" in conteudo_final
        and "USUARIO_FALSO" not in conteudo_final
        and exit_padrao_na_chave == 1
        and not saida_existe_apos_chave
        and exit_padrao_no_valor == 1
        and not saida_existe_apos_valor
        and arquivo_ausente_abortou
        and not saida_sem_padroes_existe
    )
    print()
    print("[sanitizar_ai_logs] SELF-TEST (roteiro de mutacao):")
    print(f"  chave falsa plantada          -> exit={exit_com_chave} (esperado 1), saida apagada={not saida_existe_depois_do_abort}")
    print(f"  chave removida                -> exit={exit_sem_chave} (esperado 0), substituicao aplicada={'<usuario>' in conteudo_final}")
    print(f"  padrao pessoal na CHAVE       -> exit={exit_padrao_na_chave} (esperado 1), saida apagada={not saida_existe_apos_chave}")
    print(f"  padrao pessoal no valor       -> exit={exit_padrao_no_valor} (esperado 1), saida apagada={not saida_existe_apos_valor}")
    print(f"  arquivo de padroes ausente    -> abortou={arquivo_ausente_abortou} (esperado True), nada escrito={not saida_sem_padroes_existe}")
    print("SELF-TEST OK" if ok else "SELF-TEST FALHOU")
    return 0 if ok else 1


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
        return rodar_self_test()
    return exportar(args.config, args.saida, apenas_sessoes=args.sessao, padroes_pessoais_path=args.padroes_pessoais)


if __name__ == "__main__":
    raise SystemExit(main())
