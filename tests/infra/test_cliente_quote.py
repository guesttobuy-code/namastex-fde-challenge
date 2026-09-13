"""Testes do cliente `/quote` (issue #6): motor de retry/orçamento + tradução para o domínio.

Os corpos de resposta simulados abaixo foram medidos ao vivo contra o `quote-service` real
(`docker compose up`, porta 8000), não inventados:
    502 -> {"error": "upstream_unavailable", "message": "..."}
    422 recusa de negócio -> {"error": "cotacao_recusada", "motivo": "..."}
    422 validação Pydantic -> {"detail": [{"type": ..., "loc": [...], "msg": ..., "input": ...}]}
    400 payload inválido -> {"error": "payload_invalido", "detalhe": "..."}

Nenhum destes testes espera tempo de parede real: `RelogioFake` avança quando o cliente chamaria
`time.sleep`, e `FakeTransporteQuote` avança o mesmo relógio para simular uma chamada lenta sendo
cortada no timeout — a suíte inteira roda em milissegundos.
"""
from __future__ import annotations

import io
import json
import time
import urllib.error
from unittest.mock import MagicMock, patch

import pytest

import infra.cliente_quote as cliente_quote_mod
from dominio.resultado_cotacao import StatusCotacao
from infra.cliente_quote import (
    ClienteQuoteHTTP,
    FakePortalDeCotacao,
    FakeTransporteQuote,
    RelogioFake,
    RespostaBruta,
)

PAYLOAD = {"plano_id": "completo", "idade": 30, "veiculo_ano": 2020, "cep": "01310-100"}
CONVERSATION_ID = "conv-123"

_RESPOSTA_502 = RespostaBruta(
    status_code=502,
    corpo={"error": "upstream_unavailable", "message": "Servico de cotacao temporariamente indisponivel. Tente novamente."},
)
_RESPOSTA_200 = RespostaBruta(
    status_code=200,
    corpo={
        "plano_id": "completo",
        "plano_nome": "Completo",
        "premio_mensal": 245.67,
        "franquia": 3000.0,
        "coberturas": ["colisao", "roubo", "furto", "terceiros", "vidros"],
        "moeda": "BRL",
    },
)
_RESPOSTA_422_RECUSA_DE_NEGOCIO = RespostaBruta(
    status_code=422,
    corpo={"error": "cotacao_recusada", "motivo": "Plano 'inexistente' inexistente. Opcoes: essencial, completo, premium"},
)
_RESPOSTA_422_ERRO_DE_PAYLOAD = RespostaBruta(
    status_code=422,
    corpo={"detail": [{"type": "less_than_equal", "loc": ["body", "idade"], "msg": "Input should be less than or equal to 200", "input": 999}]},
)
_RESPOSTA_400_PAYLOAD_INVALIDO = RespostaBruta(
    status_code=400,
    corpo={"error": "payload_invalido", "detalhe": "Invalid isoformat string: '31/12/2026'"},
)


def _cliente(transporte: FakeTransporteQuote, relogio: RelogioFake) -> ClienteQuoteHTTP:
    return ClienteQuoteHTTP("http://quote-service.invalido", transporte=transporte, relogio=relogio, dormir=relogio.avancar)


# ---------------------------------------------------------------------------
# Motor de retry/orçamento (executar_com_orcamento) — sem tradução para o domínio.
# ---------------------------------------------------------------------------


def test_200_feliz_retorna_na_primeira_tentativa_sem_retry():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 1
    assert relogio.agora == pytest.approx(0.0)


def test_5xx_repete_dentro_do_orcamento_e_desiste_no_fim_dele():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 502
    assert transporte.numero_de_chamadas == 3
    # 3 tentativas -> 2 esperas entre elas (0,4s e 0,8s); nenhuma tentativa aqui é lenta.
    assert relogio.agora == pytest.approx(1.2)


@pytest.mark.parametrize("status_code", [500, 502, 503])
def test_5xx_qualquer_um_dos_tres_repete_dentro_do_orcamento(status_code):
    """issue #67, achado de mutação M15: só 502 tinha teste — tirar 500 de `_STATUS_QUE_REPETE`
    ficava verde. Os três (500/502/503) precisam repetir, não só o que já tinha prova."""
    relogio = RelogioFake()
    resposta = RespostaBruta(status_code=status_code, corpo={"error": "upstream_unavailable"})
    transporte = FakeTransporteQuote(roteiro=[resposta], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == status_code
    assert transporte.numero_de_chamadas == 3


def test_5xx_uma_vez_depois_recupera_com_200():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_200], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 2
    assert relogio.agora == pytest.approx(0.4)


