"""Adaptador real da porta `PortalDeCotacao` (issue #6): HTTP contra a `/quote`, com o motor de
retry/orçamento e a tradução para o domínio (`dominio.ResultadoDaCotacao`/`PrecoCotado`).

Política de retry — decidida e medida na issue #3 (150 ciclos, serial, contra o serviço real em
Docker), colada aqui e **nunca redecida**:

    3s por tentativa, até 3 tentativas, espera de 0,4s e 0,8s entre elas,
    orçamento total de ~10s (timeout da tentativa = min(3s, orçamento_restante)).
    5xx e timeout repetem; 422 e 400 são terminais e NUNCA repetem.

Cada tentativa recebe o seu próprio `quote_attempt_id` (correlação entre tentativas, não
idempotência — o quote-service não tem esse conceito). Os dois formatos de corpo do 422 medidos
ao vivo contra `quote-service/app/main.py` são distinguidos em `_traduzir`: recusa de negócio
(`{"error": "cotacao_recusada", "motivo": ...}`, de `CotacaoRecusada`) vira `RECUSA_DE_NEGOCIO`;
validação automática do Pydantic (`{"detail": [...]}`) e o 400 de payload malformado
(`{"error": "payload_invalido", "detalhe": ...}`, de `KeyError`/`ValueError`/`TypeError`) viram
`ERRO_DE_PAYLOAD`.

`FakeTransporteQuote` é o dublê determinístico do TRANSPORTE (para testar a política de retry sem
rede) e `FakePortalDeCotacao` é o dublê determinístico da PORTA (para quem consome `cotar()` —
CLI, testes de decisão — sem precisar montar respostas HTTP). Ambos no mesmo arquivo do adaptador
real, no padrão de `infra/trilha_jsonl.py` (F4/#7).
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field
from typing import Callable

from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao

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


@dataclass(frozen=True)
class TentativaObservada:
    """Uma tentativa HTTP já classificada, com os números reais dela — para quem quiser gravar
    `dominio.eventos_trilha.TentativaDeCotacao` (issue #7/#6, ESPECIFICACAO.md §1: "cada chamada,
    não cada cotação"). Vocabulário de `classificacao` idêntico a `StatusCotacao.value`."""

    numero_da_tentativa: int  # 1-based
    quote_attempt_id: str
    resposta: RespostaBruta
    classificacao: str
    latencia_ms: int
    orcamento_restante_ms: int


OnTentativa = Callable[[TentativaObservada], None]


def _e_retentavel(resposta: RespostaBruta) -> bool:
    """5xx e timeout repetem; qualquer outra coisa (200, 4xx) é terminal — issue #6."""
    if resposta.excedeu_o_tempo:
        return True
    return resposta.status_code in _STATUS_QUE_REPETE


def _classificar(resposta: RespostaBruta) -> str:
    """HTTP -> vocabulário fechado de `classificacao` (ESPECIFICACAO.md §1, igual a
    `StatusCotacao.value`). Usado tanto pela tradução final (`_traduzir`) quanto pela observação
    por tentativa (`TentativaObservada`) — mesma régua nos dois lugares, LEI 11."""
    if resposta.excedeu_o_tempo:
        return "timeout"
    if resposta.status_code == 200:
        return "sucesso"
    corpo = resposta.corpo or {}
    if resposta.status_code == 422:
        return "recusa_de_negocio" if "motivo" in corpo else "erro_de_payload"
    if resposta.status_code == 400:
        return "erro_de_payload"
    return "indisponivel"


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

    def executar_com_orcamento(
        self, payload: dict, on_tentativa: OnTentativa | None = None
    ) -> tuple[str, RespostaBruta]:
        """Tenta até `MAX_TENTATIVAS` vezes, sem nunca ultrapassar `ORCAMENTO_TOTAL_SEGUNDOS`.
        Só repete o que `_e_retentavel` aceita (5xx, timeout); qualquer outra resposta volta na
        hora, sem consumir as tentativas restantes. Devolve, junto com a resposta final, o
        `quote_attempt_id` daquela tentativa específica (correlação, não idempotência — cada
        tentativa recebe o seu próprio, mesmo dentro da mesma chamada a `cotar`).

        `on_tentativa`, se passado, é chamado depois de CADA tentativa (não só a final) com os
        números reais dela — é o ponto de injeção para quem grava `TentativaDeCotacao` na trilha
        (issue #7/#6, ESPECIFICACAO.md §1: "cada chamada, não cada cotação")."""
        prazo_final = self._relogio() + ORCAMENTO_TOTAL_SEGUNDOS
        quote_attempt_id = ""
        resposta = None
        for indice in range(MAX_TENTATIVAS):
            tempo_restante = prazo_final - self._relogio()
            if tempo_restante <= 0:
                break
            timeout = min(TIMEOUT_POR_TENTATIVA_SEGUNDOS, tempo_restante)
            quote_attempt_id = uuid.uuid4().hex
            inicio_tentativa = self._relogio()
            resposta = self._transporte(payload, timeout)
            fim_tentativa = self._relogio()
            if on_tentativa:
                on_tentativa(TentativaObservada(
                    numero_da_tentativa=indice + 1,
                    quote_attempt_id=quote_attempt_id,
                    resposta=resposta,
                    classificacao=_classificar(resposta),
                    latencia_ms=round((fim_tentativa - inicio_tentativa) * 1000),
                    orcamento_restante_ms=max(0, round((prazo_final - fim_tentativa) * 1000)),
                ))
            if not _e_retentavel(resposta):
                return quote_attempt_id, resposta
            e_a_ultima_tentativa = indice == MAX_TENTATIVAS - 1
            if e_a_ultima_tentativa:
                break
            tempo_restante = prazo_final - self._relogio()
            if tempo_restante <= 0:
                break
            self._dormir(min(ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS[indice], tempo_restante))
        return quote_attempt_id, resposta

    def cotar(self, payload: dict, conversation_id: str, on_tentativa: OnTentativa | None = None) -> ResultadoDaCotacao:
        """`PortalDeCotacao.cotar` — o único método que a `aplicacao` conhece. Roda o motor de
        retry e traduz o resultado para o domínio (`_traduzir`, abaixo). `on_tentativa` repassado
        verbatim para `executar_com_orcamento`."""
        quote_attempt_id, resposta = self.executar_com_orcamento(payload, on_tentativa=on_tentativa)
        return _traduzir(resposta, quote_attempt_id, conversation_id)


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


def _resumir_erro_de_validacao(corpo: dict) -> str:
    """Achata o corpo de validação automática do Pydantic (`{"detail": [{"loc": [...], "msg":
    ...}, ...]}`, medido ao vivo contra `quote-service/app/main.py`) numa frase — é o `motivo`
    que `ResultadoDaCotacao.erro_de_payload` carrega."""
    detalhes = corpo.get("detail")
    if not detalhes:
        return "payload rejeitado (422 sem 'detail')"
    partes = []
    for item in detalhes:
        campo = ".".join(str(p) for p in item.get("loc", ()) if p != "body")
        msg = item.get("msg", "campo inválido")
        partes.append(f"{campo}: {msg}" if campo else msg)
    return "; ".join(partes)


def _traduzir(resposta: RespostaBruta, quote_attempt_id: str, conversation_id: str) -> ResultadoDaCotacao:
    """HTTP -> domínio. Os shapes vieram de medir `quote-service/app/{main,quote_logic}.py` ao
    vivo (docker compose), não foram inventados — ver o docstring do módulo."""
    if resposta.excedeu_o_tempo:
        return ResultadoDaCotacao.timeout(
            f"a /quote não respondeu dentro do orçamento de {ORCAMENTO_TOTAL_SEGUNDOS:.0f}s de retry"
        )
    corpo = resposta.corpo or {}
    if resposta.status_code == 200:
        return ResultadoDaCotacao.sucesso(PrecoCotado.de_resposta_http_200(quote_attempt_id, conversation_id, corpo))
    if resposta.status_code == 422:
        if "motivo" in corpo:
            # {"error": "cotacao_recusada", "motivo": ...} -- CotacaoRecusada, recusa de negócio.
            return ResultadoDaCotacao.recusa_de_negocio(corpo["motivo"])
        # {"detail": [...]} -- validação automática do Pydantic contra QuoteRequest.
        return ResultadoDaCotacao.erro_de_payload(_resumir_erro_de_validacao(corpo))
    if resposta.status_code == 400:
        # {"error": "payload_invalido", "detalhe": ...} -- KeyError/ValueError/TypeError em cotar().
        return ResultadoDaCotacao.erro_de_payload(corpo.get("detalhe", "payload inválido (400 sem 'detalhe')"))
    return ResultadoDaCotacao.indisponivel(
        f"upstream respondeu {resposta.status_code} após esgotar as {MAX_TENTATIVAS} tentativas"
    )


@dataclass
class FakePortalDeCotacao:
    """Dublê determinístico da PORTA `PortalDeCotacao` (issue #6) — para quem consome `cotar()`
    (a CLI, testes de política/decisão), não para testar o motor de retry (isso é
    `FakeTransporteQuote`, acima). `roteiro` é a sequência de `ResultadoDaCotacao` prontos, um por
    chamada — o último se repete se a lista acabar antes das chamadas feitas."""

    roteiro: list[ResultadoDaCotacao]
    chamadas: list[dict] = field(default_factory=list, init=False)

    def cotar(self, payload: dict, conversation_id: str, on_tentativa=None) -> ResultadoDaCotacao:
        # `on_tentativa` aceito só para bater a assinatura de PortalDeCotacao — este dublê simula
        # o RESULTADO final da porta, não tentativas HTTP individuais (isso é FakeTransporteQuote,
        # que simula o transporte e portanto tem tentativas de verdade para observar).
        del on_tentativa
        self.chamadas.append({"payload": payload, "conversation_id": conversation_id})
        indice = min(len(self.chamadas) - 1, len(self.roteiro) - 1)
        return self.roteiro[indice]
