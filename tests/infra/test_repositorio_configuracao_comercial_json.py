"""Vermelho-antes do bloqueante B4 da auditoria do PR #45: adaptador real da configuração
comercial (arquivo ausente = padrão do dono, `encaminhar_lead_fora_do_padrao=True`) e o dublê em
memória, mesmo molde de `infra/repositorio_conhecimento_json.py`."""
from __future__ import annotations

from dominio.configuracao_comercial import ConfiguracaoComercial
from infra.repositorio_configuracao_comercial_json import (
    RepositorioDeConfiguracaoComercialJSON,
    RepositorioDeConfiguracaoComercialMemoria,
)


def test_arquivo_ausente_devolve_o_padrao_do_dono(tmp_path):
    repo = RepositorioDeConfiguracaoComercialJSON(tmp_path / "configuracao_comercial.json")
    assert repo.carregar() == ConfiguracaoComercial(encaminhar_lead_fora_do_padrao=True)


def test_salvar_e_ler_de_volta_do_disco(tmp_path):
    caminho = tmp_path / "configuracao_comercial.json"
    repo = RepositorioDeConfiguracaoComercialJSON(caminho)
    repo.salvar(ConfiguracaoComercial(encaminhar_lead_fora_do_padrao=False))
    assert repo.carregar() == ConfiguracaoComercial(encaminhar_lead_fora_do_padrao=False)
    assert caminho.exists()


def test_duble_em_memoria_comeca_no_padrao_do_dono():
    repo = RepositorioDeConfiguracaoComercialMemoria()
    assert repo.carregar().encaminhar_lead_fora_do_padrao is True


def test_duble_em_memoria_salva_e_le_de_volta():
    repo = RepositorioDeConfiguracaoComercialMemoria()
    repo.salvar(ConfiguracaoComercial(encaminhar_lead_fora_do_padrao=False))
    assert repo.carregar().encaminhar_lead_fora_do_padrao is False