def test_200_lento_mas_dentro_do_timeout_da_tentativa_nao_repete():
    """Servidor demora 2s (< 3s do timeout por tentativa): a resposta chega, sem retry."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio, demoras_segundos=[2.0])
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 1
    assert relogio.agora == pytest.approx(2.0)


def test_200_lento_alem_do_orcamento_respeita_o_deadline_de_10s_em_vez_de_esperar_para_sempre():
    """Servidor sempre demora 8s (o pior caso real do quote-service): sem orçamento, seriam 24s
    de espera em 3 tentativas. Com o orçamento de 10s, o cliente desiste em exatamente 10s —
    nunca espera os 8s inteiros de uma tentativa que já não cabe."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio, demoras_segundos=[8.0, 8.0, 8.0])
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.excedeu_o_tempo is True
    assert transporte.numero_de_chamadas == 3
    # tentativa 1: timeout 3s (gasto 3, sobra 7) + espera 0,4s = 3,4
    # tentativa 2: timeout 3s (gasto 3, sobra 3,6) + espera 0,8s = 7,2
    # tentativa 3: timeout min(3, 2,8)=2,8s (gasto 2,8) = 10,0 -> orçamento esgotado, para
    assert relogio.agora == pytest.approx(10.0)
    assert transporte.chamadas == pytest.approx([3.0, 3.0, 2.8])


@pytest.mark.parametrize(
    "resposta_terminal",
    [_RESPOSTA_422_RECUSA_DE_NEGOCIO, _RESPOSTA_422_ERRO_DE_PAYLOAD, _RESPOSTA_400_PAYLOAD_INVALIDO],
    ids=["422-recusa-de-negocio", "422-erro-de-payload-pydantic", "400-payload-invalido"],
)
def test_422_e_400_sao_terminais_e_nunca_repetem(resposta_terminal):
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[resposta_terminal], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado is resposta_terminal
    assert transporte.numero_de_chamadas == 1
    assert relogio.agora == pytest.approx(0.0)


def test_quote_attempt_id_e_diferente_a_cada_tentativa():
    """Correlação entre tentativas, não idempotência (issue #6): cada tentativa (inclusive as que
    não vencem) tem o seu próprio id."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_502, _RESPOSTA_200], relogio=relogio)
    cliente = _cliente(transporte, relogio)

    ids_vistos = set()
    for _ in range(3):
        quote_attempt_id, _resultado = cliente.executar_com_orcamento(PAYLOAD)
        ids_vistos.add(quote_attempt_id)
    # 3 chamadas a executar_com_orcamento (não 3 tentativas de uma só) -> ainda assim, 3 ids distintos.
    assert len(ids_vistos) == 3


# ---------------------------------------------------------------------------
# Tradução para o domínio (cotar) — dominio.ResultadoDaCotacao / PrecoCotado.
# ---------------------------------------------------------------------------


def test_cotar_200_vira_preco_cotado_com_o_quote_attempt_id_da_tentativa_vencedora():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_200], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.SUCESSO
    assert resultado.preco is not None
    assert resultado.preco.conversation_id == CONVERSATION_ID
    assert resultado.preco.premio_mensal == 245.67
    assert resultado.preco.quote_attempt_id  # não vazio


def test_cotar_resposta_sem_campo_obrigatorio_nao_vira_preco_cotado():
    """I-1 do domínio (CONTRACT.md de src/dominio/): PrecoCotado só nasce de resposta completa."""
    relogio = RelogioFake()
    resposta_incompleta = RespostaBruta(status_code=200, corpo={"plano_id": "completo"})  # falta premio_mensal etc.
    transporte = FakeTransporteQuote(roteiro=[resposta_incompleta], relogio=relogio)

    with pytest.raises(ValueError, match="cotação bem-sucedida"):
        _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)


def test_cotar_422_recusa_de_negocio_vira_status_recusa_de_negocio():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_422_RECUSA_DE_NEGOCIO], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.RECUSA_DE_NEGOCIO
    assert resultado.motivo == "Plano 'inexistente' inexistente. Opcoes: essencial, completo, premium"
    assert resultado.preco is None


def test_cotar_422_erro_de_validacao_pydantic_vira_status_erro_de_payload_com_motivo_legivel():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_422_ERRO_DE_PAYLOAD], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.ERRO_DE_PAYLOAD
    assert "idade" in resultado.motivo
    assert "less than or equal to 200" in resultado.motivo


def test_cotar_400_payload_invalido_vira_status_erro_de_payload():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_400_PAYLOAD_INVALIDO], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.ERRO_DE_PAYLOAD
    assert resultado.motivo == "Invalid isoformat string: '31/12/2026'"


def test_cotar_5xx_esgotado_vira_status_indisponivel():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.INDISPONIVEL
    assert "502" in resultado.motivo


def test_cotar_timeout_esgotado_vira_status_timeout():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio, demoras_segundos=[8.0, 8.0, 8.0])
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.TIMEOUT


# ---------------------------------------------------------------------------
# issue #67: falha de transporte (conexão recusada, DNS, corpo não-JSON) — antes subia sem
# tratamento até virar 500 do wsgiref; agora é mais um caso retentável dentro do MESMO orçamento
# (ADR-0002 intacto: só ganha um terceiro gatilho de retry, ao lado de 5xx e timeout).
# ---------------------------------------------------------------------------

_RESPOSTA_FALHA_DE_TRANSPORTE = RespostaBruta(status_code=None, corpo=None, falha_de_transporte=True)


def test_falha_de_transporte_repete_dentro_do_orcamento_e_desiste_no_fim_dele():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_FALHA_DE_TRANSPORTE], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.falha_de_transporte is True
    assert transporte.numero_de_chamadas == 3


def test_falha_de_transporte_uma_vez_depois_recupera_com_200():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_FALHA_DE_TRANSPORTE, _RESPOSTA_200], relogio=relogio)
    _quote_attempt_id, resultado = _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD)

    assert resultado.status_code == 200
    assert transporte.numero_de_chamadas == 2


def test_cotar_falha_de_transporte_esgotada_vira_status_indisponivel_com_motivo_proprio():
    """issue #67, condição da coordenação: motivo distinto de "upstream respondeu None" — não faz
    sentido citar um status HTTP que nunca existiu."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_FALHA_DE_TRANSPORTE], relogio=relogio)
    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.INDISPONIVEL
    assert "conexão" in resultado.motivo
    assert "None" not in resultado.motivo


