"""Política de decisão pura — recebe estado e resultado, devolve decisão. Sem relógio, sem rede,
sem LLM."""
from __future__ import annotations

from dominio.decisao import Decisao, TipoDecisao
from dominio.estado_conversa import EstadoDaConversa
from dominio.resultado_cotacao import ResultadoDaCotacao


def decidir(estado: EstadoDaConversa, resultado: ResultadoDaCotacao | None) -> Decisao:
    # Wave 1 (esqueleto permissivo, issue #5 — regra R7 do #16): decisão fixa, só para a tabela de
    # casos nascer vermelha por assertiva. A tabela real entra no commit seguinte.
    return Decisao(TipoDecisao.COTAR)
