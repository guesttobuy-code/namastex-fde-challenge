"""`ServicoDeConfiguracaoComercial` (issue #43, F13, bloqueante B4 da auditoria do PR #45): caso
de uso para ler/gravar a configuração comercial. Nunca decide — quem decide o que fazer com a
recusa da `/quote` continua `dominio.politica.decidir`; este serviço só carrega o valor real de
`conhecimento/` e devolve, mesma disciplina de `ServicoDeConhecimento`."""

from __future__ import annotations

from dominio.configuracao_comercial import ConfiguracaoComercial

from .portas.repositorio_configuracao_comercial import RepositorioDeConfiguracaoComercial


class ServicoDeConfiguracaoComercial:
    def __init__(self, repositorio: RepositorioDeConfiguracaoComercial) -> None:
        self._repositorio = repositorio

    def obter(self) -> ConfiguracaoComercial:
        return self._repositorio.carregar()

    def salvar(self, *, encaminhar_lead_fora_do_padrao: bool) -> ConfiguracaoComercial:
        configuracao = ConfiguracaoComercial(
            encaminhar_lead_fora_do_padrao=bool(encaminhar_lead_fora_do_padrao)
        )
        self._repositorio.salvar(configuracao)
        return configuracao
