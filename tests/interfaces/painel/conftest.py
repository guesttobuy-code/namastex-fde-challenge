"""Fixture de trilha para os testes do painel (escopo #13): uma conversa cotada com retry real
(5xx, 5xx, 200) e uma conversa com handoff — a forma que a coordenação pediu para o desenvolvimento
não esperar o PR #35 ("desenvolva contra fixtures de teste com várias tentativas por cotação").
Fixture de teste, nunca colocada em `examples/painel/` como se fosse trilha real (regra 5 do escopo).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.eventos_trilha import (
    Decisao,
    Handoff,
    MensagemEnviada,
    MensagemRecebida,
    TentativaDeCotacao,
)
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL


def construir_trilha_fixture(caminho: Path) -> None:
    repositorio = RepositorioDeTrilhaJSONL(caminho)
    servico = ServicoDeTrilha(repositorio)

    servico.registrar_evento(MensagemRecebida(
        evento="mensagem_recebida", conversation_id="conv_a41f", id="msg_01",
        instante="2026-09-12T09:14:02", texto="Oi, queria fazer um seguro pro meu carro",
    ))
    servico.registrar_evento(MensagemEnviada(
        evento="mensagem_enviada", conversation_id="conv_a41f", id="msg_02",
        instante="2026-09-12T09:14:03", texto="Olá! Qual o modelo e o ano do veículo?",
        decisao_id="dec_00", regra_aplicada="faltam veiculo_ano, idade, cep, plano",
        origem_do_texto="redator_deterministico:abertura", dados_usados=(),
    ))
    # Medido na trilha real do PR #35 (infra/cliente_quote.py:163): cada tentativa recebe o seu
    # PRÓPRIO quote_attempt_id ("correlação, não idempotência") -- retries da MESMA cotação NÃO
    # compartilham id. O agrupamento por cotação usa numero_da_tentativa == 1, não o id.
    servico.registrar_evento(TentativaDeCotacao(
        evento="tentativa_de_cotacao", conversation_id="conv_a41f", id="qa_7d31_t1",
        instante="2026-09-12T09:15:21", numero_da_tentativa=1, http_status=503,
        classificacao="indisponivel", latencia_ms=40, orcamento_restante_ms=9600,
        quote_attempt_id="qa_7d31_t1",
    ))
    servico.registrar_evento(TentativaDeCotacao(
        evento="tentativa_de_cotacao", conversation_id="conv_a41f", id="qa_7d31_t2",
        instante="2026-09-12T09:15:22", numero_da_tentativa=2, http_status=0,
        classificacao="timeout", latencia_ms=3005, orcamento_restante_ms=6555,
        quote_attempt_id="qa_7d31_t2",
    ))
    servico.registrar_evento(TentativaDeCotacao(
        evento="tentativa_de_cotacao", conversation_id="conv_a41f", id="qa_7d31_t3",
        instante="2026-09-12T09:15:23", numero_da_tentativa=3, http_status=200,
        classificacao="sucesso", latencia_ms=60, orcamento_restante_ms=8500,
        quote_attempt_id="qa_7d31_t3", premio_mensal=272.87, franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"),
    ))
    servico.registrar_evento(Decisao(
        evento="decisao", conversation_id="conv_a41f", id="dec_01",
        instante="2026-09-12T09:15:24", tipo="explicar_cotacao",
    ))
    servico.registrar_evento(MensagemEnviada(
        evento="mensagem_enviada", conversation_id="conv_a41f", id="msg_03",
        instante="2026-09-12T09:15:25", texto="Consegui o plano Completo por R$ 272,87/mes.",
        decisao_id="dec_01", regra_aplicada="carencia de 30 dias informada sem o lead perguntar",
        origem_do_texto="redator_deterministico:cotacao", dados_usados=("qa_7d31_t3",),
        quote_attempt_id="qa_7d31_t3",
    ))

    servico.registrar_evento(MensagemRecebida(
        evento="mensagem_recebida", conversation_id="conv_b93c", id="msg_01",
        instante="2026-09-12T09:31:10", texto="HB20 2021, 44 anos",
    ))
    servico.registrar_evento(TentativaDeCotacao(
        evento="tentativa_de_cotacao", conversation_id="conv_b93c", id="qa_1188_1",
        instante="2026-09-12T09:31:12", numero_da_tentativa=1, http_status=500,
        classificacao="indisponivel", latencia_ms=30, orcamento_restante_ms=9600,
        quote_attempt_id="qa_1188",
    ))
    servico.registrar_evento(Handoff(
        evento="handoff", conversation_id="conv_b93c", id="ho_01",
        instante="2026-09-12T09:31:16", reason_code="quote_indisponivel",
        contexto_coletado={"veiculo": "HB20 2021", "idade": 44},
        mensagem_ao_lead="O sistema de cotação está indisponível agora.",
    ))


@pytest.fixture
def conftest_caminho_trilha(tmp_path) -> Path:
    caminho = tmp_path / "trilha.jsonl"
    construir_trilha_fixture(caminho)
    return caminho


@pytest.fixture
def trilha_fixture(conftest_caminho_trilha) -> list[dict]:
    return RepositorioDeTrilhaJSONL(conftest_caminho_trilha).todos_os_eventos()