def test_on_tentativa_de_falha_de_transporte_grava_classificacao_indisponivel_sem_http_status():
    """issue #67, condição da coordenação: a tentativa que falha por transporte vira
    `TentativaDeCotacao` na trilha com status de falha e SEM código HTTP — aqui, na fronteira que
    `aplicacao._registrar_tentativa` consome (`observada.resposta.status_code or 0`,
    `observada.classificacao`), sem precisar tocar `aplicacao`/`conduzir_conversa` (fora do escopo
    desta frente)."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_FALHA_DE_TRANSPORTE, _RESPOSTA_200], relogio=relogio)
    observadas = []

    _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID, on_tentativa=observadas.append)

    primeira = observadas[0]
    assert primeira.classificacao == "indisponivel"
    assert primeira.resposta.status_code is None  # "sem código HTTP" — nunca inventa um


def _http_error(codigo: int, corpo_bytes: bytes) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        url="http://quote-service.invalido/quote", code=codigo, msg="erro", hdrs=None, fp=io.BytesIO(corpo_bytes)
    )


def _cliente_com_transporte_real(relogio: RelogioFake) -> ClienteQuoteHTTP:
    """Mesmo `ClienteQuoteHTTP`, mas sem injetar `transporte=` — usa `_post_via_urllib` de
    verdade (só `relogio`/`dormir` são fakes, para o teste não esperar tempo de parede)."""
    return ClienteQuoteHTTP("http://quote-service.invalido", relogio=relogio, dormir=relogio.avancar)


class TestPostViaUrllibReal:
    """issue #67, achado de mutação M19: o transporte real nunca era executado por nenhum teste —
    todos injetavam `FakeTransporteQuote`. Aqui `urllib.request.urlopen` é mockado (mesmo padrão de
    `tests/infra/test_planos_http.py`) e o cliente é exercitado pela API PÚBLICA
    (`executar_com_orcamento`, nunca `_post_via_urllib` direto — SLF001), então o motor de
    retry/orçamento real também participa da prova."""

    def test_conexao_recusada_vira_falha_de_transporte_nunca_sobe_a_excecao(self):
        relogio = RelogioFake()
        with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("recusado")):
            _id, resposta = _cliente_com_transporte_real(relogio).executar_com_orcamento(PAYLOAD)

        assert resposta.falha_de_transporte is True
        assert resposta.status_code is None

    def test_corpo_nao_json_em_200_vira_falha_de_transporte_nunca_preco_zero(self):
        """Fecha o M19 citado na issue: "fazer um JSON inválido em 200 virar sucesso com preço 0
        ficava verde" — aqui o teste reprova exatamente esse desfecho."""
        resposta_falsa = MagicMock()
        resposta_falsa.status = 200
        resposta_falsa.read.return_value = b"<html>nao e json</html>"
        resposta_falsa.__enter__.return_value = resposta_falsa

        relogio = RelogioFake()
        with patch("urllib.request.urlopen", return_value=resposta_falsa):
            _id, resposta = _cliente_com_transporte_real(relogio).executar_com_orcamento(PAYLOAD)

        assert resposta.falha_de_transporte is True
        assert resposta.corpo is None

    def test_corpo_nao_json_em_erro_vira_falha_de_transporte(self):
        # side_effect com instâncias FRESCAS por chamada (502 é retentável — até 3 tentativas):
        # um `HTTPError` reusado teria o `fp` (BytesIO) esgotado na 2ª leitura, mascarando o que
        # este teste prova.
        relogio = RelogioFake()
        chamadas = [_http_error(502, b"Bad Gateway (texto puro)") for _ in range(3)]
        with patch("urllib.request.urlopen", side_effect=chamadas):
            _id, resposta = _cliente_com_transporte_real(relogio).executar_com_orcamento(PAYLOAD)

        assert resposta.falha_de_transporte is True

    def test_erro_json_valido_continua_traduzido_normalmente(self):
        """Contraprova: o caminho feliz do HTTPError (corpo JSON de verdade) não regride com a
        proteção nova. Instâncias frescas por chamada — mesmo motivo do teste anterior."""
        corpo = json.dumps({"error": "upstream_unavailable", "message": "..."}).encode("utf-8")
        relogio = RelogioFake()
        chamadas = [_http_error(502, corpo) for _ in range(3)]
        with patch("urllib.request.urlopen", side_effect=chamadas):
            _id, resposta = _cliente_com_transporte_real(relogio).executar_com_orcamento(PAYLOAD)

        assert resposta.falha_de_transporte is False
        assert resposta.status_code == 502
        assert resposta.corpo == {"error": "upstream_unavailable", "message": "..."}

    def test_sucesso_com_json_valido_continua_traduzido_normalmente(self):
        resposta_falsa = MagicMock()
        resposta_falsa.status = 200
        resposta_falsa.read.return_value = json.dumps({"plano_id": "completo"}).encode("utf-8")
        resposta_falsa.__enter__.return_value = resposta_falsa

        relogio = RelogioFake()
        with patch("urllib.request.urlopen", return_value=resposta_falsa):
            _id, resposta = _cliente_com_transporte_real(relogio).executar_com_orcamento(PAYLOAD)

        assert resposta.falha_de_transporte is False
        assert resposta.status_code == 200
        assert resposta.corpo == {"plano_id": "completo"}

    def test_erro_nosso_de_programacao_nao_vira_indisponivel_sobe_normalmente(self):
        """Condição explícita da coordenação: um `TypeError` NOSSO (bug de verdade, não falha de
        rede) não pode ser engolido como "quote indisponível" — só `URLError`/`JSONDecodeError`/
        `UnicodeDecodeError` são tratados; qualquer outra exceção sobe, para o teste (e o CI)
        acusarem o bug em vez de escondê-lo atrás de um handoff silencioso."""
        relogio = RelogioFake()
        with patch("urllib.request.urlopen", side_effect=TypeError("bug nosso, nao da rede")):
            with pytest.raises(TypeError):
                _cliente_com_transporte_real(relogio).executar_com_orcamento(PAYLOAD)


