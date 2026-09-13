"""Vermelho-antes do servidor da #43: WSGI puro (stdlib), chamado direto — sem abrir socket de
verdade — mesma disciplina de dublê de transporte usada em `infra/cliente_quote.py`. Cobre as
rotas da API de fichas, da configuração comercial (B4), a tela de edição, o estático do painel e,
desde a issue #46 (PR 2 de 2), o chat guiado ligado ao agente real; nunca decide (só chama
`aplicacao.servico_conhecimento`/`servico_configuracao_comercial`/`servico_conversa`/
`servico_contato`)."""
from __future__ import annotations

import json
from io import BytesIO

import pytest

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from aplicacao.servico_configuracao_comercial import ServicoDeConfiguracaoComercial
from aplicacao.servico_contato import ServicoDeContato
from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao
from infra.cliente_quote import FakePortalDeCotacao
from infra.repositorio_configuracao_comercial_json import RepositorioDeConfiguracaoComercialMemoria
from infra.repositorio_conhecimento_json import RepositorioDeConhecimentoMemoria
from infra.repositorio_contato_json import RepositorioDeContatoMemoria
from interfaces.servidor import _ESTADOS_EM_MEMORIA, criar_app


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


def _com_planos_completo() -> dict:
    """Forma da `/planos` de verdade (`quote-service/data/plans.json`), para as rotas do chat que
    leem `nome`/`franquia`/`coberturas` — nunca só o `id` que `_com_planos` (acima) basta para as
    rotas de fichas."""
    return {
        "moeda": "BRL",
        "planos": [
            {"id": "essencial", "nome": "Essencial", "base_mensal": 119.90, "franquia": 4500, "coberturas": ["colisao", "roubo", "furto"]},
            {"id": "completo", "nome": "Completo", "base_mensal": 209.90, "franquia": 3000, "coberturas": ["colisao", "roubo", "furto", "terceiros", "vidros"]},
            {"id": "premium", "nome": "Premium", "base_mensal": 339.90, "franquia": 1500, "coberturas": ["colisao", "roubo", "furto", "terceiros", "vidros", "carro_reserva", "assistencia_24h"]},
        ],
    }


def _preco_de_sucesso() -> dict:
    return {
        "plano_id": "completo", "plano_nome": "Completo", "premio_mensal": 272.87, "franquia": 3000.0,
        "coberturas": ["colisao", "roubo", "furto"], "moeda": "BRL",
    }


def _criar_app(
    *,
    tmp_path,
    painel_dir=None,
    buscar_planos=_sem_planos,
    configuracao_inicial=None,
    trilha_dir=None,
    repositorio_contato=None,
    portal_de_cotacao=None,
):
    """`tmp_path` é OBRIGATÓRIO (achado da auditoria do PR #62, 13/09/2026): `criar_app` de
    produção, sem `trilha_dir` explícito, cai no padrão real `Path("examples")` — um teste que
    esquecesse de passar `trilha_dir` escrevia trilha de teste no `examples/` DO REPOSITÓRIO (a
    mutação da auditoria em `_responder_chat_contato`, gravando nome/WhatsApp na trilha, poluiu
    exatamente esse diretório). `trilha_dir`/`painel_dir` default para dentro de `tmp_path` quando
    quem chama não escolhe outro — nenhum teste deste arquivo pode mais tocar o `examples/` real."""
    painel_dir = painel_dir if painel_dir is not None else tmp_path / "painel-saida"
    trilha_dir = trilha_dir if trilha_dir is not None else tmp_path / "trilha"
    servico = ServicoDeConhecimento(RepositorioDeConhecimentoMemoria())
    servico_configuracao = ServicoDeConfiguracaoComercial(
        RepositorioDeConfiguracaoComercialMemoria(configuracao_inicial)
    )
    repositorio_contato = repositorio_contato if repositorio_contato is not None else RepositorioDeContatoMemoria()
    servico_contato = ServicoDeContato(repositorio_contato)
    return criar_app(
        servico=servico,
        painel_dir=painel_dir,
        servico_configuracao=servico_configuracao,
        buscar_planos=buscar_planos,
        servico_contato=servico_contato,
        trilha_dir=trilha_dir,
        repositorio_contato=repositorio_contato,
        portal_de_cotacao=portal_de_cotacao,
    )


