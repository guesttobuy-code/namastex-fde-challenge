"""Adaptador real de `RepositorioDeContato` (issue #46, PR 2 de 2, ADR-0005): ida e volta em disco,
recusa de path traversal (mesma técnica de `tests/infra/test_repositorio_conhecimento_json.py`), e
a prova de que `contato/` está fora do git (`git check-ignore` de verdade)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from dominio.contato_lead import ContatoLead
from infra.repositorio_contato_json import RepositorioDeContatoJSON, RepositorioDeContatoMemoria

_RAIZ_DO_REPO = Path(__file__).resolve().parents[2]

_CONTATO = ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584", email="ursula@example.com")


def test_salva_e_le_de_volta(tmp_path):
    repo = RepositorioDeContatoJSON(tmp_path / "leads")
    repo.salvar("conv-1", _CONTATO)
    assert repo.obter("conv-1") == _CONTATO


def test_obter_conversation_id_inexistente_devolve_none(tmp_path):
    repo = RepositorioDeContatoJSON(tmp_path / "leads")
    assert repo.obter("nao-existe") is None


@pytest.mark.parametrize("id_malicioso", ["../../etc/passwd", "..\\..\\segredo", "a/b", ""])
def test_conversation_id_fora_do_formato_seguro_e_recusado_no_disco(tmp_path, id_malicioso):
    repo = RepositorioDeContatoJSON(tmp_path / "leads")
    with pytest.raises(ValueError, match="conversation_id inválido"):
        repo.salvar(id_malicioso, _CONTATO)


def test_duble_em_memoria_tem_a_mesma_interface():
    repo = RepositorioDeContatoMemoria()
    assert repo.obter("conv-1") is None
    repo.salvar("conv-1", _CONTATO)
    assert repo.obter("conv-1") == _CONTATO


def test_duble_em_memoria_tambem_recusa_conversation_id_inseguro():
    repo = RepositorioDeContatoMemoria()
    with pytest.raises(ValueError, match="conversation_id inválido"):
        repo.salvar("../fuga", _CONTATO)


def test_git_check_ignore():
    """Roda `git check-ignore` de verdade contra um arquivo escrito em `contato/leads/` DENTRO do
    repo (não em `tmp_path`) — só assim prova que a pasta real está fora do git. Escreve e limpa o
    próprio arquivo/pasta para não sujar a árvore de trabalho, tanto se o teste passar quanto se
    continuar vermelho (xfail)."""
    diretorio = _RAIZ_DO_REPO / "contato" / "leads"
    repo = RepositorioDeContatoJSON(diretorio)
    caminho = diretorio / "conv-check-ignore.json"
    try:
        repo.salvar("conv-check-ignore", _CONTATO)
        resultado = subprocess.run(
            ["git", "check-ignore", str(caminho)],
            cwd=_RAIZ_DO_REPO,
            capture_output=True,
            text=True,
        )
        assert resultado.returncode == 0, (
            f"contato/leads/ deveria estar no .gitignore — git check-ignore devolveu "
            f"{resultado.returncode}: {resultado.stderr}"
        )
    finally:
        if caminho.exists():
            caminho.unlink()
        if diretorio.exists() and not any(diretorio.iterdir()):
            diretorio.rmdir()
        pasta_contato = _RAIZ_DO_REPO / "contato"
        if pasta_contato.exists() and not any(pasta_contato.iterdir()):
            pasta_contato.rmdir()
