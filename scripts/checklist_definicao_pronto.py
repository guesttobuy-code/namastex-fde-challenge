# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Checklist automático dos arquivos obrigatórios da entrega (issue #15, secao 3).

Confere que os artefatos que o enunciado pede existem e nao estao vazios: README.md,
docs/DESAFIO.md, os dois exemplos de execucao em examples/ (cotacao saindo + falha/handoff)
e, se ja existir, o indice ai-logs/README.md com cada sessao citada de fato presente.

Isto NAO e um guard do full-check (nao esta em package.json nem em governance/GUARDS_CATALOG.md) --
e prova desta frente (#15), rodada a mao antes do smoke test em clone limpo. Nao decide o
merge de ninguem.

Uso:
    uv run scripts/checklist_definicao_pronto.py
    (ou) python3 scripts/checklist_definicao_pronto.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def arquivo_ok(caminho: Path) -> tuple[bool, str]:
    if not caminho.exists():
        return False, f"AUSENTE: {caminho}"
    if caminho.stat().st_size == 0:
        return False, f"VAZIO: {caminho}"
    return True, f"ok: {caminho} ({caminho.stat().st_size} bytes)"


def checar_exemplos() -> list[tuple[bool, str]]:
    pasta = RAIZ / "examples"
    if not pasta.is_dir():
        return [(False, "AUSENTE: pasta examples/ inteira")]
    execucoes = sorted(pasta.glob("execucao_conv-*.log"))
    trilhas = sorted(pasta.glob("trilha_conv-*.jsonl"))
    resultados: list[tuple[bool, str]] = []
    resultados.append((
        len(execucoes) >= 2,
        f"{'ok' if len(execucoes) >= 2 else 'FALTA'}: {len(execucoes)} execucao_conv-*.log "
        f"(exige >=2: uma com cotacao, uma com falha/handoff)",
    ))
    resultados.append((
        len(trilhas) >= 2,
        f"{'ok' if len(trilhas) >= 2 else 'FALTA'}: {len(trilhas)} trilha_conv-*.jsonl",
    ))
    for arq in [*execucoes, *trilhas]:
        resultados.append(arquivo_ok(arq))
    return resultados


def checar_ai_logs_indice() -> list[tuple[bool, str]]:
    indice = RAIZ / "ai-logs" / "README.md"
    if not indice.exists():
        return [(False, "PENDENTE (fase 2 desta frente, ainda nao exportado): ai-logs/README.md")]
    ok, msg = arquivo_ok(indice)
    resultados = [(ok, msg)]
    if not ok:
        return resultados
    texto = indice.read_text(encoding="utf-8")
    citados = set(re.findall(r"`([^`]+\.(?:jsonl|md))`", texto))
    if not citados:
        resultados.append((False, "ai-logs/README.md nao cita nenhum arquivo entre crases (`...`)"))
    for nome in sorted(citados):
        candidato = RAIZ / "ai-logs" / nome
        if not candidato.exists():
            candidato = next(iter((RAIZ / "ai-logs").rglob(nome)), None)
        if candidato is None or not candidato.exists():
            resultados.append((False, f"ai-logs/README.md cita '{nome}' mas o arquivo nao existe"))
        else:
            resultados.append(arquivo_ok(candidato))
    return resultados


def main() -> int:
    checagens: list[tuple[bool, str]] = [
        arquivo_ok(RAIZ / "README.md"),
        arquivo_ok(RAIZ / "docs" / "DESAFIO.md"),
        *checar_exemplos(),
        *checar_ai_logs_indice(),
    ]
    for ok, msg in checagens:
        print(("[OK]   " if ok else "[FALHA]") + " " + msg)
    falhou = [msg for ok, msg in checagens if not ok]
    print()
    if falhou:
        print(f"{len(falhou)} item(ns) reprovado(s).")
        return 1
    print("Todos os itens do checklist estao presentes e nao-vazios.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
