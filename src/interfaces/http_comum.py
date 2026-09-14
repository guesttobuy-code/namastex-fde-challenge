"""Utilitários de borda HTTP compartilhados entre os módulos de rota do chat (`servidor.py`,
`chat_mensagem.py`, e os que vierem depois) — extraído de `servidor.py` para não duplicar entre
módulos de rota nem empurrar o arquivo para perto do teto do `file-loc-ceiling` (achado do PR de
#51, parte 2). Sem mudança de comportamento: mesmas assinaturas, mesmos status, mesmas mensagens
de erro que já existiam em `servidor.py`.
"""

from __future__ import annotations

import json
import re

# Achado de segurança (revisão automática, 13/09/2026): `conversation_id` chega pelo corpo do POST
# — HTTP, não confiável — e vira nome de arquivo da trilha (`trilha_dir / f"trilha_{conversation_id}.jsonl"`).
# Sem validar o formato, um `conversation_id` tipo "../../etc/cron.d/x" escreve/lê fora de
# `trilha_dir` (path traversal). Mesmo regex de `infra.repositorio_contato_json._CONVERSATION_ID_VALIDO`
# (LEI 11: mesma técnica de validação de nome de arquivo, dono duplicado de propósito nas bordas
# que recebem o id — mesmo raciocínio já registrado ali, não uma regra de negócio nova).
CONVERSATION_ID_VALIDO = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

METODO_NAO_SUPORTADO = ("405 Method Not Allowed", {"erro": "método não suportado"})


def json_resposta(status: str, corpo: dict | list) -> tuple[str, list[tuple[str, str]], list[bytes]]:
    dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8")
    cabecalhos = [("Content-Type", "application/json; charset=utf-8"), ("Content-Length", str(len(dados)))]
    return status, cabecalhos, [dados]


def ler_corpo_json(environ) -> dict | None:
    """`None` quando o corpo não é JSON válido — quem chama decide o 400."""
    try:
        tamanho = int(environ.get("CONTENT_LENGTH") or 0)
        bruto = environ["wsgi.input"].read(tamanho)
        return json.loads(bruto or b"{}")
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def conversation_id_ou_400(dados: dict) -> tuple[str, None] | tuple[None, tuple]:
    """`(conversation_id, None)` se válido; `(None, resposta_400)` se ausente ou fora do formato
    seguro — quem chama devolve a resposta direto (`return resposta` quando o segundo item não é
    `None`)."""
    conversation_id = dados.get("conversation_id")
    if not conversation_id or not isinstance(conversation_id, str):
        return None, json_resposta("400 Bad Request", {"erro": "conversation_id é obrigatório"})
    if not CONVERSATION_ID_VALIDO.match(conversation_id):
        return None, json_resposta("400 Bad Request", {"erro": "conversation_id fora do formato seguro"})
    return conversation_id, None
