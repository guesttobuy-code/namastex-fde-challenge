"""Fixture ruim: log no lugar de exception, erro vira só linha e o programa segue.
Prova que TRY400/TRY300 mordem."""

import logging

logger = logging.getLogger(__name__)


def cotar_com_log_silencioso(preco: float) -> float:
    try:
        if preco < 0:
            raise ValueError("preco negativo")
        return preco  # TRY300: devia estar num `else`, não no fim do `try`
    except ValueError as erro:
        logger.error("falhou: %s", erro)  # TRY400: devia ser logger.exception
        return 0.0
