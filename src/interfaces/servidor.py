"""Servidor local (issue #43, F13): WSGI puro da stdlib (`wsgiref`), decisão registrada em
ADR-0004 — zero dependência nova, mesma linha de `infra.cliente_quote`/`infra.adaptador_de_linguagem`
(stdlib em vez de SDK/framework de terceiro).

Só costura o que já existe (LEI 11 — nunca reimplementa): `aplicacao.servico_conhecimento` decide
o que persiste e valida a invariante do marcador; este módulo só traduz HTTP <-> chamada de método
e serve arquivo estático (a tela de edição e o painel já gerado). Roda de dentro da raiz do
repositório, com `src/` no `PYTHONPATH` (mesma solução de `interfaces.cli`):

    PYTHONPATH=src python -m interfaces.servidor

Variáveis de ambiente:
    CONHECIMENTO_DIR   pasta das fichas em JSON (padrão "conhecimento/objecoes")
    PAINEL_DIR         pasta do painel já gerado por `interfaces.painel.gerar` (padrão "painel-saida")
    SERVIDOR_PORT      porta HTTP (padrão 8080)
"""

from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
from wsgiref.simple_server import make_server

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from dominio.ficha_objecao import MarcadorInvalido
from infra.repositorio_conhecimento_json import RepositorioDeConhecimentoJSON

_TELA_EDICAO = Path(__file__).resolve().parent / "conhecimento" / "tela_edicao.html"


def _json(status: str, corpo: dict | list) -> tuple[str, list[tuple[str, str]], list[bytes]]:
    dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
    cabecalhos = [("Content-Type", "application/json; charset=utf-8"), ("Content-Length", str(len(dados)))]
    return status, cabecalhos, [dados]


def _html(status: str, texto: str) -> tuple[str, list[tuple[str, str]], list[bytes]]:
    dados = texto.encode("utf-8")
    cabecalhos = [("Content-Type", "text/html; charset=utf-8"), ("Content-Length", str(len(dados)))]
    return status, cabecalhos, [dados]


def _arquivo_estatico(caminho: Path) -> tuple[str, list[tuple[str, str]], list[bytes]]:
    dados = caminho.read_bytes()
    tipo, _ = mimetypes.guess_type(str(caminho))
    cabecalhos = [
        ("Content-Type", tipo or "application/octet-stream"),
        ("Content-Length", str(len(dados))),
    ]
    return "200 OK", cabecalhos, [dados]


def _servir_painel(painel_dir: Path, subcaminho: str) -> tuple[str, list[tuple[str, str]], list[bytes]]:
    if not subcaminho or subcaminho == "/":
        subcaminho = "index.html"
    alvo = (painel_dir / subcaminho.lstrip("/")).resolve()
    try:
        raiz = painel_dir.resolve()
    except OSError:
        return _json("404 Not Found", {"erro": "painel ainda não gerado"})
    if raiz not in alvo.parents and alvo != raiz:
        return _json("400 Bad Request", {"erro": "caminho fora do painel"})
    if not alvo.is_file():
        return _json("404 Not Found", {"erro": "painel ainda não gerado"})
    return _arquivo_estatico(alvo)


_METODO_NAO_SUPORTADO = ("405 Method Not Allowed", {"erro": "método não suportado"})


def _ler_corpo_json(environ) -> dict | None:
    """`None` quando o corpo não é JSON válido — quem chama decide o 400."""
    try:
        tamanho = int(environ.get("CONTENT_LENGTH") or 0)
        bruto = environ["wsgi.input"].read(tamanho)
        return json.loads(bruto or b"{}")
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def _responder_raiz(metodo: str):
    if metodo != "GET":
        return _json(*_METODO_NAO_SUPORTADO)
    return _html("200 OK", _TELA_EDICAO.read_text(encoding="utf-8"))


def _responder_lista(servico: ServicoDeConhecimento, metodo: str):
    if metodo != "GET":
        return _json(*_METODO_NAO_SUPORTADO)
    return _json("200 OK", servico.listar_objecoes())


def _responder_ler_ficha(servico: ServicoDeConhecimento, id_da_ficha: str):
    ficha = servico.obter_objecao(id_da_ficha)
    if ficha is None:
        return _json("404 Not Found", {"erro": "ficha não encontrada"})
    return _json("200 OK", ficha)


def _responder_salvar_ficha(servico: ServicoDeConhecimento, environ, id_da_ficha: str):
    dados = _ler_corpo_json(environ)
    if dados is None:
        return _json("400 Bad Request", {"erro": "corpo não é JSON válido"})
    dados["id"] = id_da_ficha  # a rota é dona do id, nunca o corpo (LEI 11)
    try:
        persistido = servico.salvar_objecao(dados)
    except (MarcadorInvalido, ValueError) as erro:
        return _json("422 Unprocessable Entity", {"erro": str(erro)})
    return _json("200 OK", persistido)


def _responder_ficha(servico: ServicoDeConhecimento, metodo: str, environ, id_da_ficha: str):
    if metodo == "GET":
        return _responder_ler_ficha(servico, id_da_ficha)
    if metodo == "PUT":
        return _responder_salvar_ficha(servico, environ, id_da_ficha)
    return _json(*_METODO_NAO_SUPORTADO)


def _responder_painel(painel_dir: Path, metodo: str, subcaminho: str):
    if metodo != "GET":
        return _json(*_METODO_NAO_SUPORTADO)
    return _servir_painel(painel_dir, subcaminho)


def _rotear(servico: ServicoDeConhecimento, painel_dir: Path, environ):
    metodo = environ["REQUEST_METHOD"]
    caminho = environ["PATH_INFO"] or "/"

    if caminho == "/":
        return _responder_raiz(metodo)
    if caminho == "/api/objecoes":
        return _responder_lista(servico, metodo)
    if caminho.startswith("/api/objecoes/"):
        return _responder_ficha(servico, metodo, environ, caminho[len("/api/objecoes/") :])
    if caminho == "/painel" or caminho.startswith("/painel/"):
        return _responder_painel(painel_dir, metodo, caminho[len("/painel/") :])
    return _json("404 Not Found", {"erro": "rota desconhecida"})


def criar_app(*, servico: ServicoDeConhecimento, painel_dir: Path):
    """Fábrica do app WSGI — injeção do caso de uso e do diretório do painel para o teste rodar
    sem tocar o disco real nem depender de variável de ambiente."""

    def app(environ, start_response):
        status, cabecalhos, corpo = _rotear(servico, painel_dir, environ)
        start_response(status, cabecalhos)
        return corpo

    return app


def main() -> int:
    conhecimento_dir = Path(os.environ.get("CONHECIMENTO_DIR", "conhecimento/objecoes"))
    painel_dir = Path(os.environ.get("PAINEL_DIR", "painel-saida"))
    porta = int(os.environ.get("SERVIDOR_PORT", "8080"))

    servico = ServicoDeConhecimento(RepositorioDeConhecimentoJSON(conhecimento_dir))
    app = criar_app(servico=servico, painel_dir=painel_dir)

    with make_server("0.0.0.0", porta, app) as servidor:
        print(f"servidor local em http://0.0.0.0:{porta} — conhecimento em {conhecimento_dir}")
        servidor.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
