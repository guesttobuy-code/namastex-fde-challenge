"""Adaptador real da porta `RepositorioDeTrilha` (issue #7): append-only em JSONL, uma linha por
evento, sem banco — "não precisa, e banco custa tempo" (encomenda F4). `RepositorioDeTrilhaMemoria`
é o dublê determinístico para teste (âncora #3 §4: toda porta tem adaptador real e dublê).
"""

from __future__ import annotations

import json
from pathlib import Path


def _linhas_completas(conteudo: bytes) -> list[str]:
    """Dono único (LEI 11) de "quais linhas do arquivo já terminaram de ser gravadas" (issue #117):
    `registrar` sempre escreve `<json>\\n` de uma vez, então qualquer leitura concorrente só pode
    pegar uma linha pela metade na ÚLTIMA posição do arquivo — uma escrita em andamento nunca
    empurra bytes NO MEIO do que já foi gravado antes dela (append-only). Trabalha em BYTES, não em
    texto decodificado: `read_text` decodifica o ARQUIVO INTEIRO de uma vez, e uma escrita
    interrompida no meio de um caractere multibyte (ex.: "ã", 2 bytes UTF-8) quebra a decodificação
    inteira antes desta função rodar — texto em português tem acento na maioria das linhas.
    `conteudo.split(b"\\n")` sempre sobra com o último elemento sendo `b""` (arquivo termina em
    `\\n`, escrita completa) ou o fragmento em gravação (arquivo NÃO termina em `\\n`, podendo estar
    cortado no meio de um byte multibyte) — os dois casos descartam esse último elemento ANTES de
    qualquer `.decode()`; só então cada linha (já completa, sempre um caractere multibyte inteiro)
    é decodificada. UTF-8 ou JSON inválido numa linha que NÃO é a última continua levantando —
    corrupção de verdade nunca é escondida, só a ponta em gravação."""
    linhas = conteudo.split(b"\n")[:-1]
    return [linha.decode("utf-8") for linha in linhas if linha]


class RepositorioDeTrilhaJSONL:
    def __init__(self, caminho: Path) -> None:
        self._caminho = Path(caminho)

    def registrar(self, evento: dict) -> None:
        self._caminho.parent.mkdir(parents=True, exist_ok=True)
        with self._caminho.open("a", encoding="utf-8") as arquivo:
            arquivo.write(json.dumps(evento, ensure_ascii=False) + "\n")

    def eventos_da_conversa(self, conversation_id: str) -> list[dict]:
        if not self._caminho.exists():
            return []
        eventos = []
        for linha in _linhas_completas(self._caminho.read_bytes()):
            evento = json.loads(linha)
            if evento.get("conversation_id") == conversation_id:
                eventos.append(evento)
        return eventos

    def todos_os_eventos(self) -> list[dict]:
        """Enumera a trilha inteira, na ordem gravada — para quem precisa descobrir as conversas
        existentes sem conhecer os ids de antemão (painel, issue #13). `eventos_da_conversa` exige
        o id e por isso não serve para esse caso.
        """
        if not self._caminho.exists():
            return []
        return [json.loads(linha) for linha in _linhas_completas(self._caminho.read_bytes())]


class RepositorioDeTrilhaMemoria:
    """Dublê determinístico — mesma interface, sem tocar disco. Para teste de quem consome a porta."""

    def __init__(self) -> None:
        self._eventos: list[dict] = []

    def registrar(self, evento: dict) -> None:
        self._eventos.append(dict(evento))

    def eventos_da_conversa(self, conversation_id: str) -> list[dict]:
        return [e for e in self._eventos if e.get("conversation_id") == conversation_id]

    def todos_os_eventos(self) -> list[dict]:
        return list(self._eventos)