@pytest.fixture
def app(tmp_path):
    return _criar_app(tmp_path=tmp_path)


@pytest.fixture(autouse=True)
def _estados_em_memoria_isolados():
    """`_ESTADOS_EM_MEMORIA` é um dict a nível de MÓDULO (ADR-0005) — sem isolar entre testes, uma
    conversa gravada por um teste vazaria para o próximo que usar o mesmo `conversation_id`."""
    _ESTADOS_EM_MEMORIA.clear()
    yield
    _ESTADOS_EM_MEMORIA.clear()


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
    app = _criar_app(tmp_path=tmp_path, painel_dir=tmp_path / "painel-saida", buscar_planos=_com_planos)
    valida = {**_FICHA, "resposta_orientada": "Franquia do Premium: {{franquia_premium}}.", "status": "publicado"}
    status, _, corpo = _chamar(app, "PUT", "/api/objecoes/preco-alto", valida)
    assert status == "200 OK", corpo


def test_publicar_com_marcador_por_plano_sem_a_planos_de_pe_e_recusado(tmp_path):
    # /quote fora do ar (buscar_planos devolve None) = só os marcadores base publicam.
    app = _criar_app(tmp_path=tmp_path, painel_dir=tmp_path / "painel-saida", buscar_planos=_sem_planos)
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


@pytest.mark.parametrize("id_invalido", ["../../etc/cron.d/x", "..%2F..%2Fx", "id com espaco"])
def test_obter_objecao_com_id_invalido_e_400_nunca_500(app, id_invalido):
    """issue #69: `_validar_id` já BLOQUEAVA o path traversal (nenhum arquivo fora da pasta era
    lido), mas o `ValueError` subia sem tratamento no GET e virava 500 genérico — só o PUT tratava."""
    status, _, corpo = _chamar(app, "GET", f"/api/objecoes/{id_invalido}")
    assert status == "400 Bad Request"
    assert "erro" in json.loads(corpo)


def test_metodo_nao_suportado_na_rota_da_api_e_405(app):
    status, _, _ = _chamar(app, "DELETE", "/api/objecoes/preco-alto")
    assert status == "405 Method Not Allowed"


def test_rota_desconhecida_e_404(app):
    status, _, _ = _chamar(app, "GET", "/isso-nao-existe")
    assert status == "404 Not Found"


def test_raiz_serve_o_chat_centralizado_ligado_ao_agente_real(app):
    """Issue #46, PR 2 de 2: `/` passa a servir o chat guiado real (`interfaces.chat.tela_chat`,
    por trás das rotas `/api/chat/*` que chamam `aplicacao.servico_conversa`), não mais o
    placeholder honesto do PR 1."""
    status, headers, corpo = _chamar(app, "GET", "/")
    assert status == "200 OK"
    assert headers["Content-Type"].startswith("text/html")
    texto = corpo.decode("utf-8")
    assert "Conversas" in texto
    assert 'aria-current="page"' in texto  # servida pela casca compartilhada, não HTML cru
    assert "Começar minha cotação" in texto
    assert "/api/chat/cotar" in texto
    assert "campo-id" not in texto  # nenhum campo do formulário de edição de ficha


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
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir)

    status, headers, corpo = _chamar(app, "GET", "/painel/index.html")
    assert status == "200 OK"
    assert headers["Content-Type"].startswith("text/html")
    assert corpo == b"<html>painel</html>"


def test_painel_recusa_escapar_do_diretorio(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    painel_dir.mkdir()
    (tmp_path / "segredo.txt").write_text("nao deveria vazar", encoding="utf-8")
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir)

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


