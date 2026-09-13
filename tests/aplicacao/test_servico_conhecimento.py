"""Vermelho-antes do caso de uso da #43: `ServicoDeConhecimento` orquestra domínio (invariante do
marcador) + porta (persistência), nunca reimplementa a regra (mesma disciplina de
`ServicoDeTrilha`). `ids_dos_planos` (achado B2 da auditoria do PR #45): a borda HTTP lê a
`/planos` e repassa aqui — este serviço só encaminha para o domínio, nunca fala com rede."""
from __future__ import annotations

import pytest

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from dominio.ficha_objecao import MarcadorInvalido
from infra.repositorio_conhecimento_json import RepositorioDeConhecimentoMemoria

_DADOS = {
    "id": "preco-alto",
    "nome": "Preço tá salgado",
    "frases_do_lead": ["o preço tá salgado"],
    "resposta_orientada": "Posso ajustar a franquia para {{franquia}}.",
    "argumentos_permitidos": ["franquia_por_plano"],
    "tentativas_antes_do_corretor": 2,
    "status": "rascunho",
}


def _servico() -> ServicoDeConhecimento:
    return ServicoDeConhecimento(RepositorioDeConhecimentoMemoria())


def test_salvar_rascunho_nunca_valida_marcador():
    servico = _servico()
    dados_invalidos = {**_DADOS, "resposta_orientada": "O plano custa R$ 199,90.", "status": "rascunho"}
    persistido = servico.salvar_objecao(dados_invalidos)
    assert persistido["status"] == "rascunho"
    assert servico.obter_objecao("preco-alto")["resposta_orientada"] == "O plano custa R$ 199,90."


def test_primeira_publicacao_com_marcador_valido_persiste_com_versao_1():
    servico = _servico()
    persistido = servico.salvar_objecao({**_DADOS, "status": "publicado"})
    assert persistido["status"] == "publicado"
    assert persistido["versao"] == 1
    assert persistido["atualizado_em"] != ""


def test_republicar_incrementa_a_partir_da_versao_ja_publicada():
    servico = _servico()
    servico.salvar_objecao({**_DADOS, "status": "publicado"})
    persistido = servico.salvar_objecao({**_DADOS, "status": "publicado", "versao": 1})
    assert persistido["versao"] == 2


def test_publicar_com_digito_fora_de_marcador_e_recusado_e_nada_e_persistido():
    servico = _servico()
    dados_invalidos = {**_DADOS, "resposta_orientada": "O plano custa R$ 199,90.", "status": "publicado"}
    with pytest.raises(MarcadorInvalido):
        servico.salvar_objecao(dados_invalidos)
    assert servico.obter_objecao("preco-alto") is None


def test_marcador_por_plano_so_publica_quando_o_id_do_plano_e_passado():
    servico = _servico()
    dados = {**_DADOS, "resposta_orientada": "Franquia do Premium: {{franquia_premium}}.", "status": "publicado"}
    with pytest.raises(MarcadorInvalido):
        servico.salvar_objecao(dados)
    persistido = servico.salvar_objecao(dados, ids_dos_planos=["premium"])
    assert persistido["status"] == "publicado"


def test_listar_objecoes_delega_para_o_repositorio():
    servico = _servico()
    servico.salvar_objecao(_DADOS)
    ids = [f["id"] for f in servico.listar_objecoes()]
    assert ids == ["preco-alto"]


def test_obter_objecao_inexistente_devolve_none():
    servico = _servico()
    assert servico.obter_objecao("nao-existe") is None


# ── #53: relógio injetável — o domínio não lê o relógio, esta camada fornece ─


def test_agora_injetado_define_o_atualizado_em_gravado():
    instante_fixo = "2026-09-13T12:00:00+00:00"
    servico = ServicoDeConhecimento(RepositorioDeConhecimentoMemoria(), agora=lambda: instante_fixo)
    persistido = servico.salvar_objecao({**_DADOS, "status": "publicado"})
    assert persistido["atualizado_em"] == instante_fixo
