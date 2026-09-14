"""`trava_da_conversa` (issue #110): registro de `threading.Lock` por `conversation_id` — serializa
o trecho de cada rota do chat que lê/muta `interfaces.servidor._ESTADOS_EM_MEMORIA`/
`_PRECOS_EM_MEMORIA` e grava a trilha JSONL para a MESMA conversa, sem travar pedidos de conversas
DIFERENTES (roteiro de aceite S2) nem a requisição HTTP inteira (proibido pela coordenação — ver
`## PLANO` na issue). O registro cresce com o número de `conversation_id` já vistos e nunca encolhe
nesta entrega — aceitável no escopo do desafio (mesmo padrão de `_ESTADOS_EM_MEMORIA`, ADR-0005)."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from contextlib import contextmanager

_TRAVAS: dict[str, threading.Lock] = {}
_TRAVA_DO_REGISTRO = threading.Lock()


def _trava_para(conversation_id: str) -> threading.Lock:
    with _TRAVA_DO_REGISTRO:
        trava = _TRAVAS.get(conversation_id)
        if trava is None:
            trava = threading.Lock()
            _TRAVAS[conversation_id] = trava
        return trava


@contextmanager
def trava_da_conversa(conversation_id: str) -> Iterator[None]:
    with _trava_para(conversation_id):
        yield
