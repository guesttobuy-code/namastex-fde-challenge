"""Única porta de entrada para gravar um evento na trilha (issue #7): "nada é escrito em log ou
trilha sem passar pelo redator". Todo campo textual — recursivo em dict/list/tuple — passa por
`redigir_texto` antes de chegar ao `RepositorioDeTrilha`. Quem chama não pode driblar isso porque não
tem acesso direto ao repositório real (só a esta porta).
"""

from __future__ import annotations

from typing import Any

from dominio.eventos_trilha import EventoTrilha
from dominio.redator_pii import redigir_texto


def _redigir_valor(valor: Any, nomes_conhecidos: list[str] | None) -> Any:
    if isinstance(valor, str):
        return redigir_texto(valor, nomes_conhecidos)
    if isinstance(valor, dict):
        return {chave: _redigir_valor(v, nomes_conhecidos) for chave, v in valor.items()}
    if isinstance(valor, (list, tuple)):
        tipo = type(valor)
        return tipo(_redigir_valor(v, nomes_conhecidos) for v in valor)
    return valor


class ServicoDeTrilha:
    def __init__(self, repositorio) -> None:
        self._repositorio = repositorio

    def registrar_evento(self, evento: EventoTrilha, nomes_conhecidos: list[str] | None = None) -> None:
        bruto = evento.to_dict()
        redigido = {chave: _redigir_valor(valor, nomes_conhecidos) for chave, valor in bruto.items()}
        self._repositorio.registrar(redigido)
