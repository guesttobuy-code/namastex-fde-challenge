"""CLI do agente (issue #6, F5/#8 absorvida): roda uma conversa inteira — coleta -> cota -> decide
-> responde ou encaminha — contra o `quote-service` de verdade.

Só costura o que já existe (LEI 11 — nunca reimplementa): `aplicacao.servico_conversa` decide o
fluxo, `infra.cliente_quote.ClienteQuoteHTTP` fala com a `/quote`. Sem LLM de propósito (fora de
escopo desta frente — a política é determinística e tem que funcionar sozinha assim) e sem trilha
(issue #7/#31 ainda não mergeou; entra em commit próprio quando mergear).

Roda de dentro da raiz do repositório, com `src/` no `PYTHONPATH` (a mesma solução já usada pelo
pytest via `pyproject.toml`; tornar o projeto instalável é decisão maior, deliberadamente adiada —
ver `governance/adr/0002-politica-de-retry-quote.md` e a nota da R9/#16):

    PYTHONPATH=src python -m interfaces.cli

Aceita respostas por stdin (interativo ou `echo "30\n2020\n01310-100\n\n" | ...`, uma por linha,
na ordem dos prompts) — não precisa de flag nem de LLM para rodar de ponta a ponta.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from aplicacao.servico_conversa import conduzir_conversa, montar_estado
from dominio import validacao
from infra.cliente_quote import ClienteQuoteHTTP

RAIZ = Path(__file__).resolve().parents[2]


class _Transcricao:
    """Acumula tudo que apareceria na tela, para virar o log de execução em `examples/*.log`
    (entregável do desafio) — sem depender da trilha, que ainda não mergeou."""

    def __init__(self) -> None:
        self._linhas: list[str] = []

    def emitir(self, linha: str = "") -> None:
        print(linha)
        self._linhas.append(linha)

    def salvar(self, caminho: Path) -> None:
        caminho.parent.mkdir(parents=True, exist_ok=True)
        caminho.write_text("\n".join(self._linhas) + "\n", encoding="utf-8")


def _perguntar(transcricao: _Transcricao, prompt: str, *, obrigatorio: bool, valido=None, entrada=input) -> str | None:
    while True:
        transcricao.emitir(prompt)
        resposta = entrada().strip()
        transcricao.emitir(f"> {resposta}" if resposta else "> (em branco)")
        if not resposta:
            if obrigatorio:
                transcricao.emitir("  (obrigatório — tente de novo)")
                continue
            return None
        if valido and not valido(resposta):
            transcricao.emitir("  (formato inválido — tente de novo)")
            continue
        return resposta


def coletar_dados(transcricao: _Transcricao, entrada=input) -> dict:
    """Pergunta os campos um a um, em ordem fixa (sem LLM — política determinística). idade,
    veiculo_ano e cep são obrigatórios (`dominio.validacao.campos_obrigatorios_faltantes`);
    plano_id e data_inicio são opcionais."""
    idade = _perguntar(transcricao, "Qual a sua idade?", obrigatorio=True, entrada=entrada)
    veiculo_ano = _perguntar(transcricao, "Ano do veículo?", obrigatorio=True, entrada=entrada)
    cep = _perguntar(
        transcricao, "Qual o seu CEP? (formato 00000-000)", obrigatorio=True,
        valido=validacao.cep_valido, entrada=entrada,
    )
    plano_id = _perguntar(
        transcricao, "Qual plano? (essencial/completo/premium — Enter para essencial)",
        obrigatorio=False, entrada=entrada,
    )
    data_inicio = _perguntar(
        transcricao, "Data de início? (AAAA-MM-DD — Enter para não informar)",
        obrigatorio=False, valido=validacao.data_iso_valida, entrada=entrada,
    )
    return {
        "idade": int(idade),
        "veiculo_ano": int(veiculo_ano),
        "cep": cep,
        "plano_id": plano_id,
        "data_inicio": data_inicio,
    }


def rodar_conversa(entrada=input, base_url: str | None = None, portal=None) -> Path:
    """Ponto de entrada único da CLI: coleta, cota, decide, responde ou encaminha, e grava o log
    de execução. Devolve o caminho do log gravado (para quem quiser inspecionar/anexar).

    `portal` é o ponto de injeção do teste (`FakePortalDeCotacao`) — por padrão fala com a
    `/quote` de verdade via `ClienteQuoteHTTP`."""
    transcricao = _Transcricao()
    conversation_id = f"conv-{uuid.uuid4().hex[:8]}"
    transcricao.emitir(f"=== Agente de cotação — conversa {conversation_id} ===")
    transcricao.emitir(f"iniciado em {datetime.now(timezone.utc).isoformat()}")
    transcricao.emitir()

    dados = coletar_dados(transcricao, entrada=entrada)
    estado = montar_estado(conversation_id, dados)

    if portal is None:
        portal = ClienteQuoteHTTP(base_url or os.environ.get("QUOTE_SERVICE_URL", "http://localhost:8000"))
    transcricao.emitir()
    transcricao.emitir("Consultando a /quote...")
    turno = conduzir_conversa(portal, estado)

    transcricao.emitir()
    transcricao.emitir(f"decisão: {turno.decisao.tipo.value}"
                        + (f" (reason_code={turno.decisao.reason_code.value})" if turno.decisao.reason_code else ""))
    transcricao.emitir(f"agente: {turno.texto}")

    caminho = RAIZ / "examples" / f"execucao_{conversation_id}.log"
    transcricao.salvar(caminho)
    transcricao.emitir()
    transcricao.emitir(f"(log salvo em {caminho.relative_to(RAIZ)})")
    return caminho


if __name__ == "__main__":
    rodar_conversa()
    sys.exit(0)
