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

from aplicacao.servico_conversa import (
    conduzir_conversa,
    extrair_dados_da_mensagem,
    montar_estado,
    registrar_pergunta_de_coleta,
    registrar_resposta_de_coleta,
)
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio import validacao
from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.estado_conversa import EstadoDaConversa
from dominio.redator_pii import redigir_texto
from infra.adaptador_de_linguagem import criar_adaptador_de_linguagem
from infra.repositorio_configuracao_comercial_json import RepositorioDeConfiguracaoComercialJSON
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
        self._linhas: list[tuple[str, bool]] = []

    def emitir(self, linha: str = "", *, redigir: bool = True) -> None:
        print(linha)
        self._linhas.append((linha, redigir))

    def salvar(self, caminho: Path) -> None:
        caminho.parent.mkdir(parents=True, exist_ok=True)
        redigido = "\n".join(
            redigir_texto(linha) if deve_redigir else linha for linha, deve_redigir in self._linhas
        )
        caminho.write_text(redigido + "\n", encoding="utf-8")


def _perguntar(transcricao: _Transcricao, prompt: str, *, obrigatorio: bool, valido=None, entrada=input) -> str | None:
    while True:
        transcricao.emitir(prompt, redigir=False)
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


def _perguntar_e_registrar(
    transcricao: _Transcricao, conversation_id: str, indice: int, prompt: str, trilha: ServicoDeTrilha | None, *,
    obrigatorio: bool, valido=None, entrada=input,
) -> str | None:
    """Envolve `_perguntar` com o registro na trilha (issue #51/#55): a pergunta ANTES de
    perguntar, a resposta REAL do lead DEPOIS — pela `aplicacao`, nunca `trilha.registrar_evento`
    direto daqui."""
    if trilha is not None:
        registrar_pergunta_de_coleta(trilha, conversation_id, indice, prompt, origem_do_texto="coleta_deterministica")
    resposta = _perguntar(transcricao, prompt, obrigatorio=obrigatorio, valido=valido, entrada=entrada)
    if trilha is not None:
        registrar_resposta_de_coleta(trilha, conversation_id, indice, resposta if resposta is not None else "")
    return resposta


def coletar_dados(
    transcricao: _Transcricao, conversation_id: str, entrada=input, trilha: ServicoDeTrilha | None = None
) -> dict:
    """Pergunta os campos um a um, em ordem fixa (sem LLM — política determinística). idade,
    veiculo_ano e cep são obrigatórios (`dominio.validacao.campos_obrigatorios_faltantes`);
    plano_id e data_inicio são opcionais.

    `trilha`, se passado, grava cada pergunta e resposta pela `aplicacao` (issue #51/#55: dono
    único da escrita da trilha) — a pergunta ANTES de perguntar, a resposta REAL do lead DEPOIS."""
    idade = _perguntar_e_registrar(
        transcricao, conversation_id, 0, "Qual a sua idade?", trilha, obrigatorio=True, entrada=entrada
    )
    veiculo_ano = _perguntar_e_registrar(
        transcricao, conversation_id, 1, "Ano do veículo?", trilha, obrigatorio=True, entrada=entrada
    )
    cep = _perguntar_e_registrar(
        transcricao, conversation_id, 2, "Qual o seu CEP? (8 números, com ou sem hífen)", trilha,
        obrigatorio=True, valido=validacao.cep_valido, entrada=entrada,
    )
    plano_id = _perguntar_e_registrar(
        transcricao, conversation_id, 3, "Qual plano? (essencial/completo/premium — Enter para essencial)", trilha,
        obrigatorio=False, entrada=entrada,
    )
    data_inicio = _perguntar_e_registrar(
        transcricao, conversation_id, 4, "Data de início? (AAAA-MM-DD — Enter para não informar)", trilha,
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
            registrar_resposta_de_coleta(trilha, conversation_id, indice, texto)
        estado = extrair_dados_da_mensagem(portal, texto, estado)
        campos_prontos = not estado.campos_faltantes
        resposta = (
            "Perfeito, já tenho o que preciso para cotar."
            if campos_prontos
            else f"Ainda preciso de: {', '.join(sorted(estado.campos_faltantes))}. Pode completar?"
        )
        transcricao.emitir(resposta)
        if trilha is not None:
            registrar_pergunta_de_coleta(
                trilha, conversation_id, indice, resposta,
                origem_do_texto=portal.origem_do_texto, regra_aplicada="portal_de_linguagem:extrair",
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
    configuracao: ConfiguracaoComercial | None = None,
    caminho_configuracao_comercial: Path | None = None,
) -> Path:
    """Ponto de entrada único da CLI: coleta, cota, decide, responde ou encaminha, e grava dois
    logs — a transcrição da conversa e o log estruturado da trilha (`infra.exportador_trilha`).
    Devolve o caminho da transcrição (para quem quiser inspecionar/anexar).

    `portal` é o ponto de injeção do teste (`FakePortalDeCotacao`) — por padrão fala com a
    `/quote` de verdade via `ClienteQuoteHTTP`. `trilha`, mesma ideia, para injetar um repositório
    em memória no teste — por padrão grava de verdade em `examples/trilha_<conversation_id>.jsonl`.
    `portal_de_linguagem` (issue #9, F6), se passado, troca `coletar_dados` (campo a campo) por
    `coletar_dados_por_texto_livre`; por padrão é `None` e o comportamento de hoje não muda.

    `configuracao` (issue #43, F13, bloqueante B4 da auditoria do PR #45): decisão comercial da
    seguradora sobre o que fazer com a recusa da `/quote` (`dominio.politica.decidir`). Por padrão
    `None` — carrega de verdade de `conhecimento/configuracao_comercial.json` (a mesma que a tela
    de edição grava); `caminho_configuracao_comercial` é o ponto de injeção do teste para essa
    carga, sem precisar injetar `configuracao` direto."""
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
        dados = coletar_dados(transcricao, conversation_id, entrada=entrada, trilha=trilha)
        estado = montar_estado(conversation_id, dados)

    if portal is None:
        portal = ClienteQuoteHTTP(base_url or url_quote_service())

    if configuracao is None:
        caminho_config = caminho_configuracao_comercial or (RAIZ / "conhecimento" / "configuracao_comercial.json")
        configuracao = RepositorioDeConfiguracaoComercialJSON(caminho_config).carregar()

    transcricao.emitir()
    transcricao.emitir("Consultando a /quote...")
    turno = conduzir_conversa(portal, estado, trilha=trilha, configuracao=configuracao)

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
