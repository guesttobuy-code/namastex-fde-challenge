"""Servidor local (issue #43, F13): WSGI puro da stdlib (`wsgiref`), decisão registrada em
ADR-0004 — zero dependência nova, mesma linha de `infra.cliente_quote`/`infra.adaptador_de_linguagem`
(stdlib em vez de SDK/framework de terceiro).

Só costura o que já existe (LEI 11 — nunca reimplementa): `aplicacao.servico_conhecimento` decide
o que persiste e valida a invariante do marcador, `aplicacao.servico_conversa.conduzir_conversa`
decide o fluxo do chat (issue #46, PR 2 de 2) — este módulo só traduz HTTP <-> chamada de método,
monta o chat centralizado e a base de conhecimento via `interfaces.painel.layout.pagina` (casca
única, issue #46) e serve o painel estático já gerado. Roda de dentro da raiz do repositório, com
`src/` no `PYTHONPATH` (mesma solução de `interfaces.cli`):

    PYTHONPATH=src python -m interfaces.servidor

Variáveis de ambiente:
    CONHECIMENTO_DIR   pasta das fichas em JSON (padrão "conhecimento/objecoes")
    CONFIGURACAO_COMERCIAL_ARQUIVO  arquivo da configuração comercial (padrão
                       "conhecimento/configuracao_comercial.json")
    PAINEL_DIR         pasta do painel já gerado por `interfaces.painel.gerar` (padrão "painel-saida")
    SERVIDOR_PORT      porta HTTP (padrão 8080)
    TRILHA_DIR         pasta onde o chat grava `trilha_<conversation_id>.jsonl` (issue #46, PR 2 de
                       2, ADR-0005) — padrão "examples" (mesma pasta que a CLI já usa; commitada,
                       nunca leva PII — o redator continua sendo o único caminho de escrita)
    CONTATO_DIR        pasta onde o contato real do lead (nome/WhatsApp/e-mail) é gravado, FORA do
                       git (issue #46, PR 2 de 2, ADR-0005) — padrão "contato/leads"

Estado da conversa entre turnos (ADR-0005, decisão 1): um `dict[str, EstadoDaConversa]` a nível de
MÓDULO, não escondido atrás de uma classe ou factory — HTTP é stateless, e o chat guiado faz uma
pergunta por vez ao longo de várias requisições da MESMA conversa (`conversation_id`, gerado pelo
cliente/navegador). Perdido ao reiniciar o processo — limite aceito e declarado no ADR: não há
Redis, sessão em arquivo nem cookie assinado nesta entrega (zero dependência nova, ADR-0004).
"""

from __future__ import annotations

import dataclasses
import json
import mimetypes
import os
from pathlib import Path
from wsgiref.simple_server import make_server

from aplicacao.portas.repositorio_contato import RepositorioDeContato
from aplicacao.servico_conhecimento import ServicoDeConhecimento
from aplicacao.servico_configuracao_comercial import ServicoDeConfiguracaoComercial
from aplicacao.servico_contato import ServicoDeContato
from aplicacao.servico_conversa import conduzir_conversa, montar_estado
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.estado_conversa import EstadoDaConversa
from dominio.ficha_objecao import MarcadorInvalido
from dominio.intencao import Intencao
from dominio.nomes_cobertura import nome_legivel
from dominio.preco_cotado import PrecoCotado
from dominio.validacao import normalizar_cep
from infra.adaptador_de_linguagem import criar_adaptador_de_linguagem
from infra.adaptador_de_linguagem import criar_adaptador_de_resposta_orientada
from infra.cliente_quote import MAX_TENTATIVAS, ClienteQuoteHTTP
from infra.config import url_quote_service
from infra.planos_http import buscar_planos as buscar_planos_real
from infra.planos_http import ids_dos_planos
from infra.repositorio_configuracao_comercial_json import RepositorioDeConfiguracaoComercialJSON
from infra.repositorio_conhecimento_json import RepositorioDeConhecimentoJSON
from infra.repositorio_contato_json import RepositorioDeContatoJSON, RepositorioDeContatoMemoria
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL
from interfaces import rotas_resposta_orientada
from interfaces.chat import tela_chat
from interfaces.chat_mensagem import responder_chat_mensagem
from interfaces.conhecimento import tela_edicao
from interfaces.http_comum import CONVERSATION_ID_VALIDO as _CONVERSATION_ID_VALIDO
from interfaces.http_comum import METODO_NAO_SUPORTADO as _METODO_NAO_SUPORTADO
from interfaces.http_comum import conversation_id_ou_400 as _conversation_id_ou_400
from interfaces.http_comum import json_resposta as _json
from interfaces.http_comum import ler_corpo_json as _ler_corpo_json
from interfaces.painel.gerar import gerar_paineis
from interfaces.rotas_status_conversa import responder_conversa_assumir, responder_conversa_encerrar