@pytest.mark.parametrize("valor", ["nao", "sim", "false", "0", 1, 0])
def test_configuracao_comercial_valor_nao_booleano_e_400_nunca_vira_true_por_bool(app, valor):
    """issue #69: `bool("nao")` é `True` — mandar `"nao"` LIGAVA a config em silêncio (o oposto do
    pedido). Regra comercial binária só aceita o `bool` de verdade que o JSON já representa."""
    status, _, corpo = _chamar(app, "PUT", "/api/configuracao-comercial", {"encaminhar_lead_fora_do_padrao": valor})
    assert status == "400 Bad Request"
    assert "erro" in json.loads(corpo)


def test_configuracao_comercial_true_false_json_de_verdade_continuam_aceitos(app):
    """Contraprova: o caso que a tela de Regras manda de verdade (bool JSON) não regride."""
    for valor in (True, False):
        status, _, corpo = _chamar(app, "PUT", "/api/configuracao-comercial", {"encaminhar_lead_fora_do_padrao": valor})
        assert status == "200 OK"
        assert json.loads(corpo) == {"encaminhar_lead_fora_do_padrao": valor}


def test_configuracao_comercial_metodo_nao_suportado_e_405(app):
    status, _, _ = _chamar(app, "DELETE", "/api/configuracao-comercial")
    assert status == "405 Method Not Allowed"


# ── chat guiado ligado ao agente real (issue #46, PR 2 de 2) ───────────────


def test_api_planos_devolve_o_catalogo_da_quote_service(tmp_path):
    app = _criar_app(tmp_path=tmp_path, painel_dir=tmp_path / "painel-saida", buscar_planos=_com_planos_completo)
    status, headers, corpo = _chamar(app, "GET", "/api/planos")
    assert status == "200 OK"
    assert headers["Content-Type"].startswith("application/json")
    catalogo = json.loads(corpo)
    assert catalogo["planos"][0]["id"] == "essencial"
    assert catalogo["planos"][0]["franquia"] == 4500


def test_api_planos_traduz_ids_de_cobertura_para_nome_legivel(tmp_path):
    """Achado da auditoria do PR #62 (item 5): `_corpo.html` tinha um segundo mapa id->nome escrito
    à mão (`NOME_COB`), duplicando `dominio.nomes_cobertura` (dono único, LEI 11). O JSON que sai
    daqui já vem traduzido — o chat só exibe o que veio, nunca decide o nome."""
    app = _criar_app(tmp_path=tmp_path, painel_dir=tmp_path / "painel-saida", buscar_planos=_com_planos_completo)
    status, _, corpo = _chamar(app, "GET", "/api/planos")
    assert status == "200 OK"
    catalogo = json.loads(corpo)
    assert catalogo["planos"][0]["coberturas"] == ["colisão", "roubo", "furto"]


def test_api_planos_com_quote_service_fora_do_ar_e_503(app):
    # `app` (fixture) usa `_sem_planos` por padrão — nunca um catálogo inventado (LEI 2).
    status, _, _ = _chamar(app, "GET", "/api/planos")
    assert status == "503 Service Unavailable"


def test_paises_json_e_servido_para_o_seletor_do_whatsapp(app):
    status, headers, corpo = _chamar(app, "GET", "/docs/design/paises.json")
    assert status == "200 OK"
    assert headers["Content-Type"].startswith("application/json")
    catalogo = json.loads(corpo)
    assert any(p["iso"] == "BR" for p in catalogo["paises"])


def test_chat_contato_salva_e_e_lido_de_volta(tmp_path):
    repositorio = RepositorioDeContatoMemoria()
    app = _criar_app(tmp_path=tmp_path, painel_dir=tmp_path / "painel-saida", repositorio_contato=repositorio)

    status, _, corpo = _chamar(app, "POST", "/api/chat/contato", {
        "conversation_id": "conv-contato",
        "nome": "Ursula Souza",
        "whatsapp": "+55 21 97224-2584",
        "email": "ursula@example.com",
    })

    assert status == "200 OK"
    assert json.loads(corpo)["nome"] == "Ursula Souza"
    salvo = repositorio.obter("conv-contato")
    assert salvo is not None
    assert salvo.whatsapp == "+55 21 97224-2584"


