"""`escrever_atomico` (issue #110): escreve num arquivo temporário no MESMO diretório e troca com
`os.replace` — atômico em POSIX e Windows — para nenhum leitor concorrente (outro pedido HTTP, ou o
próprio dono olhando o painel) conseguir ler um arquivo pela metade enquanto outra thread ainda
escreve nele. Usado por `interfaces.painel.gerar`, `infra.repositorio_contato_json` e
`infra.repositorio_configuracao_comercial_json` — todos escrevem o arquivo INTEIRO de uma vez
(nunca fazem append), o caso que `os.replace` resolve; a trilha JSONL (append-only) usa
`infra.trava_por_conversa` em vez disso.

Achado ao medir no Windows (ambiente de dev desta frente): `os.replace` pode devolver
`PermissionError: [WinError 5]` quando o destino está aberto por outro leitor NO MESMO INSTANTE
(POSIX deixa trocar um arquivo aberto; o Windows, não, sem `FILE_SHARE_DELETE`) — `_TENTATIVAS`
tentativas com pausa curta absorvem essa janela, que dura microssegundos."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path

_TENTATIVAS = 20
_ESPERA_ENTRE_TENTATIVAS_SEGUNDOS = 0.01


def escrever_atomico(caminho: Path, conteudo: str | bytes, *, encoding: str | None = "utf-8") -> None:
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    temporario = caminho.with_name(f"{caminho.name}.tmp-{os.getpid()}-{threading.get_ident()}")
    if isinstance(conteudo, bytes):
        temporario.write_bytes(conteudo)
    else:
        temporario.write_text(conteudo, encoding=encoding)

    for tentativa in range(1, _TENTATIVAS + 1):
        try:
            os.replace(temporario, caminho)
        except PermissionError:
            if tentativa == _TENTATIVAS:
                raise
            time.sleep(_ESPERA_ENTRE_TENTATIVAS_SEGUNDOS)
        else:
            return
