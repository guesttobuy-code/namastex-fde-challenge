"""Vermelho-antes do servidor da #43: WSGI puro (stdlib), chamado direto — sem abrir socket de
verdade — mesma disciplina de dublê de transporte usada em `infra/cliente_quote.py`. Cobre as
rotas da API de fichas, a tela de edição e o estático do painel; nunca decide (só chama
`aplicacao.servico_conhecimento`)."""
from __future__ import annotations

import json
from io import BytesIO

import pytest

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from infra.repositorio_conhecimento_json import RepositorioDeConhecimentoMemoria
from interfaces.servidor import criar_app


def _chamar(app, method, path, corpo: dict | None = None):
    dados = b"" if corpo is None else json.dumps(corpo).encode("utf-8")
    environ = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "wsgi.input": BytesIO(dados),
        "CONTENT_LENGTH": str(len(dados)),
    }
    capturado = {}

    def start_response(status, headers):
        capturado["status"] = status
        capturado["headers"] = dict(headers)

    corpo_resposta = b"".join(app(environ, start_response))
    return capturado["status"], capturado["headers"], corpo_resposta


@pytest.fixture
def app(tmp_path):
    servico = ServicoDeConhecimento(RepositorioDeConhecimentoMemoria())
    return criar_app(servico=servico, painel_dir=tmp_path / "painel-saida")


_FICHA = {
    "id": "preco-alto",
    "nome": "Preço tá salgado",
    "frases_do_lead": ["o preço tá salgado"],
    "resposta_orientada": "Posso ajustar a franquia para {{franquia}}.",
    "argumentos_permitidos": ["franquia_por_plano"],
    "tentativas_antes_do_corretor": 2,
    "status": "rascunho",
}


def test_listar_objecoes_vazio(app):
    status, _, corpo = _chamar(app, "GET", "/api/objecoes")
    assert status == "200 OK"
    assert json.loads(corpo) == []


def test_salvar_rascunho_e_ler_de_volta(app):
    status, _, corpo = _chamar(app, "PUT", "/api/objecoes/preco-alto", _FICHA)
    assert status == "200 OK"
    assert json.loads(corpo)["status"] == "rascunho"

    status, _, corpo = _chamar(app, "GET", "/api/objecoes/preco-alto")
    assert status == "200 OK"
    assert json.loads(corpo)["nome"] == "Preço tá salgado"


def test_publicar_com_digito_fora_de_marcador_e_recusado_com_422_e_nada_e_persistido(app):
    invalida = {**_FICHA, "resposta_orientada": "O plano custa R$ 199,90.", "status": "publicado"}
    status, _, corpo = _chamar(app, "PUT", "/api/objecoes/preco-alto", invalida)
    assert status == "422 Unprocessable Entity"
    assert "marcador" in json.loads(corpo)["erro"]

    status, _, _ = _chamar(app, "GET", "/api/objecoes/preco-alto")
    assert status == "404 Not Found"


def test_id_da_url_manda_sobre_id_do_corpo(app):
    # a rota é a fonte do id (LEI 11) — o corpo pode vir com outro id sem abrir uma segunda ficha.
    _chamar(app, "PUT", "/api/objecoes/preco-alto", {**_FICHA, "id": "outro-id"})
    status, _, corpo = _chamar(app, "GET", "/api/objecoes/preco-alto")
    assert status == "200 OK"
    assert json.loads(corpo)["id"] == "preco-alto"
    status, _, _ = _chamar(app, "GET", "/api/objecoes/outro-id")
    assert status == "404 Not Found"


def test_obter_objecao_inexistente_e_404(app):
    status, _, _ = _chamar(app, "GET", "/api/objecoes/nao-existe")
    assert status == "404 Not Found"


def test_metodo_nao_suportado_na_rota_da_api_e_405(app):
    status, _, _ = _chamar(app, "DELETE", "/api/objecoes/preco-alto")
    assert status == "405 Method Not Allowed"


def test_rota_desconhecida_e_404(app):
    status, _, _ = _chamar(app, "GET", "/isso-nao-existe")
    assert status == "404 Not Found"


def test_tela_de_edicao_na_raiz(app):
    status, headers, corpo = _chamar(app, "GET", "/")
    assert status == "200 OK"
    assert headers["Content-Type"].startswith("text/html")
    assert b"conhecimento" in corpo.lower() or b"obje" in corpo.lower()


def test_painel_estatico_ainda_nao_gerado_e_404(app):
    status, _, _ = _chamar(app, "GET", "/painel/index.html")
    assert status == "404 Not Found"


def test_painel_estatico_serve_arquivo_ja_gerado(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    painel_dir.mkdir()
    (painel_dir / "index.html").write_text("<html>painel</html>", encoding="utf-8")
    servico = ServicoDeConhecimento(RepositorioDeConhecimentoMemoria())
    app = criar_app(servico=servico, painel_dir=painel_dir)

    status, headers, corpo = _chamar(app, "GET", "/painel/index.html")
    assert status == "200 OK"
    assert headers["Content-Type"].startswith("text/html")
    assert corpo == b"<html>painel</html>"


def test_painel_recusa_escapar_do_diretorio(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    painel_dir.mkdir()
    (tmp_path / "segredo.txt").write_text("nao deveria vazar", encoding="utf-8")
    servico = ServicoDeConhecimento(RepositorioDeConhecimentoMemoria())
    app = criar_app(servico=servico, painel_dir=painel_dir)

    status, _, _ = _chamar(app, "GET", "/painel/../segredo.txt")
    assert status in ("404 Not Found", "400 Bad Request")


def test_corpo_de_ficha_com_json_invalido_e_400(app):
    environ = {
        "REQUEST_METHOD": "PUT",
        "PATH_INFO": "/api/objecoes/preco-alto",
        "wsgi.input": BytesIO(b"{isto nao e json"),
        "CONTENT_LENGTH": "16",
    }
    capturado = {}

    def start_response(status, headers):
        capturado["status"] = status

    app(environ, start_response)
    assert capturado["status"] == "400 Bad Request"