def test_chat_contato_nunca_grava_nome_nem_whatsapp_em_nenhuma_trilha(tmp_path):
    """Achado da auditoria do PR #62 (13/09/2026): mutação em `_responder_chat_contato` (gravar
    `nome`/`whatsapp` na trilha) deixou a suíte VERDE, porque nenhum teste desta rota olhava pra
    `trilha_dir`. Prova pela DUAS pontas: nenhum arquivo em `trilha_dir` contém o nome nem o
    telefone depois do `POST` — varre TODO arquivo do diretório, não confia em "não deveria estar
    lá". `trilha_dir` é `tmp_path`, nunca `examples/` do repositório (ver docstring de `_criar_app`)."""
    trilha_dir = tmp_path / "trilha"
    trilha_dir.mkdir()
    nome = "Ursula Souza"
    whatsapp = "+55 21 97224-2584"
    app = _criar_app(tmp_path=tmp_path, trilha_dir=trilha_dir)

    status, _, _ = _chamar(app, "POST", "/api/chat/contato", {
        "conversation_id": "conv-privacidade-contato", "nome": nome, "whatsapp": whatsapp,
        "email": "ursula@example.com",
    })

    assert status == "200 OK"
    arquivos_da_trilha = list(trilha_dir.rglob("*"))
    for caminho in arquivos_da_trilha:
        if caminho.is_file():
            conteudo = caminho.read_text(encoding="utf-8")
            assert nome not in conteudo, f"nome vazou em {caminho}: {conteudo!r}"
            assert whatsapp not in conteudo, f"whatsapp vazou em {caminho}: {conteudo!r}"


def test_chat_contato_sem_nome_e_422(app):
    status, _, corpo = _chamar(app, "POST", "/api/chat/contato", {
        "conversation_id": "conv-sem-nome", "whatsapp": "+55 21 97224-2584",
    })
    assert status == "422 Unprocessable Entity"
    assert "nome" in json.loads(corpo)["erro"].lower()


def test_chat_contato_sem_conversation_id_e_400(app):
    status, _, _ = _chamar(app, "POST", "/api/chat/contato", {"nome": "X", "whatsapp": "+55 11 90000-0000"})
    assert status == "400 Bad Request"


def test_chat_cotar_com_portal_de_sucesso_devolve_preco_e_regenera_o_painel(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(PrecoCotado(
        quote_attempt_id="qa_1", conversation_id="conv-teste", plano_id="completo",
        plano_nome="Completo", premio_mensal=272.87, franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"), moeda="BRL",
    ))])
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir, portal_de_cotacao=portal)

    status, _, corpo = _chamar(app, "POST", "/api/chat/cotar", {
        "conversation_id": "conv-teste",
        "idade": 35, "veiculo_ano": 2019, "veiculo_modelo": "Onix",
        "cep": "01310-100", "plano_id": "completo", "data_inicio": "2026-10-01",
    })

    assert status == "200 OK"
    turno = json.loads(corpo)
    assert turno["decisao"]["tipo"] == "explicar_cotacao"
    assert turno["preco"]["premio_mensal"] == 272.87
    assert turno["preco"]["plano_nome"] == "Completo"
    # Achado da auditoria do PR #62 (item 5): ids crus ("colisao") não podem chegar ao chat —
    # `dominio.nomes_cobertura` (dono único, LEI 11) traduz antes da resposta HTTP sair.
    assert turno["preco"]["coberturas"] == ["colisão", "roubo", "furto"]

    # ADR-0005, decisão 2: o painel é regenerado a cada evento — sem reiniciar o processo, a
    # conversa nova já aparece no Histórico de atendimentos (index.html).
    conversas_html = (painel_dir / "index.html").read_text(encoding="utf-8")
    assert "conv-teste" in conversas_html


