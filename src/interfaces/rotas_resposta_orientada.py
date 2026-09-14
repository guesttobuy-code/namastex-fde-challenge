"""`POST /api/chat/responder` (issue #58, frente `ia-responde`) — extraído de `interfaces.servidor`
só para não estourar o teto de linhas do arquivo (`file-loc-ceiling`); mesmo despacho HTTP <->
aplicação de sempre, nenhuma decisão nova. Módulo próprio (não dentro de `interfaces.chat`, que já
é de outra frente) para o `servidor.py` só ter a linha de roteamento que chama esta função —
`interfaces.servidor` segue sendo dono das rotas `/api/chat/cotar`/`/api/chat/contratar`, que
outras frentes tocam em paralelo (não duplicadas aqui, só a nova).

Utilitários de borda HTTP (`_json`/`_METODO_NAO_SUPORTADO`/`_ler_corpo_json`/
`_conversation_id_ou_400`) importados de `interfaces.http_comum` (issue #51 parte 2, PR #76 — LEI
11, dono único: antes eram cópias triviais aqui, `interfaces.servidor` extraiu o módulo comum
porque o próprio `servidor.py` já ia estourar o `file-loc-ceiling` com mais uma frente duplicando)."""

from __future__ import annotations

from pathlib import Path

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from aplicacao.servico_configuracao_comercial import ServicoDeConfiguracaoComercial
from aplicacao.servico_resposta_orientada import processar_mensagem_livre
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.estado_conversa import EstadoDaConversa
from dominio.preco_cotado import PrecoCotado
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL
from interfaces.http_comum import METODO_NAO_SUPORTADO as _METODO_NAO_SUPORTADO
from interfaces.http_comum import conversation_id_ou_400 as _conversation_id_ou_400
from interfaces.http_comum import json_resposta as _json
from interfaces.http_comum import ler_corpo_json as _ler_corpo_json


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