_RAIZ = Path(__file__).resolve().parents[2]
_PAISES_JSON = _RAIZ / "docs" / "design" / "paises.json"

# ADR-0005, decisão 1 (ver docstring do módulo): estado da conversa entre turnos, chave
# `conversation_id`, em memória do PROCESSO — não é um singleton escondido, é este dict, explícito.
_ESTADOS_EM_MEMORIA: dict[str, EstadoDaConversa] = {}
# Issue #58: último `PrecoCotado` de sucesso por conversa (mesmo padrão de `_ESTADOS_EM_MEMORIA`).
_PRECOS_EM_MEMORIA: dict[str, PrecoCotado] = {}


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


def _responder_raiz(metodo: str):
    if metodo != "GET":
        return _json(*_METODO_NAO_SUPORTADO)
    return _html("200 OK", tela_chat.render())


def _responder_conhecimento(metodo: str):
    if metodo != "GET":
        return _json(*_METODO_NAO_SUPORTADO)
    return _html("200 OK", tela_edicao.render())


def _responder_lista(servico: ServicoDeConhecimento, metodo: str):
    if metodo != "GET":
        return _json(*_METODO_NAO_SUPORTADO)
    return _json("200 OK", servico.listar_objecoes())


def _responder_ler_ficha(servico: ServicoDeConhecimento, id_da_ficha: str):
    # issue #69: `_validar_id` levanta ValueError p/ id fora do formato (path traversal já
    # BLOQUEADO antes de ler arquivo) — sem este `try` virava 500; o PUT abaixo já tratava.
    try:
        ficha = servico.obter_objecao(id_da_ficha)
    except ValueError as erro:
        return _json("400 Bad Request", {"erro": str(erro)})
    if ficha is None:
        return _json("404 Not Found", {"erro": "ficha não encontrada"})
    return _json("200 OK", ficha)


def _responder_salvar_ficha(servico: ServicoDeConhecimento, buscar_planos, environ, id_da_ficha: str):
    dados = _ler_corpo_json(environ)
    if dados is None:
        return _json("400 Bad Request", {"erro": "corpo não é JSON válido"})
    dados["id"] = id_da_ficha  # a rota é dona do id, nunca o corpo (LEI 11)
    # ids dos planos (achado B2 da auditoria do PR #45): lidos aqui, na borda HTTP, e passados
    # para baixo — o domínio nunca fala com a rede. `/quote` fora do ar = tupla vazia (buraco
    # visível: só os marcadores base publicam, nunca um id de plano inventado).
    ids = ids_dos_planos(buscar_planos())
    try:
        persistido = servico.salvar_objecao(dados, ids_dos_planos=ids)
    except (MarcadorInvalido, ValueError) as erro:
        return _json("422 Unprocessable Entity", {"erro": str(erro)})
    return _json("200 OK", persistido)


def _responder_ficha(servico: ServicoDeConhecimento, buscar_planos, metodo: str, environ, id_da_ficha: str):
    if metodo == "GET":
        return _responder_ler_ficha(servico, id_da_ficha)
    if metodo == "PUT":
        return _responder_salvar_ficha(servico, buscar_planos, environ, id_da_ficha)
    return _json(*_METODO_NAO_SUPORTADO)


def _responder_painel(painel_dir: Path, metodo: str, subcaminho: str):
    if metodo != "GET":
        return _json(*_METODO_NAO_SUPORTADO)
    return _servir_painel(painel_dir, subcaminho)


