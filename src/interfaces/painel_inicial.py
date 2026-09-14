"""`aquecer_painel_em_segundo_plano` (issue #89, R1 da auditoria fria): logo depois de `docker
compose up --build`, o painel foi gerado em BUILD-TIME sem rede para a `quote-api` (`Dockerfile`) —
`/painel/regras.html` mostra o buraco de `GET /planos` até a primeira cotação ou handoff chamar
`gerar_paineis` de novo em runtime (`servidor.py`, nas rotas de `/api/chat/cotar`/`contratar`). Como
a `quote-api` simula 20% de falha, essa primeira regeneração pode não vir logo — o avaliador que
abrir `/painel/regras.html` sem cotar nada vê o buraco por tempo indeterminado.

Este módulo NÃO muda `buscar_planos` (`infra/planos_http.py`, 1 tentativa de 2s, sem retry — dono
único do cliente de `/planos`, LEI 11) nem `gerar_paineis`: só tenta `buscar_planos` mais vezes,
numa thread separada, e chama `gerar_paineis` de novo assim que a `/quote` responder — a MESMA
chamada que `servidor.py` já faz depois de cada cotação, só que também no boot."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable

from aplicacao.portas.repositorio_contato import RepositorioDeContato
from interfaces.painel.gerar import gerar_paineis

_LOG = logging.getLogger(__name__)


def _tentar_ate_a_quote_responder(
    *,
    buscar_planos: Callable[[], dict | None],
    trilha_dir: Path,
    painel_dir: Path,
    repositorio_contato: RepositorioDeContato | None,
    max_tentativas: int,
    espera_segundos: float,
) -> None:
    for tentativa in range(1, max_tentativas + 1):
        planos = buscar_planos()
        if planos is not None:
            gerar_paineis(trilha_dir, painel_dir, repositorio_contato=repositorio_contato)
            _LOG.info("painel aquecido na tentativa %d/%d de GET /planos", tentativa, max_tentativas)
            return
        if tentativa < max_tentativas:
            time.sleep(espera_segundos)
    _LOG.warning(
        "painel NÃO aquecido: /planos não respondeu em %d tentativas — o buraco some na primeira "
        "cotação ou handoff, que já chama gerar_paineis de qualquer forma",
        max_tentativas,
    )


def aquecer_painel_em_segundo_plano(
    *,
    buscar_planos: Callable[[], dict | None],
    trilha_dir: Path,
    painel_dir: Path,
    repositorio_contato: RepositorioDeContato | None = None,
    max_tentativas: int = 10,
    espera_segundos: float = 2.0,
) -> threading.Thread:
    """Dispara a tentativa numa `Thread(daemon=True)` e devolve na hora — NUNCA atrasa o boot do
    servidor (`interfaces.servidor.main`, chamado antes do `make_server`). `daemon=True`: se o
    processo morrer, a thread morre junto, nunca segura o `docker stop`."""
    thread = threading.Thread(
        target=_tentar_ate_a_quote_responder,
        kwargs={
            "buscar_planos": buscar_planos,
            "trilha_dir": trilha_dir,
            "painel_dir": painel_dir,
            "repositorio_contato": repositorio_contato,
            "max_tentativas": max_tentativas,
            "espera_segundos": espera_segundos,
        },
        daemon=True,
    )
    thread.start()
    return thread
