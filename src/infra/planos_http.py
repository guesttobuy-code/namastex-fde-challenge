"""Cliente mínimo e só-leitura do `GET /planos` do quote-service, para a tela Regras (escopo #13,
regra 3: "esta tela lê a tabela do serviço de cotação", nunca redigita números). Timeout curto e
falha silenciosa controlada — se o serviço não estiver de pé na geração, quem chama recebe `None`
e mostra o buraco visível; nunca um valor de memória fingindo ser a tabela real.

A URL vem de `infra.config.url_quote_service()` — mesma função que `interfaces/cli.py` usa para a
`/quote`, depois do rebase pós-#35 (achado da coordenação, LEI 11: antes do merge, os dois liam
`QUOTE_SERVICE_URL` cada um do seu jeito).

Prazo de PAREDE real (issue #67, mesma classe de defeito do cliente da `/quote`): `getaddrinfo`
(DNS) não respeita o `timeout` do `urlopen`/`socket` neste ambiente — medido ao vivo, uma chamada
a `/planos` com o serviço fora do ar levou ~4,4s contra os `TIMEOUT_SEGUNDOS=2.0` configurados, e
essa chamada roda em TODA geração de painel (`gerar_paineis` -> `tela_regras`), inclusive depois
de cada turno do chat — os segundos extras somavam direto ao orçamento de 10s do cliente da
`/quote` (ADR-0002), estourando a promessa de handoff em ~10s. `buscar_planos` roda num worker
próprio, com `future.result(timeout=TIMEOUT_SEGUNDOS)` como árbitro final; estourado o prazo, o
resultado é o MESMO `None` que já existia (buraco visível) — nenhum comportamento novo, só o
tempo de parede fica de verdade sob controle.
"""

from __future__ import annotations

import concurrent.futures
import json
import urllib.error
import urllib.request

from infra.config import url_quote_service

TIMEOUT_SEGUNDOS = 2.0


def _buscar_planos_via_urllib(base_url: str) -> dict:
    with urllib.request.urlopen(f"{base_url}/planos", timeout=TIMEOUT_SEGUNDOS) as resposta:
        return json.loads(resposta.read().decode("utf-8"))


def buscar_planos(base_url: str | None = None) -> dict | None:
    base_url = base_url if base_url is not None else url_quote_service()
    executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    futuro = executor.submit(_buscar_planos_via_urllib, base_url)
    try:
        return futuro.result(timeout=TIMEOUT_SEGUNDOS)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError, concurrent.futures.TimeoutError):
        return None
    finally:
        executor.shutdown(wait=False)


def ids_dos_planos(dados: dict | None) -> tuple[str, ...]:
    """Extrai os ids de `buscar_planos()` (achado B2 da auditoria do PR #45, F13/#43): a base de
    conhecimento usa isto para saber quais marcadores `franquia_<id>` existem, sem duplicar o
    parsing da forma da `/planos` (LEI 11 — `tela_regras.py` já lê `planos.get("planos", [])`).
    `dados=None` (serviço fora do ar) devolve tupla vazia — buraco visível, nunca id inventado."""
    if not dados:
        return ()
    return tuple(plano["id"] for plano in dados.get("planos", []) if plano.get("id"))