def test_chat_cotar_com_portal_indisponivel_nao_devolve_preco(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.indisponivel("upstream indisponível")])
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir, portal_de_cotacao=portal)

    status, _, corpo = _chamar(app, "POST", "/api/chat/cotar", {
        "conversation_id": "conv-indisp", "idade": 30, "veiculo_ano": 2020, "cep": "01310-100",
    })

    assert status == "200 OK"
    turno = json.loads(corpo)
    assert turno["preco"] is None
    assert turno["decisao"]["tipo"] == "encaminhar"
    assert turno["decisao"]["reason_code"] == "quote_indisponivel"


def test_chat_cotar_sem_conversation_id_e_400(app):
    status, _, _ = _chamar(app, "POST", "/api/chat/cotar", {"idade": 30})
    assert status == "400 Bad Request"


@pytest.mark.parametrize("cep_invalido", ["abc", "1234567", "123456789"])
def test_chat_cotar_com_cep_invalido_e_400_nunca_cota_sem_agravo(app, cep_invalido):
    """issue #68: pela rota do chat, `cep: "abc"`/7/9 dígitos eram aceitos sem validação e
    seguiam para a `/quote` sem o agravo regional (que usa só os 2 primeiros caracteres do CEP)."""
    status, _, corpo = _chamar(app, "POST", "/api/chat/cotar", {
        "conversation_id": "conv-cep-invalido", "idade": 30, "veiculo_ano": 2020, "cep": cep_invalido,
    })
    assert status == "400 Bad Request"
    assert "cep" in json.loads(corpo)["erro"]


def test_chat_cotar_com_conversation_id_de_path_traversal_e_recusado_sem_escrever_fora_da_trilha(tmp_path):
    """Achado de segurança (revisão automática, 13/09/2026): `conversation_id` vira nome de arquivo
    (`trilha_<conversation_id>.jsonl`) sem validação — um id tipo `../../segredo` escrevia fora de
    `trilha_dir`. Prova pelas DUAS pontas: a resposta é 400 (nunca chega a montar o repositório) E
    nenhum arquivo aparece fora de `trilha_dir` de verdade."""
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    trilha_dir.mkdir()
    alvo_fora = tmp_path / "segredo.jsonl"
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir)

    status, _, corpo = _chamar(app, "POST", "/api/chat/cotar", {
        "conversation_id": "../segredo", "idade": 30, "veiculo_ano": 2020, "cep": "01310-100",
    })

    assert status == "400 Bad Request"
    assert "conversation_id" in json.loads(corpo)["erro"]
    assert not alvo_fora.exists()
    assert list(trilha_dir.iterdir()) == []


def test_chat_contratar_com_conversation_id_de_path_traversal_e_recusado(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    trilha_dir.mkdir()
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir)

    status, _, _ = _chamar(app, "POST", "/api/chat/contratar", {"conversation_id": "..\\..\\segredo"})

    assert status == "400 Bad Request"
    assert list(trilha_dir.iterdir()) == []


def test_chat_contratar_grava_o_handoff_lead_quer_contratar(tmp_path):
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    app = _criar_app(tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir)

    status, _, corpo = _chamar(app, "POST", "/api/chat/contratar", {"conversation_id": "conv-contrata"})

    assert status == "200 OK"
    resposta = json.loads(corpo)
    assert resposta["decisao"]["tipo"] == "encaminhar"
    assert resposta["decisao"]["reason_code"] == "lead_quer_contratar"
    assert "corretor" in resposta["texto"].lower()

    handoffs_html = (painel_dir / "handoffs.html").read_text(encoding="utf-8")
    assert "conv-contrata" in handoffs_html
    assert "lead_quer_contratar" in handoffs_html