def _responder_ler_configuracao(servico_configuracao: ServicoDeConfiguracaoComercial):
    configuracao = servico_configuracao.obter()
    return _json("200 OK", {"encaminhar_lead_fora_do_padrao": configuracao.encaminhar_lead_fora_do_padrao})


def _responder_salvar_configuracao(servico_configuracao: ServicoDeConfiguracaoComercial, environ):
    dados = _ler_corpo_json(environ)
    if dados is None or "encaminhar_lead_fora_do_padrao" not in dados:
        return _json("400 Bad Request", {"erro": "envie {\"encaminhar_lead_fora_do_padrao\": true|false}"})
    valor = dados["encaminhar_lead_fora_do_padrao"]
    # issue #69: bool("nao") é True — mandar "nao" LIGAVA a config em silêncio (o oposto do pedido).
    if not isinstance(valor, bool):
        return _json(
            "400 Bad Request",
            {"erro": "encaminhar_lead_fora_do_padrao precisa ser true ou false (JSON bool), não uma string"},
        )
    configuracao = servico_configuracao.salvar(encaminhar_lead_fora_do_padrao=valor)
    return _json("200 OK", {"encaminhar_lead_fora_do_padrao": configuracao.encaminhar_lead_fora_do_padrao})


def _responder_configuracao_comercial(servico_configuracao: ServicoDeConfiguracaoComercial, metodo: str, environ):
    if metodo == "GET":
        return _responder_ler_configuracao(servico_configuracao)
    if metodo == "PUT":
        return _responder_salvar_configuracao(servico_configuracao, environ)
    return _json(*_METODO_NAO_SUPORTADO)


def _planos_com_coberturas_legiveis(planos: dict) -> dict:
    """Traduz `coberturas` (ids crus de `plans.json`) para nome legível ANTES de sair pela borda
    HTTP — dono único (LEI 11, achado #54): `dominio.nomes_cobertura` já é o dono do mapa, então o
    chat nunca escreve um segundo (a versão anterior tinha `NOME_COB` hardcoded em `_corpo.html`)."""
    return {
        **planos,
        "planos": [
            {**plano, "coberturas": [nome_legivel(c) for c in plano.get("coberturas", [])]}
            for plano in planos.get("planos", [])
        ],
    }


def _responder_planos(buscar_planos, metodo: str):
    """`GET /api/planos` (issue #46, PR 2 de 2): proxy só-leitura de `infra.planos_http.buscar_planos`
    — o MESMO cliente que a base de conhecimento já usa para o vocabulário de marcadores (LEI 11,
    nunca um segundo cliente HTTP). `/quote` fora do ar = 503, nunca um catálogo inventado."""
    if metodo != "GET":
        return _json(*_METODO_NAO_SUPORTADO)
    planos = buscar_planos()
    if planos is None:
        return _json("503 Service Unavailable", {"erro": "quote-service indisponível"})
    return _json("200 OK", _planos_com_coberturas_legiveis(planos))


def _responder_paises(metodo: str):
    """`GET /docs/design/paises.json` (issue #46, PR 2 de 2): serve o JSON versionado (245 países,
    libphonenumber — `scripts/gerar-paises-whatsapp.mjs`) para o seletor de país do WhatsApp no
    chat. Arquivo estático, mesmo mecanismo de `_arquivo_estatico` já usado pelo painel."""
    if metodo != "GET":
        return _json(*_METODO_NAO_SUPORTADO)
    if not _PAISES_JSON.is_file():
        return _json("404 Not Found", {"erro": "paises.json não encontrado"})
    return _arquivo_estatico(_PAISES_JSON)


def _responder_chat_contato(servico_contato: ServicoDeContato, environ, metodo: str):
    """`POST /api/chat/contato` (issue #46, PR 2 de 2, ADR-0005): único caminho de escrita do
    contato real do lead — nunca toca a trilha, nunca chama `RepositorioDeTrilha`."""
    if metodo != "POST":
        return _json(*_METODO_NAO_SUPORTADO)
    dados = _ler_corpo_json(environ)
    if dados is None:
        return _json("400 Bad Request", {"erro": "corpo não é JSON válido"})
    conversation_id, resposta_erro = _conversation_id_ou_400(dados)
    if resposta_erro is not None:
        return resposta_erro
    try:
        contato = servico_contato.salvar(
            conversation_id, nome=dados.get("nome"), whatsapp=dados.get("whatsapp"), email=dados.get("email")
        )
    except ValueError as erro:
        return _json("422 Unprocessable Entity", {"erro": str(erro)})
    return _json("200 OK", {"nome": contato.nome, "whatsapp": contato.whatsapp, "email": contato.email})


