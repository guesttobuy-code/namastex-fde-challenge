"""`RepositorioDeTrilhaJSONL` é append-only, atrás da porta `RepositorioDeTrilha` (issue #7 — "sem
banco: não precisa, e banco custa tempo"). A invariante que importa: registrar um segundo evento
NUNCA apaga o primeiro — um bug de "abrir em modo escrita" em vez de "acrescentar" passaria
despercebido se o teste só checasse "o arquivo existe depois de um registrar()".
"""

import json

from infra.trilha_jsonl import RepositorioDeTrilhaJSONL


def test_dois_eventos_registrados_os_dois_sobrevivem(tmp_path):
    caminho = tmp_path / "trilha.jsonl"
    repositorio = RepositorioDeTrilhaJSONL(caminho)

    repositorio.registrar({"evento": "mensagem_recebida", "conversation_id": "conv_1", "id": "msg_01"})
    repositorio.registrar({"evento": "mensagem_enviada", "conversation_id": "conv_1", "id": "msg_02"})

    linhas = caminho.read_text(encoding="utf-8").splitlines()
    assert len(linhas) == 2, f"esperava 2 linhas append-only, achei {len(linhas)}: {linhas!r}"
    assert json.loads(linhas[0])["id"] == "msg_01"
    assert json.loads(linhas[1])["id"] == "msg_02"


def test_eventos_da_conversa_reconstroi_so_a_conversa_pedida(tmp_path):
    caminho = tmp_path / "trilha.jsonl"
    repositorio = RepositorioDeTrilhaJSONL(caminho)
    repositorio.registrar({"evento": "mensagem_recebida", "conversation_id": "conv_1", "id": "msg_01"})
    repositorio.registrar({"evento": "mensagem_recebida", "conversation_id": "conv_2", "id": "msg_99"})

    eventos = repositorio.eventos_da_conversa("conv_1")

    assert [e["id"] for e in eventos] == ["msg_01"]


def test_repositorio_novo_sobre_arquivo_existente_preserva_o_que_ja_havia(tmp_path):
    caminho = tmp_path / "trilha.jsonl"
    RepositorioDeTrilhaJSONL(caminho).registrar({"evento": "x", "conversation_id": "conv_1", "id": "a"})

    RepositorioDeTrilhaJSONL(caminho).registrar({"evento": "x", "conversation_id": "conv_1", "id": "b"})

    linhas = caminho.read_text(encoding="utf-8").splitlines()
    assert len(linhas) == 2, "reabrir o repositório não pode truncar a trilha existente"
