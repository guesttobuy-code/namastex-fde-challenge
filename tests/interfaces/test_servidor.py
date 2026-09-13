"""Vermelho-antes do servidor da #43: WSGI puro (stdlib), chamado direto — sem abrir socket de
verdade — mesma disciplina de dublê de transporte usada em `infra/cliente_quote.py`. Cobre as
rotas da API de fichas, da configuração comercial (B4), a tela de edição e o estático do painel;
nunca decide (só chama `aplicacao.servico_conhecimento`/`servico_configuracao_comercial`)."""
from __future__ import annotations

import json
from io import BytesIO

import pytest

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from aplicacao.servico_configuracao_comercial import ServicoDeConfiguracaoComercial
from infra.repositorio_configuracao_comercial_json import RepositorioDeConfiguracaoComercialMemoria
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


def _sem_planos() -> dict | None:
    """Fake de `buscar_planos` para o teste nunca bater na rede — por padrão simula a `/quote`
    fora do ar (mesma disciplina de `FakePortalDeCotacao` em `infra/cliente_quote.py`)."""
    return None


def _com_planos() -> dict:
    return {"planos": [{"id": "essencial"}, {"id": "completo"}, {"id": "premium"}]}


def _criar_app(*, painel_dir, buscar_planos=_sem_planos, configuracao_inicial=None):
    servico = ServicoDeConhecimento(RepositorioDeConhecimentoMemoria())
    servico_configuracao = ServicoDeConfiguracaoComercial(
        RepositorioDeConfiguracaoComercialMemoria(configuracao_inicial)
    )
    return criar_app(
        servico=servico,
        painel_dir=painel_dir,
        servico_configuracao=servico_configuracao,
        buscar_planos=buscar_planos,
    )


@pytest.fixture
def app(tmp_path):
    return _criar_app(painel_dir=tmp_path / "painel-saida")


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
    assert "marcador" in json.loads(corpo)["erro"].lower() or "chaves duplas" in json.loads(corpo)["erro"]

    status, _, _ = _chamar(app, "GET", "/api/objecoes/preco-alto")
    assert status == "404 Not Found"


def test_publicar_com_marcador_por_plano_usa_os_ids_da_planos(tmp_path):
    app = _criar_app(painel_dir=tmp_path / "painel-saida", buscar_planos=_com_planos)
    valida = {**_FICHA, "resposta_orientada": "Franquia do Premium: {{franquia_premium}}.", "status": "publicado"}
    status, _, corpo = _chamar(app, "PUT", "/api/objecoes/preco-alto", valida)
    assert status == "200 OK", corpo


def test_publicar_com_marcador_por_plano_sem_a_planos_de_pe_e_recusado(tmp_path):
    # /quote fora do ar (buscar_planos devolve None) = só os marcadores base publicam.
    app = _criar_app(painel_dir=tmp_path / "painel-saida", buscar_planos=_sem_planos)
    invalida = {**_FICHA, "resposta_orientada": "Franquia do Premium: {{franquia_premium}}.", "status": "publicado"}
    status, _, _ = _chamar(app, "PUT", "/api/objecoes/preco-alto", invalida)
    assert status == "422 Unprocessable Entity"


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


def test_raiz_e_o_placeholder_honesto_do_chat_nao_o_editor(app):
    """Issue #46, PR 1 de 2: `/` deixa de servir a base de conhecimento (que ganhou rota própria,
    `/conhecimento`) e passa a ser um placeholder honesto do chat — sem formulário nem botão que
    finja funcionar, dentro da mesma casca (`layout.pagina`)."""
    status, headers, corpo = _chamar(app, "GET", "/")
    assert status == "200 OK"
    assert headers["Content-Type"].startswith("text/html")
    texto = corpo.decode("utf-8")
    assert "Conversas" in texto
    assert 'aria-current="page"' in texto  # servida pela casca compartilhada, não HTML cru
    assert "campo-id" not in texto  # nenhum campo do formulário de edição de ficha
    assert "<form" not in texto.lower()


def test_tela_de_edicao_em_conhecimento(app):
    status, headers, corpo = _chamar(app, "GET", "/conhecimento")
    assert status == "200 OK"
    assert headers["Content-Type"].startswith("text/html")
    texto = corpo.decode("utf-8")
    assert "/api/objecoes" in texto
    assert "Base de conhecimento" in texto
    assert 'aria-current="page"' in texto


def test_conhecimento_metodo_nao_suportado_e_405(app):
    status, _, _ = _chamar(app, "DELETE", "/conhecimento")
    assert status == "405 Method Not Allowed"


def test_painel_estatico_ainda_nao_gerado_e_404(app):
    status, _, _ = _chamar(app, "GET", "/painel/index.html")
    assert status == "404 Not Found"


def test_painel_estatico_serve_arquivo_ja_gerado(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    painel_dir.mkdir()
    (painel_dir / "index.html").write_text("<html>painel</html>", encoding="utf-8")
    app = _criar_app(painel_dir=painel_dir)

    status, headers, corpo = _chamar(app, "GET", "/painel/index.html")
    assert status == "200 OK"
    assert headers["Content-Type"].startswith("text/html")
    assert corpo == b"<html>painel</html>"


def test_painel_recusa_escapar_do_diretorio(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    painel_dir.mkdir()
    (tmp_path / "segredo.txt").write_text("nao deveria vazar", encoding="utf-8")
    app = _criar_app(painel_dir=painel_dir)

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


# ── configuração comercial (bloqueante B4 da auditoria do PR #45) ──────────


def test_configuracao_comercial_comeca_no_padrao_do_dono(app):
    status, _, corpo = _chamar(app, "GET", "/api/configuracao-comercial")
    assert status == "200 OK"
    assert json.loads(corpo) == {"encaminhar_lead_fora_do_padrao": True}


def test_configuracao_comercial_salva_e_le_de_volta(app):
    status, _, corpo = _chamar(
        app, "PUT", "/api/configuracao-comercial", {"encaminhar_lead_fora_do_padrao": False}
    )
    assert status == "200 OK"
    assert json.loads(corpo) == {"encaminhar_lead_fora_do_padrao": False}

    status, _, corpo = _chamar(app, "GET", "/api/configuracao-comercial")
    assert json.loads(corpo) == {"encaminhar_lead_fora_do_padrao": False}


def test_configuracao_comercial_sem_o_campo_e_400(app):
    status, _, _ = _chamar(app, "PUT", "/api/configuracao-comercial", {})
    assert status == "400 Bad Request"


def test_configuracao_comercial_metodo_nao_suportado_e_405(app):
    status, _, _ = _chamar(app, "DELETE", "/api/configuracao-comercial")
    assert status == "405 Method Not Allowed"