def _campos_do_estado_atual(conversation_id: str) -> dict:
    estado = _ESTADOS_EM_MEMORIA.get(conversation_id)
    if estado is None:
        return {}
    return {
        "idade": estado.idade,
        "veiculo_ano": estado.veiculo_ano,
        "veiculo_modelo": estado.veiculo_modelo,
        "plano_id": estado.plano_id,
        "cep": estado.cep,
        "data_inicio": estado.data_inicio,
    }


def _dados_mesclados(conversation_id: str, dados: dict) -> dict:
    """Aditivo sobre o que já está em memória (ADR-0005) — um campo ausente/vazio nesta chamada
    NUNCA apaga um campo já confirmado num turno anterior. Mesma disciplina de
    `aplicacao.servico_conversa.extrair_dados_da_mensagem`. Nome/WhatsApp/e-mail nunca entram aqui
    — só `ServicoDeContato` os lê/grava (ADR-0005, `docs/PRIVACIDADE.md`)."""
    mesclado = _campos_do_estado_atual(conversation_id)
    for chave in ("idade", "veiculo_ano", "veiculo_modelo", "plano_id", "cep", "data_inicio"):
        valor = dados.get(chave)
        if valor not in (None, ""):
            mesclado[chave] = valor
    return mesclado


def _preco_para_json(preco) -> dict | None:
    if preco is None:
        return None
    return {
        "quote_attempt_id": preco.quote_attempt_id,
        "plano_id": preco.plano_id,
        "plano_nome": preco.plano_nome,
        "premio_mensal": preco.premio_mensal,
        "franquia": preco.franquia,
        "coberturas": [nome_legivel(c) for c in preco.coberturas],
        "moeda": preco.moeda,
        "carencia": preco.carencia,
        "pro_rata": preco.pro_rata,
    }


def _tentativas_para_json(repositorio_trilha, conversation_id: str) -> dict | None:
    """Nunca mostra "tentativa ao vivo" (esta frente escolheu resposta única, não polling — ver
    relatório do PR): lê da trilha já gravada quantas tentativas HTTP a `/quote` levou nesta
    chamada, para o chat mostrar "tentativa X de MAX_TENTATIVAS" no resultado final."""
    tentativas = [
        evento
        for evento in repositorio_trilha.eventos_da_conversa(conversation_id)
        if evento.get("evento") == "tentativa_de_cotacao"
    ]
    if not tentativas:
        return None
    numero_da_ultima = max(evento.get("numero_da_tentativa", 0) for evento in tentativas)
    return {"realizada": numero_da_ultima, "max": MAX_TENTATIVAS}


def _turno_para_json(turno, repositorio_trilha, conversation_id: str) -> dict:
    return {
        "decisao": {
            "tipo": turno.decisao.tipo.value,
            "reason_code": turno.decisao.reason_code.value if turno.decisao.reason_code else None,
        },
        "texto": turno.texto,
        "preco": _preco_para_json(turno.resultado.preco) if turno.resultado else None,
        "tentativas": _tentativas_para_json(repositorio_trilha, conversation_id),
    }


