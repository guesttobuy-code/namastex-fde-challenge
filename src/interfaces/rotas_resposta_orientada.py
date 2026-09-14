"""`POST /api/chat/responder` (issue #58, frente `ia-responde`) — extraído de `interfaces.servidor`
só para não estourar o teto de linhas do arquivo (`file-loc-ceiling`); mesmo despacho HTTP <->
aplicação de sempre, nenhuma decisão nova. Módulo próprio (não dentro de `interfaces.chat`, que já
é de outra frente) para o `servidor.py` só ter a linha de roteamento que chama esta função —
`interfaces.servidor` segue sendo dono das rotas `/api/chat/cotar`/`/api/chat/contratar`, que
outras frentes tocam em paralelo (não duplicadas aqui, só a nova).

`_json`/`_METODO_NAO_SUPORTADO`/`_ler_corpo_json`/`_conversation_id_ou_400` são cópias triviais dos
mesmos utilitários de `interfaces.servidor` (LEI 11 — técnica de borda HTTP, não regra de negócio;
mesmo raciocínio já usado para `_CONVERSATION_ID_VALIDO` duplicado nas 3 bordas que recebem o id) —
importar de `interfaces.servidor` criaria import circular, porque é `servidor.py` quem chama esta
função."""

from __future__ import annotations

import json
import re
from pathlib import Path

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from aplicacao.servico_configuracao_comercial import ServicoDeConfiguracaoComercial
from aplicacao.servico_resposta_orientada import processar_mensagem_livre
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.estado_conversa import EstadoDaConversa
from dominio.preco_cotado import PrecoCotado
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL

_CONVERSATION_ID_VALIDO = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_METODO_NAO_SUPORTADO = ("405 Method Not Allowed", {"erro": "método não suportado"})


def _json(status: str, corpo: dict | list) -> tuple[str, list[tuple[str, str]], list[bytes]]:
    dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
    cabecalhos = [("Content-Type", "application/json; charset=utf-8"), ("Content-Length", str(len(dados)))]
    return status, cabecalhos, [dados]


def _ler_corpo_json(environ) -> dict | None:
    try:
        tamanho = int(environ.get("CONTENT_LENGTH") or 0)
        bruto = environ["wsgi.input"].read(tamanho)
        return json.loads(bruto or b"{}")
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def _conversation_id_ou_400(dados: dict) -> tuple[str, None] | tuple[None, tuple]:
    conversation_id = dados.get("conversation_id")
    if not conversation_id or not isinstance(conversation_id, str):
        return None, _json("400 Bad Request", {"erro": "conversation_id é obrigatório"})
    if not _CONVERSATION_ID_VALIDO.match(conversation_id):
        return None, _json("400 Bad Request", {"erro": "conversation_id fora do formato seguro"})
    return conversation_id, None


def responder_chat_responder(
    *,
    servico: ServicoDeConhecimento,
    servico_configuracao: ServicoDeConfiguracaoComercial,
    buscar_planos,
    portal_de_linguagem,
    portal_de_resposta_orientada,
    trilha_dir: Path,
    estados_em_memoria: dict[str, EstadoDaConversa],
    precos_em_memoria: dict[str, PrecoCotado],
    environ,
    metodo: str,
):
    """`POST /api/chat/responder`: classifica uma mensagem LIVRE do lead (fora do fluxo
    estruturado de coleta) e, se for objeção de preço com uma cotação já feita
    (`precos_em_memoria`), responde com a base de conhecimento
    (`aplicacao.servico_resposta_orientada.processar_mensagem_livre`). Ligada ao campo de texto
    livre depois do card de preço (`habilitarCampoDeObjecao` em `interfaces.chat._corpo.html`).
    Qualquer outra intenção, ou objeção sem cotação ainda: `processar_mensagem_livre` já devolve o
    texto fixo de fora-de-escopo (issue #58, veredito da auditoria do PR #75, bloqueante B3) — esta
    rota sempre devolve `tratado: true` com algum texto, nunca deixa o lead sem resposta.

    `estados_em_memoria`/`precos_em_memoria` são os MESMOS dicts de módulo de
    `interfaces.servidor` (ADR-0005, decisão 1) — passados por referência, nunca copiados, para
    esta rota enxergar o estado que as outras rotas já gravaram."""
    if metodo != "POST":
        return _json(*_METODO_NAO_SUPORTADO)
    dados = _ler_corpo_json(environ)
    if dados is None:
        return _json("400 Bad Request", {"erro": "corpo não é JSON válido"})
    conversation_id, resposta_erro = _conversation_id_ou_400(dados)
    if resposta_erro is not None:
        return resposta_erro
    texto = dados.get("texto")
    if not isinstance(texto, str) or not texto.strip():
        return _json("400 Bad Request", {"erro": "campo texto é obrigatório"})

    estado = estados_em_memoria.get(conversation_id) or EstadoDaConversa(conversation_id=conversation_id)
    preco_atual = precos_em_memoria.get(conversation_id)
    catalogo = buscar_planos()
    planos = catalogo.get("planos", []) if catalogo else []
    configuracao = servico_configuracao.obter()

    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / f"trilha_{conversation_id}.jsonl")
    trilha = ServicoDeTrilha(repositorio_trilha)

    texto_resposta, _origem_do_texto, intencao = processar_mensagem_livre(
        portal_de_linguagem=portal_de_linguagem,
        portal_de_resposta=portal_de_resposta_orientada,
        texto_bruto=texto,
        estado=estado,
        preco_atual=preco_atual,
        planos=planos,
        servico_conhecimento=servico,
        configuracao=configuracao,
        trilha=trilha,
    )
    return _json(
        "200 OK",
        {"tratado": True, "texto": texto_resposta, "intent": intencao.value if intencao is not None else None},
    )
