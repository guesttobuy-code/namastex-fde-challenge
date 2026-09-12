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
  1. Le a lista de padroes PESSOAIS de `_local/ai-logs-padroes-pessoais.json` (NUNCA commitado --
     ver `_local/.gitignore` / `.gitignore` da raiz). Sem esse arquivo, para com erro: dado real
     ausente bloqueia a exportacao, nunca fabrica um padrao vazio (LEI 2).
  2. Para cada sessao configurada, le o `.jsonl` principal e cada `.jsonl` de `subagents/`
     (recursivo), PULANDO os arquivos da lista `excluir` (ex.: a transcricao do incidente).
  3. Em cada linha (um evento JSON por linha): substitui todo bloco `{"type": "image", ...}` por
     um bloco de texto `[IMAGEM REMOVIDA: captura de tela do dono]`; aplica os padroes pessoais e
     o redator de PII sintetica (`dominio.redator_pii.redigir_texto`) em TODO valor string da
     arvore (nao so em campos de texto conhecidos -- a estrutura das sessoes tem muitos tipos de
     evento, e caminho/segredo pode aparecer em qualquer um deles).
  4. Escreve o resultado em `ai-logs/<slug>/...`, espelhando a mesma estrutura de pastas.
  5. VERIFICACAO FINAL, sobre o que foi ESCRITO (nunca sobre a memoria): conta ocorrencias dos
     padroes de segredo conhecidos (prefixos de token) e de blocos de imagem remanescentes, e
     confere que toda linha de todo arquivo gerado continua sendo JSON valido. Qualquer contagem
     > 0 ABORTA a exportacao inteira (apaga o que foi escrito) e imprime a LISTA DE ARQUIVOS
     afetados -- nunca o valor que casou.

Uso:
    uv run scripts/sanitizar_ai_logs.py --config _local/ai-logs-config.json
    uv run scripts/sanitizar_ai_logs.py --config ... --saida _local/ai-logs-teste  (ensaio, nao mexe em ai-logs/)
    uv run scripts/sanitizar_ai_logs.py --self-test   (roteiro de mutacao: planta chave falsa, mostra abortando)
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


def sanitizar_string(texto: str, substituicoes: list[tuple[re.Pattern[str], str]], redigir) -> str:
    for padrao, por in substituicoes:
        texto = padrao.sub(por, texto)
    return redigir(texto)


def sanitizar_valor(valor, substituicoes, redigir):
    if isinstance(valor, dict):
        if valor.get("type") == "image":
            return dict(PLACEHOLDER_IMAGEM)
        return {k: sanitizar_valor(v, substituicoes, redigir) for k, v in valor.items()}
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


def verificacao_final(pasta_saida: Path) -> list[str]:
    """Varre TODO arquivo escrito. Devolve a lista de problemas (arquivo + motivo), NUNCA o valor
    que casou. Lista vazia == pode ficar."""
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
                json.loads(linha)
            except json.JSONDecodeError:
                problemas.append(f"{arq}:{numero}: linha nao e JSON valido depois da sanitizacao")
    return problemas


def exportar(config_path: Path, saida: Path, apenas_sessoes: list[str] | None = None) -> int:
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

    problemas = verificacao_final(saida)
    if problemas:
        print("[sanitizar_ai_logs] ABORTADO -- a verificacao final achou:")
        for p in problemas:
            print(f"  - {p}")
        shutil.rmtree(saida)
        return 1

    print("[sanitizar_ai_logs] verificacao final: zero padrao de segredo, zero bloco de imagem, "
          "100% das linhas JSON validas.")
    return 0


def rodar_self_test() -> int:
    """Roteiro de mutacao: planta uma chave FALSA num .jsonl de teste, mostra a exportacao
    abortando; remove a chave, mostra passando limpo. Nao toca em nada de `_local/` real."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        pasta_sessao = tmp / "sessao-teste"
        pasta_sessao.mkdir()
        principal = pasta_sessao / "conv-teste.jsonl"
        config_path = tmp / "config.json"
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

        # 1) com chave falsa plantada -> tem que abortar
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "minha chave e sk-or-v1-" + "a" * 64}}) + "\n",
            encoding="utf-8",
        )
        exit_com_chave = exportar(config_path, saida, apenas_sessoes=["teste"])
        saida_existe_depois_do_abort = saida.exists()

        # 2) sem a chave -> tem que passar limpo
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "ola, tudo bem, USUARIO_FALSO?"}}) + "\n",
            encoding="utf-8",
        )
        exit_sem_chave = exportar(config_path, saida, apenas_sessoes=["teste"])
        arquivo_saida = saida / "teste" / "conv-teste.jsonl"
        conteudo_final = arquivo_saida.read_text(encoding="utf-8") if arquivo_saida.exists() else ""

    ok = (
        exit_com_chave == 1
        and not saida_existe_depois_do_abort
        and exit_sem_chave == 0
        and "<usuario>" in conteudo_final
        and "USUARIO_FALSO" not in conteudo_final
    )
    print()
    print("[sanitizar_ai_logs] SELF-TEST (roteiro de mutacao):")
    print(f"  chave falsa plantada -> exit={exit_com_chave} (esperado 1), saida apagada={not saida_existe_depois_do_abort}")
    print(f"  chave removida       -> exit={exit_sem_chave} (esperado 0), substituicao aplicada={'<usuario>' in conteudo_final}")
    print("SELF-TEST OK" if ok else "SELF-TEST FALHOU")
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=RAIZ / "_local" / "ai-logs-config.json")
    parser.add_argument("--saida", type=Path, default=RAIZ / "ai-logs")
    parser.add_argument("--sessao", action="append", help="exporta so esta sessao (repetivel); default: todas")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return rodar_self_test()
    return exportar(args.config, args.saida, apenas_sessoes=args.sessao)


if __name__ == "__main__":
    raise SystemExit(main())
