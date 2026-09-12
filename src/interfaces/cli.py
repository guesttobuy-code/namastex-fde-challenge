"""CLI do agente (issue #6, F5/#8 absorvida): roda uma conversa inteira — coleta -> cota -> decide
-> responde ou encaminha — contra o `quote-service` de verdade.

Só costura o que já existe (LEI 11 — nunca reimplementa): `aplicacao.servico_conversa` decide o
fluxo (e grava a trilha, F4/#7), `infra.cliente_quote.ClienteQuoteHTTP` fala com a `/quote`,
`infra.exportador_trilha` gera o log estruturado. Sem LLM de propósito (fora de escopo desta
frente — a política é determinística e tem que funcionar sozinha assim).

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

from aplicacao.servico_conversa import conduzir_conversa, extrair_dados_da_mensagem, montar_estado
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio import validacao
from dominio.estado_conversa import EstadoDaConversa
from dominio.eventos_trilha import MensagemEnviada, MensagemRecebida
from dominio.redator_pii import redigir_texto
from infra.adaptador_de_linguagem import criar_adaptador_de_linguagem
from infra.cliente_quote import ClienteQuoteHTTP
from infra.config import url_quote_service
from infra.exportador_trilha import exportar_execucao
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL
from interfaces.dotenv_loader import carregar_dotenv_no_ambiente

RAIZ = Path(__file__).resolve().parents[2]


class _Transcricao:
    """Acumula tudo que apareceria na tela, para virar o log de execução em `examples/*.log`
    (entregável do desafio). O que fica NA TELA é o que o lead digitou de verdade; o que vai para
    o ARQUIVO (`salvar`) passa por `redigir_texto` — o mesmo tratamento que a trilha dá (dado
    sintético tratado como sensível, `docs/PRIVACIDADE.md`), porque este log também é commitado."""

    def __init__(self) -> None:
        self._linhas: list[str] = []

    def emitir(self, linha: str = "") -> None:
        print(linha)
        self._linhas.append(linha)

    def salvar(self, caminho: Path) -> None:
        caminho.parent.mkdir(parents=True, exist_ok=True)
        redigido = "\n".join(redigir_texto(linha) for linha in self._linhas)
        caminho.write_text(redigido + "\n", encoding="utf-8")


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


def coletar_dados_por_texto_livre(
    transcricao: _Transcricao,
    portal,
    conversation_id: str,
    trilha: ServicoDeTrilha | None = None,
    entrada=input,
    max_turnos: int = 6,
) -> EstadoDaConversa:
    """Coleta por texto livre (issue #9, F6): o lead escreve com suas próprias palavras; o
    `PortalDeLinguagem` extrai o que der, turno a turno, até faltar nada obrigatório (idade,
    veiculo_ano, cep — `dominio.validacao.campos_obrigatorios_faltantes`) ou esgotar `max_turnos`.

    Cada turno grava `mensagem_recebida`/`mensagem_enviada` na trilha, com
    `origem_do_texto=portal.origem_do_texto` — é aqui que `llm:<modelo>@<versao_prompt>` aparece
    de verdade na trilha, quando `portal` é o adaptador OpenRouter. `coletar_dados` (campo a campo,
    sem LLM) continua existindo intacto — esta função é um caminho ADICIONAL, nunca substitui o
    determinístico como padrão."""
    estado = EstadoDaConversa(conversation_id=conversation_id)
    transcricao.emitir("Me conte sobre você: sua idade, o carro (modelo e ano) e seu CEP.")
    for indice in range(max_turnos):
        try:
            texto = entrada().strip()
        except EOFError:
            # A entrada acabou (stdin fechado) antes do lead completar os dados — achado da
            # coordenação (2026-09-12): sem isto a CLI cai com traceback. Encerra limpo com o que
            # já foi coletado; `politica.decidir` já sabe pedir mais informação se faltar campo.
            transcricao.emitir("(entrada encerrada — sem mais respostas do lead)")
            break
        transcricao.emitir(f"> {texto}" if texto else "> (em branco)")
        if trilha is not None:
            trilha.registrar_evento(
                MensagemRecebida(
                    evento="mensagem_recebida",
                    conversation_id=conversation_id,
                    id=f"msg_coleta_{indice}_recebida",
                    instante=datetime.now(timezone.utc).isoformat(),
                    texto=texto,
                )
            )
        estado = extrair_dados_da_mensagem(portal, texto, estado)
        campos_prontos = not estado.campos_faltantes
        resposta = (
            "Perfeito, já tenho o que preciso para cotar."
            if campos_prontos
            else f"Ainda preciso de: {', '.join(sorted(estado.campos_faltantes))}. Pode completar?"
        )
        transcricao.emitir(resposta)
        if trilha is not None:
            trilha.registrar_evento(
                MensagemEnviada(
                    evento="mensagem_enviada",
                    conversation_id=conversation_id,
                    id=f"msg_coleta_{indice}_enviada",
                    instante=datetime.now(timezone.utc).isoformat(),
                    texto=resposta,
                    decisao_id=f"dec_coleta_{indice}",
                    regra_aplicada="portal_de_linguagem:extrair",
                    origem_do_texto=portal.origem_do_texto,
                )
            )
        if campos_prontos:
            break
    return estado


def rodar_conversa(
    entrada=input,
    base_url: str | None = None,
    portal=None,
    trilha: ServicoDeTrilha | None = None,
    portal_de_linguagem=None,
) -> Path:
    """Ponto de entrada único da CLI: coleta, cota, decide, responde ou encaminha, e grava dois
    logs — a transcrição da conversa e o log estruturado da trilha (`infra.exportador_trilha`).
    Devolve o caminho da transcrição (para quem quiser inspecionar/anexar).

    `portal` é o ponto de injeção do teste (`FakePortalDeCotacao`) — por padrão fala com a
    `/quote` de verdade via `ClienteQuoteHTTP`. `trilha`, mesma ideia, para injetar um repositório
    em memória no teste — por padrão grava de verdade em `examples/trilha_<conversation_id>.jsonl`.
    `portal_de_linguagem` (issue #9, F6), se passado, troca `coletar_dados` (campo a campo) por
    `coletar_dados_por_texto_livre`; por padrão é `None` e o comportamento de hoje não muda."""
    transcricao = _Transcricao()
    conversation_id = f"conv-{uuid.uuid4().hex[:8]}"
    transcricao.emitir(f"=== Agente de cotação — conversa {conversation_id} ===")
    transcricao.emitir(f"iniciado em {datetime.now(timezone.utc).isoformat()}")
    transcricao.emitir()

    repositorio_trilha = None
    if trilha is None:
        repositorio_trilha = RepositorioDeTrilhaJSONL(RAIZ / "examples" / f"trilha_{conversation_id}.jsonl")
        trilha = ServicoDeTrilha(repositorio_trilha)

    if portal_de_linguagem is not None:
        estado = coletar_dados_por_texto_livre(
            transcricao, portal_de_linguagem, conversation_id, trilha=trilha, entrada=entrada
        )
    else:
        dados = coletar_dados(transcricao, entrada=entrada)
        estado = montar_estado(conversation_id, dados)

    if portal is None:
        portal = ClienteQuoteHTTP(base_url or url_quote_service())

    transcricao.emitir()
    transcricao.emitir("Consultando a /quote...")
    turno = conduzir_conversa(portal, estado, trilha=trilha)

    transcricao.emitir()
    transcricao.emitir(f"decisão: {turno.decisao.tipo.value}"
                        + (f" (reason_code={turno.decisao.reason_code.value})" if turno.decisao.reason_code else ""))
    transcricao.emitir(f"agente: {turno.texto}")

    caminho = RAIZ / "examples" / f"execucao_{conversation_id}.log"
    transcricao.salvar(caminho)
    transcricao.emitir()
    transcricao.emitir(f"(log salvo em {caminho.relative_to(RAIZ)})")

    if repositorio_trilha is not None:
        caminho_estruturado = RAIZ / "examples" / f"trilha_{conversation_id}.log"
        caminho_estruturado.write_text(exportar_execucao(conversation_id, repositorio_trilha), encoding="utf-8")
        print(f"(trilha estruturada salva em {caminho_estruturado.relative_to(RAIZ)})")

    return caminho


if __name__ == "__main__":
    # Carregar o `.env` é a primeira coisa que o processo faz (issue #9, F6) — antes de qualquer
    # peça de negócio saber que uma variável de ambiente existe.
    carregar_dotenv_no_ambiente()
    # `LLM_PROVEDOR` ausente (padrão `deterministico`): comportamento de hoje, sem LLM nenhum —
    # coleta continua campo a campo, ninguém fica bloqueado sem chave (#9). Só com
    # `LLM_PROVEDOR=openrouter` no ambiente é que a coleta passa a ser por texto livre.
    _portal_de_linguagem = criar_adaptador_de_linguagem() if os.environ.get("LLM_PROVEDOR") == "openrouter" else None
    rodar_conversa(portal_de_linguagem=_portal_de_linguagem)
    sys.exit(0)
