"""Adaptador real da porta `RepositorioDeConfiguracaoComercial` (issue #43, F13, bloqueante B4 da
auditoria do PR #45): `conhecimento/configuracao_comercial.json`, um valor só. Arquivo ausente =
`ConfiguracaoComercial()` — o padrão do dono (#41/#42, `encaminhar_lead_fora_do_padrao=True`) —
nunca falha e nunca fabrica outro valor. `RepositorioDeConfiguracaoComercialMemoria` é o dublê
determinístico para teste (mesmo molde de `infra/repositorio_conhecimento_json.py`)."""

from __future__ import annotations

import json
from pathlib import Path

from dominio.configuracao_comercial import ConfiguracaoComercial
from infra.escrita_atomica import escrever_atomico


class RepositorioDeConfiguracaoComercialJSON:
    def __init__(self, caminho: Path) -> None:
        self._caminho = Path(caminho)

    def carregar(self) -> ConfiguracaoComercial:
        if not self._caminho.exists():
            return ConfiguracaoComercial()
        dados = json.loads(self._caminho.read_text(encoding="utf-8"))
        return ConfiguracaoComercial(
            encaminhar_lead_fora_do_padrao=bool(dados.get("encaminhar_lead_fora_do_padrao", True))
        )

    def salvar(self, configuracao: ConfiguracaoComercial) -> None:
        conteudo = {"encaminhar_lead_fora_do_padrao": configuracao.encaminhar_lead_fora_do_padrao}
        escrever_atomico(self._caminho, json.dumps(conteudo, indent=2) + "\n")


class RepositorioDeConfiguracaoComercialMemoria:
    """Dublê determinístico — mesma interface, sem tocar disco. Para teste de quem consome a porta."""

    def __init__(self, configuracao: ConfiguracaoComercial | None = None) -> None:
        self._configuracao = configuracao if configuracao is not None else ConfiguracaoComercial()

    def carregar(self) -> ConfiguracaoComercial:
        return self._configuracao

    def salvar(self, configuracao: ConfiguracaoComercial) -> None:
        self._configuracao = configuracao
