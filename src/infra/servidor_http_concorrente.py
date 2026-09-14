"""`ServidorHTTPConcorrente` (issue #110): mistura `ThreadingMixIn` no `WSGIServer` padrão da
stdlib — cada pedido HTTP vira uma thread nova (`daemon_threads=True`, nenhuma sobrevive ao
processo), em vez do `WSGIServer` de thread única que travava TODOS os pedidos quando um ficava
aberto e ocioso ou demorava (issue #110). Módulo próprio, não dentro de `interfaces.servidor` (já
no teto do `file-loc-ceiling`) — mesmo padrão de `painel_inicial.py`/`rotas_planos_indisponivel.py`.
ADR-0004 continua valendo: zero dependência nova, `socketserver`/`wsgiref` são stdlib."""

from __future__ import annotations

from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer


class ServidorHTTPConcorrente(ThreadingMixIn, WSGIServer):
    daemon_threads = True
