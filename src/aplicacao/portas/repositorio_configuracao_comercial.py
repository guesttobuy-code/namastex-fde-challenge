"""Porta `RepositorioDeConfiguracaoComercial` (issue #43, F13, bloqueante B4 da auditoria do PR
#45): declara a forma de armazenamento de `dominio.configuracao_comercial.ConfiguracaoComercial`
em `conhecimento/configuracao_comercial.json`. Quem grava de verdade é
`infra/repositorio_configuracao_comercial_json.py`; `aplicacao` só conhece esta interface — nunca
importa `infra` (mesma disciplina de `RepositorioDeTrilha`/`RepositorioDeConhecimento`)."""

from __future__ import annotations

from typing import Protocol

from dominio.configuracao_comercial import ConfiguracaoComercial


class RepositorioDeConfiguracaoComercial(Protocol):
    def carregar(self) -> ConfiguracaoComercial: ...

    def salvar(self, configuracao: ConfiguracaoComercial) -> None: ...
