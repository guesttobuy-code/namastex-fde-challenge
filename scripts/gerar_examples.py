"""Gera os exemplos E1-E3 do entregavel C4 (`examples/`) — issue #89, roteiro E1-E5 da #15.

Roda a CLI de ponta a ponta contra o `quote-api` real (`docker compose up`, porta 8000 por
padrao), gravando `execucao_<id>.log` e `trilha_<id>.jsonl`/`.log` em `examples/`, exatamente como
uma conversa interativa de verdade grava — sem mock, sem LLM (E4/E5 pedem chave e ficam fora
desta rodada: E4 com a coordenacao, roteiro documentado na issue #15).

    PYTHONPATH=src python scripts/gerar_examples.py

E1 — conversa completa, `/quote` real, cotacao com sucesso.
E2 — mesma conversa, `/quote` numa porta morta (indisponibilidade — nunca o container do dono).
E3 — idade 80, recusa de negocio da API (`/quote` real), config comercial default (encaminha).

Cada rodada usa `interfaces.cli.rodar_conversa` (dono unico da geracao dos dois logs — LEI 11);
este script so fornece as respostas e o `base_url`, nunca duplica a logica de conversa.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "src"))

from interfaces.cli import rodar_conversa  # noqa: E402 (precisa do sys.path acima)

_URL_QUOTE_REAL = "http://127.0.0.1:8000"
# Porta sem ninguem escutando (achado #79: tem que ser IP numerico — "localhost" no Windows
# atrasa a recusa de conexao para alem do orcamento por tentativa e mascara "indisponivel" como
# "timeout"). Nunca o container do dono, que continua no ar em 8000 o tempo todo.
_URL_QUOTE_MORTA = "http://127.0.0.1:9999"


def _respostas(lista: list[str]):
    """`entrada` de `rodar_conversa`: devolve uma resposta por chamada, na ordem dos prompts."""
    it = iter(lista)
    return lambda: next(it)


def _rodar(rotulo: str, respostas: list[str], base_url: str) -> Path:
    inicio = time.perf_counter()
    caminho = rodar_conversa(entrada=_respostas(respostas), base_url=base_url)
    duracao = time.perf_counter() - inicio
    print(f"\n=== {rotulo}: {duracao:.3f}s de parede -> {caminho.name} ===\n")
    return caminho


def main() -> None:
    # idade, ano do veiculo, CEP, plano (Enter = essencial), data de inicio (Enter = sem data)
    _respostas_padrao = ["35", "2020", "01310-100", "", ""]
    _rodar("E1 (sucesso)", _respostas_padrao, _URL_QUOTE_REAL)
    _rodar("E2 (quote indisponivel)", _respostas_padrao, _URL_QUOTE_MORTA)
    _rodar("E3 (recusa por idade)", ["80", "2020", "01310-100", "", ""], _URL_QUOTE_REAL)


if __name__ == "__main__":
    main()
