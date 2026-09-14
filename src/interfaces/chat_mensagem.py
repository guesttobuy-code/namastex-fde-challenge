"""`POST /api/chat/mensagem` (issue #51, parte 2): registra uma pergunta ou resposta do fluxo guiado
do chat na trilha, pelas MESMAS `aplicacao.servico_conversa.registrar_pergunta_de_coleta`/
`registrar_resposta_de_coleta` que `interfaces.cli` já usa (dono único da escrita da trilha, LEI 11).

Módulo próprio (não dentro de `interfaces/servidor.py`) porque esse arquivo está perto do teto do
guard `file-loc-ceiling` e outras frentes mexem nele ao mesmo tempo — só a linha de roteamento fica
lá. Os helpers genéricos de borda HTTP moram em `interfaces.http_comum` (extraído de `servidor.py`
pelo mesmo motivo de teto), importados direto — sem duplicar nem criar import circular.

Quem decide se um campo é PII é o SERVIDOR, nunca o JS — decidir no cliente é frágil (bug no JS, ou
alguém chamando a rota direto, grava o dado real na trilha). `_CAMPOS_VALIDOS` são as 9 chaves do
objeto `PASSOS` em `interfaces/chat/_corpo.html` (mesmo vocabulário, dono único da lista dos
passos); `_CAMPOS_SENSIVEIS` é o subconjunto que nunca pode virar texto real na trilha (nome/
whatsapp/email já têm dono único de escrita em `ServicoDeContato`/`_responder_chat_contato` —
ADR-0005)."""

from __future__ import annotations

from pathlib import Path

from aplicacao.servico_conversa import registrar_pergunta_de_coleta, registrar_resposta_de_coleta
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.validacao import normalizar_cep
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL
from interfaces.http_comum import METODO_NAO_SUPORTADO, conversation_id_ou_400, json_resposta, ler_corpo_json

_CAMPOS_VALIDOS = frozenset({"nome", "whatsapp", "email", "idade", "modelo", "ano", "cep", "plano", "inicio"})
_CAMPOS_SENSIVEIS = frozenset({"nome", "whatsapp", "email"})
_MARCADOR_CONTATO = "[contato registrado fora da trilha]"


def responder_chat_mensagem(*, trilha_dir: Path, environ, metodo: str):
    """`campo` diz qual das 9 perguntas é esta — quando `campo` está em `_CAMPOS_SENSIVEIS`
    (nome/whatsapp/email), o texto REAL que o cliente mandou é substituído por `_MARCADOR_CONTATO`
    ANTES de chegar em `registrar_*_de_coleta`: a garantia de que PII nunca chega na trilha mora
    aqui, incondicional ao que o JS mandou (nunca no cliente — ver `_corpo.html`). Nunca chama
    `gerar_paineis` (mesmo padrão mais leve de `_responder_chat_contato` — só cotar/contratar
    regeneram o painel a cada chamada)."""
    if metodo != "POST":
        return json_resposta(*METODO_NAO_SUPORTADO)
    dados = ler_corpo_json(environ)
    if dados is None:
        return json_resposta("400 Bad Request", {"erro": "corpo não é JSON válido"})
    conversation_id, resposta_erro = conversation_id_ou_400(dados)
    if resposta_erro is not None:
        return resposta_erro
    indice = dados.get("indice")
    direcao = dados.get("direcao")
    campo = dados.get("campo")
    texto = dados.get("texto")
    if (
        not isinstance(indice, int)
        or direcao not in ("pergunta", "resposta")
        or campo not in _CAMPOS_VALIDOS
        or not isinstance(texto, str)
    ):
        return json_resposta(
            "400 Bad Request",
            {"erro": "indice (int), direcao ('pergunta'|'resposta'), campo (um dos 9 passos) e texto (str) são obrigatórios"},
        )
    if campo in _CAMPOS_SENSIVEIS:
        texto_para_gravar = _MARCADOR_CONTATO
    elif campo == "cep" and direcao == "resposta":
        # issue #68 (dominio.validacao.normalizar_cep, dono único): CEP sem hífen bate em
        # dominio.validacao.cep_valido mas não em nenhum padrão de dominio.redator_pii — sem
        # normalizar aqui, "01310100" (sem hífen) chegaria em claro na trilha, só "01310-100"
        # seria mascarado. Normaliza ANTES de registrar_resposta_de_coleta, que já redige via
        # ServicoDeTrilha; formato que normalizar_cep não reconhece passa como veio (mesma
        # disciplina de "não inventa dado", LEI 2 — não é papel desta rota validar CEP).
        texto_para_gravar = normalizar_cep(texto) or texto
    else:
        texto_para_gravar = texto
    repositorio_trilha = RepositorioDeTrilhaJSONL(trilha_dir / f"trilha_{conversation_id}.jsonl")
    trilha = ServicoDeTrilha(repositorio_trilha)
    if direcao == "pergunta":
        registrar_pergunta_de_coleta(trilha, conversation_id, indice, texto_para_gravar, origem_do_texto="chat_guiado")
    else:
        registrar_resposta_de_coleta(trilha, conversation_id, indice, texto_para_gravar)
    return json_resposta("200 OK", {"ok": True})
