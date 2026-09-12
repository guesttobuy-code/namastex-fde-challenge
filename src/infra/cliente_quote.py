"""Motor de retry/orçamento do cliente HTTP da `/quote` (issue #6).

A tradução para o domínio (`dominio.ResultadoDaCotacao`/`PrecoCotado`) ainda não mora aqui: a F2
(#5) não tinha mergeado quando este módulo nasceu, e a matriz de impacto (LEI 11) proíbe importar
branch alheia antes do merge. Este arquivo cobre só a parte que não depende de nada em voo — o
transporte HTTP e a política de retry — exatamente como a encomenda da #6 pediu. A tradução entra
em commit próprio depois do rebase sobre a #5 mergeada.

Política de retry — decidida e medida na issue #3 (150 ciclos, serial, contra o serviço real em
Docker), colada aqui e **nunca redecida**:

    3s por tentativa, até 3 tentativas, espera de 0,4s e 0,8s entre elas,
    orçamento total de ~10s (timeout da tentativa = min(3s, orçamento_restante)).
    5xx e timeout repetem; 422 e 400 são terminais e NUNCA repetem.

`FakeTransporteQuote` é o dublê determinístico desta camada (issue #6): simula os corpos reais do
quote-service — medidos ao vivo contra `quote-service/app/{main,quote_logic}.py` em execução — sem
rede e sem esperar tempo de parede de verdade (usa `RelogioFake`, abaixo).
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Callable

TIMEOUT_POR_TENTATIVA_SEGUNDOS = 3.0
MAX_TENTATIVAS = 3
ORCAMENTO_TOTAL_SEGUNDOS = 10.0
ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS = (0.4, 0.8)

_STATUS_QUE_REPETE = frozenset({500, 502, 503})


@dataclass(frozen=True)
class RespostaBruta:
    """Uma tentativa HTTP, antes de traduzir para o domínio. Não atravessa a fronteira de
    `infra` — quem consome isto é só o próprio `ClienteQuoteHTTP` (e o teste de retry)."""

    status_code: int | None
    corpo: dict | None
    excedeu_o_tempo: bool = False


Transporte = Callable[[dict, float], RespostaBruta]


def _e_retentavel(resposta: RespostaBruta) -> bool:
    """5xx e timeout repetem; qualquer outra coisa (200, 4xx) é terminal — issue #6."""
    if resposta.excedeu_o_tempo:
        return True
    return resposta.status_code in _STATUS_QUE_REPETE


class ClienteQuoteHTTP:
    """Adaptador HTTP real da `/quote`, com o motor de retry/orçamento.

    `transporte` é o ponto de injeção do teste: por padrão faz a chamada de verdade via
    `urllib` (stdlib — regime enxuto, sem dependência nova para uma chamada HTTP síncrona só).
    `relogio`/`dormir` também são injetáveis para o teste de orçamento não depender de tempo de
    parede real (`RelogioFake`, abaixo).
    """

    def __init__(
        self,
        base_url: str,
        transporte: Transporte | None = None,
        relogio: Callable[[], float] = time.monotonic,
        dormir: Callable[[float], None] = time.sleep,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._transporte = transporte or self._post_via_urllib
        self._relogio = relogio
        self._dormir = dormir

    def _post_via_urllib(self, payload: dict, timeout_segundos: float) -> RespostaBruta:
        dados = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self._base_url}/quote",
            data=dados,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            resp = urllib.request.urlopen(req, timeout=timeout_segundos)  # noqa: S310 (URL é config nossa, não input externo)
        except urllib.error.HTTPError as erro:
            corpo = json.loads(erro.read().decode("utf-8"))
            return RespostaBruta(status_code=erro.code, corpo=corpo)
        except TimeoutError:
            return RespostaBruta(status_code=None, corpo=None, excedeu_o_tempo=True)
        except urllib.error.URLError as erro:
            if isinstance(erro.reason, TimeoutError):
                return RespostaBruta(status_code=None, corpo=None, excedeu_o_tempo=True)
            raise
        else:
            with resp:
                corpo = json.loads(resp.read().decode("utf-8"))
                return RespostaBruta(status_code=resp.status, corpo=corpo)

    def executar_com_orcamento(self, payload: dict) -> RespostaBruta:
        """Tenta até `MAX_TENTATIVAS` vezes, sem nunca ultrapassar `ORCAMENTO_TOTAL_SEGUNDOS`.
        Só repete o que `_e_retentavel` aceita (5xx, timeout); qualquer outra resposta volta na
        hora, sem consumir as tentativas restantes."""
        prazo_final = self._relogio() + ORCAMENTO_TOTAL_SEGUNDOS
        resposta = None
        for indice in range(MAX_TENTATIVAS):
            tempo_restante = prazo_final - self._relogio()
            if tempo_restante <= 0:
                break
            timeout = min(TIMEOUT_POR_TENTATIVA_SEGUNDOS, tempo_restante)
            resposta = self._transporte(payload, timeout)
            if not _e_retentavel(resposta):
                return resposta
            e_a_ultima_tentativa = indice == MAX_TENTATIVAS - 1
            if e_a_ultima_tentativa:
                break
            tempo_restante = prazo_final - self._relogio()
            if tempo_restante <= 0:
                break
            self._dormir(min(ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS[indice], tempo_restante))
        return resposta


class RelogioFake:
    """Relógio determinístico para teste de orçamento — nenhum teste de retry espera tempo de
    parede real. `avancar` serve tanto de `relogio` (leitura) quanto de `dormir` (avanço)."""

    def __init__(self, inicio: float = 0.0) -> None:
        self.agora = inicio

    def __call__(self) -> float:
        return self.agora

    def avancar(self, segundos: float) -> None:
        self.agora += segundos


@dataclass
class FakeTransporteQuote:
    """Dublê determinístico do transporte HTTP (issue #6). `roteiro` é a sequência de respostas
    programadas, uma por chamada — a última se repete se a lista acabar antes das tentativas.

    Uma resposta com `demora_segundos` simula um servidor lento: quando chamado, o dublê avança o
    `relogio` compartilhado em `min(demora_segundos, timeout_pedido)` — exatamente como um socket
    real que é cortado no timeout — e só devolve a resposta programada se ela coube dentro do
    timeout; senão devolve timeout (`excedeu_o_tempo=True`), do jeito que `_post_via_urllib` faria.
    """

    roteiro: list[RespostaBruta]
    relogio: RelogioFake
    demoras_segundos: list[float] = field(default_factory=list)
    chamadas: list[float] = field(default_factory=list, init=False)

    def __call__(self, payload: dict, timeout_segundos: float) -> RespostaBruta:
        indice = len(self.chamadas)
        self.chamadas.append(timeout_segundos)
        demora = self.demoras_segundos[indice] if indice < len(self.demoras_segundos) else 0.0
        gasto = min(demora, timeout_segundos)
        self.relogio.avancar(gasto)
        if demora > timeout_segundos:
            return RespostaBruta(status_code=None, corpo=None, excedeu_o_tempo=True)
        indice_resposta = min(indice, len(self.roteiro) - 1)
        return self.roteiro[indice_resposta]

    @property
    def numero_de_chamadas(self) -> int:
        return len(self.chamadas)
