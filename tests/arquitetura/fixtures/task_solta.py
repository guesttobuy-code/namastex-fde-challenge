"""Fixture ruim: task assíncrona criada e solta, sem guardar a referência.
Prova que RUF006/ASYNC110 mordem."""

import asyncio


async def dispara_e_esquece() -> None:
    asyncio.create_task(asyncio.sleep(1))  # RUF006: referência não guardada, task pode ser coletada


async def espera_ocupada(flag: dict) -> None:
    while not flag.get("pronto"):
        await asyncio.sleep(0)  # ASYNC110: busy-wait em vez de um evento real
