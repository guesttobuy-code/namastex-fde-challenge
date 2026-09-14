"""Rotas HTTP das transições MANUAIS de status (issue #57, P14, PR 2 de 2): os botões "Assumir" e
"Encerrar" da tela de conversas do painel. Módulo PRÓPRIO, não em `interfaces/servidor.py` — que já
estava no teto de linhas do `file-loc-ceiling` (596/600) antes desta frente; mesmo motivo que já
tinha extraído `_rotear_chat` de `_rotear` (comentário de `servidor.py`, issue #46).

Só traduz HTTP <-> `aplicacao.servico_status_conversa` (LEI 11 — nenhuma regra nova, a validação da
transição é 100% de `dominio.status_conversa`, chamada por `assumir`/`encerrar`). Glue de HTTP
(`_json`/`_ler_corpo_json`/`_conversation_id_ou_400`) vem de `interfaces.http_comum` (issue #51
parte 2, PR #76 — dono único, extraído de `servidor.py` pelo mesmo motivo desta frente: teto de
linhas do `file-loc-ceiling`)."""
from __future__ import annotations

from pathlib import Path

from aplicacao.portas.repositorio_contato import RepositorioDeContato
from aplicacao.servico_status_conversa import TransicaoDeStatusInvalida, assumir, encerrar
from aplicacao.servico_trilha import ServicoDeTrilha
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL
from interfaces.http_comum import METODO_NAO_SUPORTADO as _METODO_NAO_SUPORTADO
from interfaces.http_comum import conversation_id_ou_400 as _conversation_id_ou_400
from interfaces.http_comum import json_resposta as _json
from interfaces.http_comum import ler_corpo_json as _ler_corpo_json
from interfaces.painel.gerar import gerar_paineis


def _responder_transicao(
    transicao,
    *,
    painel_dir: Path,
    trilha_dir: Path,
    repositorio_contato: RepositorioDeContato | None,
    environ,
    metodo: str,
):
    """`transicao` é `aplicacao.servico_status_conversa.assumir` ou `.encerrar` — as duas rotas só
    diferem em qual delas chamam; todo o resto (parse, validação de id, resposta) é idêntico."""
    if metodo != "POST":
        return _json(*_METODO_NAO_SUPORTADO)
    dados = _ler_corpo_json(environ)
    if dados is None:
        return _json("400 Bad Request", {"erro": "corpo não é JSON válido"})
    conversation_id, resposta_erro = _conversation_id_ou_400(dados)
    if resposta_erro is not None:
        return resposta_erro

    trilha = ServicoDeTrilha(RepositorioDeTrilhaJSONL(trilha_dir / f"trilha_{conversation_id}.jsonl"))
    try:
        novo_status = transicao(conversation_id, trilha)
    except TransicaoDeStatusInvalida as erro:
        return _json("409 Conflict", {"erro": str(erro)})

    gerar_paineis(trilha_dir, painel_dir, repositorio_contato=repositorio_contato)

    return _json("200 OK", {"status": novo_status.value})


def responder_conversa_assumir(*, painel_dir: Path, trilha_dir: Path, repositorio_contato, environ, metodo: str):
    """`POST /api/conversa/assumir` — corpo `{"conversation_id": ...}`."""
    return _responder_transicao(
        assumir, painel_dir=painel_dir, trilha_dir=trilha_dir, repositorio_contato=repositorio_contato,
        environ=environ, metodo=metodo,
    )


def responder_conversa_encerrar(*, painel_dir: Path, trilha_dir: Path, repositorio_contato, environ, metodo: str):
    """`POST /api/conversa/encerrar` — corpo `{"conversation_id": ...}`."""
    return _responder_transicao(
        encerrar, painel_dir=painel_dir, trilha_dir=trilha_dir, repositorio_contato=repositorio_contato,
        environ=environ, metodo=metodo,
    )
