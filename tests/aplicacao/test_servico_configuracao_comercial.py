"""Vermelho-antes do bloqueante B4 da auditoria do PR #45: `ServicoDeConfiguracaoComercial` só
orquestra domínio + porta, nunca decide o que fazer com a recusa da `/quote` (isso continua
`dominio.politica.decidir`)."""
from __future__ import annotations

from aplicacao.servico_configuracao_comercial import ServicoDeConfiguracaoComercial
from infra.repositorio_configuracao_comercial_json import RepositorioDeConfiguracaoComercialMemoria


def test_obter_comeca_no_padrao_do_dono():
    servico = ServicoDeConfiguracaoComercial(RepositorioDeConfiguracaoComercialMemoria())
    assert servico.obter().encaminhar_lead_fora_do_padrao is True


def test_salvar_desliga_e_obter_reflete():
    servico = ServicoDeConfiguracaoComercial(RepositorioDeConfiguracaoComercialMemoria())
    servico.salvar(encaminhar_lead_fora_do_padrao=False)
    assert servico.obter().encaminhar_lead_fora_do_padrao is False