# ---------------------------------------------------------------------------
# FakePortalDeCotacao — dublê da PORTA (para quem consome `cotar()`, não o transporte).
# ---------------------------------------------------------------------------


def test_fake_portal_de_cotacao_devolve_o_roteiro_programado_em_ordem():
    from dominio.resultado_cotacao import ResultadoDaCotacao

    sucesso = ResultadoDaCotacao.indisponivel("upstream fora do ar (roteiro de teste)")
    fake = FakePortalDeCotacao(roteiro=[sucesso])

    assert fake.cotar(PAYLOAD, CONVERSATION_ID) is sucesso
    assert fake.cotar(PAYLOAD, CONVERSATION_ID) is sucesso  # roteiro de 1 item repete
    assert len(fake.chamadas) == 2
    assert fake.chamadas[0] == {"payload": PAYLOAD, "conversation_id": CONVERSATION_ID}


# ---------------------------------------------------------------------------
# on_tentativa -- observação POR TENTATIVA (issue #7/#6, ESPECIFICACAO.md §1: "cada chamada, não
# cada cotação"), o ponto de injeção para quem grava TentativaDeCotacao na trilha.
# ---------------------------------------------------------------------------


def test_on_tentativa_e_chamado_uma_vez_por_tentativa_http_com_numeracao_1_based():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_200], relogio=relogio)
    observadas = []

    _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID, on_tentativa=observadas.append)

    assert [o.numero_da_tentativa for o in observadas] == [1, 2]
    assert [o.classificacao for o in observadas] == ["indisponivel", "sucesso"]
    assert all(o.quote_attempt_id for o in observadas)
    assert len({o.quote_attempt_id for o in observadas}) == 2  # um id por tentativa, não reusado


