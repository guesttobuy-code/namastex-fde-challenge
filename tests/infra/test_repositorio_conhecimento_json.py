"""Vermelho-antes do adaptador real da #43: ida e volta em disco, e o dublê em memória com a
mesma interface (mesmo molde de tests/infra/test_trilha_jsonl.py)."""
from __future__ import annotations

import json

import pytest

from infra.repositorio_conhecimento_json import (
    RepositorioDeConhecimentoJSON,
    RepositorioDeConhecimentoMemoria,
)

_FICHA = {
    "id": "preco-alto",
    "nome": "Preço tá salgado",
    "frases_do_lead": ["o preço tá salgado"],
    "resposta_orientada": "Posso ajustar a franquia para {{franquia}}.",
    "argumentos_permitidos": ["franquia_por_plano"],
    "tentativas_antes_do_corretor": 2,
    "status": "rascunho",
    "versao": 1,
    "atualizado_em": "",
}


def test_salvar_e_ler_de_volta_do_disco(tmp_path):
    repo = RepositorioDeConhecimentoJSON(tmp_path / "objecoes")
    repo.salvar_objecao("preco-alto", _FICHA)
    assert repo.obter_objecao("preco-alto") == _FICHA


def test_obter_objecao_inexistente_devolve_none(tmp_path):
    repo = RepositorioDeConhecimentoJSON(tmp_path / "objecoes")
    assert repo.obter_objecao("nao-existe") is None


def test_listar_objecoes_num_diretorio_ainda_sem_arquivo_devolve_lista_vazia(tmp_path):
    repo = RepositorioDeConhecimentoJSON(tmp_path / "objecoes")
    assert repo.listar_objecoes() == []


def test_listar_objecoes_enumera_todas_as_fichas_gravadas(tmp_path):
    repo = RepositorioDeConhecimentoJSON(tmp_path / "objecoes")
    repo.salvar_objecao("a", {**_FICHA, "id": "a"})
    repo.salvar_objecao("b", {**_FICHA, "id": "b"})
    ids = sorted(f["id"] for f in repo.listar_objecoes())
    assert ids == ["a", "b"]


def test_arquivo_gravado_e_json_legivel_por_fora(tmp_path):
    diretorio = tmp_path / "objecoes"
    RepositorioDeConhecimentoJSON(diretorio).salvar_objecao("preco-alto", _FICHA)
    conteudo = json.loads((diretorio / "preco-alto.json").read_text(encoding="utf-8"))
    assert conteudo["nome"] == "Preço tá salgado"


@pytest.mark.parametrize("id_malicioso", ["../../etc/passwd", "..\\..\\segredo", "a/b", ""])
def test_id_fora_do_formato_seguro_e_recusado_no_disco(tmp_path, id_malicioso):
    repo = RepositorioDeConhecimentoJSON(tmp_path / "objecoes")
    with pytest.raises(ValueError, match="id de ficha inválido"):
        repo.salvar_objecao(id_malicioso, _FICHA)


def test_duble_em_memoria_tem_a_mesma_interface():
    repo = RepositorioDeConhecimentoMemoria()
    assert repo.listar_objecoes() == []
    repo.salvar_objecao("preco-alto", _FICHA)
    assert repo.obter_objecao("preco-alto") == _FICHA
    assert repo.listar_objecoes() == [_FICHA]


def test_duble_em_memoria_tambem_recusa_id_inseguro():
    repo = RepositorioDeConhecimentoMemoria()
    with pytest.raises(ValueError, match="id de ficha inválido"):
        repo.salvar_objecao("../fuga", _FICHA)


def test_duble_em_memoria_devolve_copia_nao_a_referencia_interna():
    repo = RepositorioDeConhecimentoMemoria()
    repo.salvar_objecao("preco-alto", dict(_FICHA))
    lida = repo.obter_objecao("preco-alto")
    lida["nome"] = "adulterado por fora"
    assert repo.obter_objecao("preco-alto")["nome"] == "Preço tá salgado"