def _responder_chat_cotar(
    *,
    painel_dir: Path,
    trilha_dir: Path,
    repositorio_contato: RepositorioDeContato | None,
    servico_configuracao: ServicoDeConfiguracaoComercial,
    portal_de_cotacao,
    environ,
    metodo: str,
):
    """`POST /api/chat/cotar` (issue #46, PR 2 de 2): monta/atualiza o `EstadoDaConversa` em
    memória, chama `aplicacao.servico_conversa.conduzir_conversa` (o MESMO caso de uso que a CLI já
    usa — nunca reimplementado aqui), grava a trilha e regenera o painel (ADR-0005, decisão 2)."""
    if metodo != "POST":
        return _json(*_METODO_NAO_SUPORTADO)
    dados = _ler_corpo_json(environ)
    if dados is None:
        return _json("400 Bad Request", {"erro": "corpo não é JSON válido"})
    conversation_id, resposta_erro = _conversation_id_ou_400(dados)
    if resposta_erro is not None:
        return resposta_erro
    # issue #68: CEP fora do formato cotava sem o agravo regional; normalizar_cep é o dono único
    # do formato aceito (mesma função de montar_estado). Ausente/vazio não é erro (ainda não coletado).
    cep_bruto = dados.get("cep")
    if cep_bruto not in (None, "") and normalizar_cep(cep_bruto) is None:
        return _json("400 Bad Request", {"erro": "cep fora do formato válido (00000-000)"})

    estado = montar_estado(conversation_id, _dados_mesclados(conversation_id, dados))

    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / f"trilha_{conversation_id}.jsonl")
    trilha = ServicoDeTrilha(repositorio_trilha)
    configuracao = servico_configuracao.obter()

    turno = conduzir_conversa(portal_de_cotacao, estado, trilha=trilha, configuracao=configuracao)
    _ESTADOS_EM_MEMORIA[conversation_id] = estado
    if turno.resultado and turno.resultado.preco:
        _PRECOS_EM_MEMORIA[conversation_id] = turno.resultado.preco

    gerar_paineis(trilha_dir, painel_dir, repositorio_contato=repositorio_contato)

    return _json("200 OK", _turno_para_json(turno, repositorio_trilha, conversation_id))


def _responder_chat_contratar(
    *,
    painel_dir: Path,
    trilha_dir: Path,
    repositorio_contato: RepositorioDeContato | None,
    servico_configuracao: ServicoDeConfiguracaoComercial,
    portal_de_cotacao,
    environ,
    metodo: str,
):
    """`POST /api/chat/contratar` (issue #46, PR 2 de 2; campo `motivo` na issue #57, PR 2 de 2):
    "Quero contratar" e "Falar com um corretor" caem aqui, distinguidos pelo campo `motivo` do
    corpo (`"contratar"` default, para não quebrar um cliente antigo que ainda não manda o campo —
    ou `"humano"`). Marca `ultimo_intent` correspondente no estado em memória e chama
    `conduzir_conversa` de novo — `dominio.politica.decidir` já garante (issues #42/#57 P9) que
    cada um vira `ENCAMINHAR`/`LEAD_QUER_CONTRATAR` ou `ENCAMINHAR`/`LEAD_PEDIU_HUMANO`,
    incondicional, antes de qualquer outra regra."""
    if metodo != "POST":
        return _json(*_METODO_NAO_SUPORTADO)
    dados = _ler_corpo_json(environ)
    if dados is None:
        return _json("400 Bad Request", {"erro": "corpo não é JSON válido"})
    conversation_id, resposta_erro = _conversation_id_ou_400(dados)
    if resposta_erro is not None:
        return resposta_erro
    motivo = dados.get("motivo", "contratar")
    if motivo not in ("contratar", "humano"):
        return _json("400 Bad Request", {"erro": "motivo precisa ser 'contratar' ou 'humano'"})
    intencao = Intencao.QUER_FALAR_COM_HUMANO if motivo == "humano" else Intencao.QUER_CONTRATAR

    estado = _ESTADOS_EM_MEMORIA.get(conversation_id) or EstadoDaConversa(conversation_id=conversation_id)
    estado = dataclasses.replace(estado, ultimo_intent=intencao)

    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / f"trilha_{conversation_id}.jsonl")
    trilha = ServicoDeTrilha(repositorio_trilha)
    configuracao = servico_configuracao.obter()

    turno = conduzir_conversa(portal_de_cotacao, estado, trilha=trilha, configuracao=configuracao)
    _ESTADOS_EM_MEMORIA[conversation_id] = estado

    gerar_paineis(trilha_dir, painel_dir, repositorio_contato=repositorio_contato)

    return _json("200 OK", {
        "texto": turno.texto,
        "decisao": {
            "tipo": turno.decisao.tipo.value,
            "reason_code": turno.decisao.reason_code.value if turno.decisao.reason_code else None,
        },
    })