def test_on_tentativa_orcamento_restante_diminui_a_cada_tentativa():
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_502, _RESPOSTA_502, _RESPOSTA_502], relogio=relogio)
    observadas = []

    _cliente(transporte, relogio).executar_com_orcamento(PAYLOAD, on_tentativa=observadas.append)

    restantes = [o.orcamento_restante_ms for o in observadas]
    assert restantes == sorted(restantes, reverse=True)
    assert restantes[0] == 10_000  # nada de latência simulada nas tentativas em si (demora=0)
    assert restantes[-1] == pytest.approx(8_800, abs=1)  # 10s - 0,4s - 0,8s (as duas esperas já tomadas)


def test_on_tentativa_nao_e_chamado_quando_omitido():
    """Regressão trivial: on_tentativa é opcional, o motor não quebra sem ele (é o que o
    FakePortalDeCotacao e todo teste anterior a este já exercitam, mas fica explícito aqui)."""
    relogio = RelogioFake()
    transporte = FakeTransporteQuote(roteiro=[_RESPOSTA_200], relogio=relogio)

    resultado = _cliente(transporte, relogio).cotar(PAYLOAD, CONVERSATION_ID)

    assert resultado.status == StatusCotacao.SUCESSO


# ---------------------------------------------------------------------------
# issue #67, achado de medição ao vivo (docker compose stop quote-api, stack isolada): o timeout
# do urlopen/socket não cobre `getaddrinfo` (DNS) em todo ambiente — uma tentativa mediu ~4s
# contra os 3s configurados, e o orçamento total de ~10s (ADR-0002) estourou para ~13-19s.
# `_chamar_com_prazo_de_parede` usa um worker + relógio de PAREDE real como árbitro final,
# independente da causa do travamento. Constantes reduzidas via monkeypatch (não o `.venv`/tempo
# de parede real do ADR-0002) para o teste rodar em milissegundos, com um `time.sleep` REAL.
# ---------------------------------------------------------------------------


def test_transporte_que_trava_alem_do_prazo_conta_como_timeout_nunca_prende_o_cliente(monkeypatch):
    monkeypatch.setattr(cliente_quote_mod, "TIMEOUT_POR_TENTATIVA_SEGUNDOS", 0.05)
    monkeypatch.setattr(cliente_quote_mod, "ORCAMENTO_TOTAL_SEGUNDOS", 0.05)
    monkeypatch.setattr(cliente_quote_mod, "ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS", (0.0, 0.0))

    def transporte_que_trava(payload, timeout_segundos):
        # bem mais que o orçamento reduzido acima — nunca deveria voltar a tempo de valer.
        time.sleep(0.5)
        return RespostaBruta(status_code=200, corpo={"nao deveria chegar aqui": True})

    cliente = ClienteQuoteHTTP("http://quote-service.invalido", transporte=transporte_que_trava)

    inicio = time.monotonic()
    resultado = cliente.cotar(PAYLOAD, CONVERSATION_ID)
    duracao = time.monotonic() - inicio

    assert duracao < 0.4, f"o cliente esperou a thread travada em vez de cortar no prazo de parede: {duracao:.3f}s"
    assert resultado.status == StatusCotacao.TIMEOUT
    # Prova de que este teste MORDE (equivalente à mutação "tira o worker" pedida pela
    # coordenação): comentar a linha do `ThreadPoolExecutor` em `_chamar_com_prazo_de_parede` e
    # chamar `self._transporte` direto faz `duracao` chegar a ~0,5s — este `assert` reprova.
