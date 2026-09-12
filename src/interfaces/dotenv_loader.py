"""Carrega o `.env` da raiz do repositório para `os.environ` (issue #9, F6) — inicialização de
PROCESSO, por isso mora em `interfaces` (quem entra: a CLI, ou um teste `llm_real`) e nunca em
`dominio`/`aplicacao`/`infra`, que não sabem que um `.env` existe.

Parser mínimo de propósito: sem dependência nova (nada de `python-dotenv`), mesmo regime enxuto do
resto do projeto. Nunca loga, imprime nem devolve nenhum valor lido — só popula o ambiente, e só as
chaves que ainda não estão definidas (uma variável já exportada no processo real sempre vence).

Isto é código de PRODUÇÃO lendo a própria configuração do processo em runtime — diferente de um
chat/agente abrir o arquivo para conferir, que continua terminantemente proibido (#9).

Tolera os dois formatos que já causaram o achado real desta frente (Bloco de Notas no Windows):
BOM UTF-8 no início do arquivo e finais de linha CRLF — além de aspas simples/duplas em volta do
valor e espaço em torno do `=`.
"""

from __future__ import annotations

import os
from pathlib import Path

_RAIZ_DO_REPO = Path(__file__).resolve().parents[2]


def carregar_dotenv_no_ambiente(caminho: Path | None = None) -> None:
    alvo = caminho if caminho is not None else _RAIZ_DO_REPO / ".env"
    if not alvo.is_file():
        return
    conteudo = alvo.read_text(encoding="utf-8-sig")  # utf-8-sig: engole BOM se existir
    for linha_bruta in conteudo.splitlines():  # splitlines() trata \n e \r\n igual
        linha = linha_bruta.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, _, valor = linha.partition("=")
        chave = chave.strip()
        if not chave:
            continue
        valor = valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in ("'", '"'):
            valor = valor[1:-1]
        os.environ.setdefault(chave, valor)