# `_responder_chat_responder` (issue #58) mora em `interfaces.rotas_resposta_orientada` (file-loc-ceiling).


def _rotear_chat(
    caminho: str,
    metodo: str,
    environ,
    *,
    painel_dir,
    buscar_planos,
    servico_contato,
    trilha_dir,
    repositorio_contato,
    servico_configuracao,
    portal_de_cotacao,
):
    """Rotas do chat (issue #46, PR 2 de 2) — separadas de `_rotear` só para manter a complexidade
    ciclomática de cada função sob o limite do ruff (C901); nenhuma decisão nova, é o mesmo
    despacho HTTP↔aplicação. Devolve `None` quando `caminho` não é uma rota do chat."""
    if caminho == "/api/planos":
        return _responder_planos(buscar_planos, metodo)
    if caminho == "/docs/design/paises.json":
        return _responder_paises(metodo)
    if caminho == "/api/chat/contato":
        return _responder_chat_contato(servico_contato, environ, metodo)
    if caminho == "/api/chat/mensagem":
        return responder_chat_mensagem(trilha_dir=trilha_dir, environ=environ, metodo=metodo)
    if caminho == "/api/chat/cotar":
        return _responder_chat_cotar(
            painel_dir=painel_dir, trilha_dir=trilha_dir, repositorio_contato=repositorio_contato,
            servico_configuracao=servico_configuracao, portal_de_cotacao=portal_de_cotacao,
            environ=environ, metodo=metodo,
        )
    if caminho == "/api/chat/contratar":
        return _responder_chat_contratar(
            painel_dir=painel_dir, trilha_dir=trilha_dir, repositorio_contato=repositorio_contato,
            servico_configuracao=servico_configuracao, portal_de_cotacao=portal_de_cotacao,
            environ=environ, metodo=metodo,
        )
    if caminho in ("/api/conversa/assumir", "/api/conversa/encerrar"):
        # issue #57, P14: as duas rotas só diferem em qual função de aplicacao.servico_status_conversa
        # chamam — responder_conversa_assumir/encerrar (interfaces/rotas_status_conversa.py) tratam o resto.
        responder = responder_conversa_assumir if caminho.endswith("assumir") else responder_conversa_encerrar
        return responder(
            painel_dir=painel_dir, trilha_dir=trilha_dir, repositorio_contato=repositorio_contato,
            environ=environ, metodo=metodo,
        )
    return None


def _rotear(
    servico, servico_configuracao, painel_dir, buscar_planos, servico_contato, trilha_dir,
    repositorio_contato, portal_de_cotacao, environ, *, portal_de_linguagem=None, portal_de_resposta_orientada=None,
):
    metodo = environ["REQUEST_METHOD"]
    caminho = environ["PATH_INFO"] or "/"

    if caminho == "/":
        return _responder_raiz(metodo)
    if caminho == "/conhecimento":
        return _responder_conhecimento(metodo)
    if caminho == "/api/objecoes":
        return _responder_lista(servico, metodo)
    if caminho.startswith("/api/objecoes/"):
        return _responder_ficha(servico, buscar_planos, metodo, environ, caminho[len("/api/objecoes/") :])
    if caminho == "/api/configuracao-comercial":
        return _responder_configuracao_comercial(servico_configuracao, metodo, environ)
    if caminho == "/painel" or caminho.startswith("/painel/"):
        return _responder_painel(painel_dir, metodo, caminho[len("/painel/") :])
    if caminho == "/api/chat/responder":  # issue #58 — fora de _rotear_chat, handler em rotas_resposta_orientada.py
        return rotas_resposta_orientada.responder_chat_responder(
            servico=servico, servico_configuracao=servico_configuracao, buscar_planos=buscar_planos,
            portal_de_linguagem=portal_de_linguagem, portal_de_resposta_orientada=portal_de_resposta_orientada,
            trilha_dir=trilha_dir, estados_em_memoria=_ESTADOS_EM_MEMORIA, precos_em_memoria=_PRECOS_EM_MEMORIA,
            environ=environ, metodo=metodo)

    resposta_chat = _rotear_chat(
        caminho, metodo, environ,
        painel_dir=painel_dir, buscar_planos=buscar_planos, servico_contato=servico_contato,
        trilha_dir=trilha_dir, repositorio_contato=repositorio_contato,
        servico_configuracao=servico_configuracao, portal_de_cotacao=portal_de_cotacao,
    )
    if resposta_chat is not None:
        return resposta_chat

    return _json("404 Not Found", {"erro": "rota desconhecida"})


