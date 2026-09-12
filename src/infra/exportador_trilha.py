"""Transforma a trilha de uma conversa no log de execução legível — entregável obrigatório do
desafio ("log de uma execução completa"). Lê pela porta `RepositorioDeTrilha`, nunca do arquivo
JSONL direto, para funcionar igual com o dublê em memória e com o adaptador real.
"""

from __future__ import annotations


def exportar_execucao(conversation_id: str, repositorio) -> str:
    eventos = repositorio.eventos_da_conversa(conversation_id)
    linhas = [f"# Execução — {conversation_id}", ""]
    for evento in eventos:
        linhas.append(_linha_do_evento(evento))
    return "\n".join(linhas) + "\n"


def _linha_do_evento(evento: dict) -> str:
    tipo = evento.get("evento", "?")
    instante = evento.get("instante", "?")
    identificador = evento.get("id", "?")
    detalhe = _detalhe(evento)
    return f"[{instante}] {tipo} id={identificador}{detalhe}"


def _detalhe(evento: dict) -> str:
    tipo = evento.get("evento")
    if tipo == "mensagem_enviada":
        return f" decisao={evento.get('decisao_id')} regra={evento.get('regra_aplicada')}"
    if tipo == "tentativa_de_cotacao":
        return f" status={evento.get('http_status')} classificacao={evento.get('classificacao')}"
    if tipo == "handoff":
        return f" motivo={evento.get('reason_code')}"
    return ""