def criar_app(
    *, servico: ServicoDeConhecimento, painel_dir: Path, servico_configuracao: ServicoDeConfiguracaoComercial,
    buscar_planos=buscar_planos_real, servico_contato: ServicoDeContato | None = None,
    trilha_dir: Path | None = None, repositorio_contato: RepositorioDeContato | None = None,
    portal_de_cotacao=None, portal_de_linguagem=None, portal_de_resposta_orientada=None,
):
    """Fábrica do app WSGI — injeção do caso de uso, do diretório do painel e de como buscar os planos
    (achado B2 da auditoria: teste nunca bate na rede de verdade) para o teste rodar sem tocar o disco
    real nem depender de variável de ambiente. Parâmetros do chat (issue #46) são ADITIVOS, com default
    seguro para não tocar disco/rede em teste que não usa as rotas `/api/chat/*`: `servico_contato`
    default é `RepositorioDeContatoMemoria`; `trilha_dir` default `Path("examples")`; `portal_de_cotacao`
    default é `ClienteQuoteHTTP` de verdade só quando de fato chamado. `portal_de_linguagem`/
    `portal_de_resposta_orientada` (issue #58) default por `LLM_PROVEDOR`."""
    if servico_contato is None:
        servico_contato = ServicoDeContato(RepositorioDeContatoMemoria())
    if trilha_dir is None:
        trilha_dir = Path("examples")
    if portal_de_cotacao is None:
        portal_de_cotacao = ClienteQuoteHTTP(url_quote_service())
    portal_de_linguagem = portal_de_linguagem or criar_adaptador_de_linguagem()
    portal_de_resposta_orientada = portal_de_resposta_orientada or criar_adaptador_de_resposta_orientada()

    def app(environ, start_response):
        status, cabecalhos, corpo = _rotear(
            servico, servico_configuracao, painel_dir, buscar_planos,
            servico_contato, trilha_dir, repositorio_contato, portal_de_cotacao, environ,
            portal_de_linguagem=portal_de_linguagem, portal_de_resposta_orientada=portal_de_resposta_orientada,
        )
        start_response(status, cabecalhos)
        return corpo

    return app


def main() -> int:
    conhecimento_dir = Path(os.environ.get("CONHECIMENTO_DIR", "conhecimento/objecoes"))
    caminho_configuracao = Path(
        os.environ.get("CONFIGURACAO_COMERCIAL_ARQUIVO", "conhecimento/configuracao_comercial.json")
    )
    painel_dir = Path(os.environ.get("PAINEL_DIR", "painel-saida"))
    trilha_dir = Path(os.environ.get("TRILHA_DIR", "examples"))
    contato_dir = Path(os.environ.get("CONTATO_DIR", "contato/leads"))
    porta = int(os.environ.get("SERVIDOR_PORT", "8080"))

    servico = ServicoDeConhecimento(RepositorioDeConhecimentoJSON(conhecimento_dir))
    servico_configuracao = ServicoDeConfiguracaoComercial(
        RepositorioDeConfiguracaoComercialJSON(caminho_configuracao)
    )
    repositorio_contato = RepositorioDeContatoJSON(contato_dir)
    servico_contato = ServicoDeContato(repositorio_contato)
    portal_de_cotacao = ClienteQuoteHTTP(url_quote_service())

    app = criar_app(
        servico=servico,
        painel_dir=painel_dir,
        servico_configuracao=servico_configuracao,
        servico_contato=servico_contato,
        trilha_dir=trilha_dir,
        repositorio_contato=repositorio_contato,
        portal_de_cotacao=portal_de_cotacao,
    )

    with make_server("0.0.0.0", porta, app) as servidor:
        print(f"servidor local em http://0.0.0.0:{porta} — conhecimento em {conhecimento_dir}")
        servidor.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
