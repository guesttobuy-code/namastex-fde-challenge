"""`carregar_dotenv_no_ambiente` (issue #9, F6) — parser mínimo, sem dependência nova. Mora em
`interfaces` porque é inicialização de processo, não regra de negócio. Casos medidos contra o
achado real desta frente: o `.env` desta máquina foi escrito no Bloco de Notas (BOM UTF-8, CRLF) e
a primeira tentativa salvou o arquivo como `.env.txt`.
"""

from __future__ import annotations

import os

from interfaces.dotenv_loader import carregar_dotenv_no_ambiente


def test_popula_variavel_nova(tmp_path, monkeypatch):
    monkeypatch.delenv("MINHA_VAR_DOTENV_1", raising=False)
    arquivo = tmp_path / ".env"
    arquivo.write_text("MINHA_VAR_DOTENV_1=valor-do-arquivo\n", encoding="utf-8")

    carregar_dotenv_no_ambiente(arquivo)

    assert os.environ["MINHA_VAR_DOTENV_1"] == "valor-do-arquivo"


def test_nunca_sobrescreve_variavel_ja_definida(monkeypatch, tmp_path):
    monkeypatch.setenv("MINHA_VAR_DOTENV_2", "valor-real-do-processo")
    arquivo = tmp_path / ".env"
    arquivo.write_text("MINHA_VAR_DOTENV_2=valor-do-arquivo-nunca-deveria-vencer\n", encoding="utf-8")

    carregar_dotenv_no_ambiente(arquivo)

    assert os.environ["MINHA_VAR_DOTENV_2"] == "valor-real-do-processo"


def test_ignora_comentario_e_linha_vazia(monkeypatch, tmp_path):
    monkeypatch.delenv("MINHA_VAR_DOTENV_3", raising=False)
    arquivo = tmp_path / ".env"
    arquivo.write_text("# comentário\n\nMINHA_VAR_DOTENV_3=valor\n", encoding="utf-8")

    carregar_dotenv_no_ambiente(arquivo)

    assert os.environ["MINHA_VAR_DOTENV_3"] == "valor"


def test_aspas_duplas_e_simples_sao_removidas(monkeypatch, tmp_path):
    monkeypatch.delenv("MINHA_VAR_DOTENV_4", raising=False)
    monkeypatch.delenv("MINHA_VAR_DOTENV_5", raising=False)
    arquivo = tmp_path / ".env"
    arquivo.write_text(
        'MINHA_VAR_DOTENV_4="valor com aspas duplas"\nMINHA_VAR_DOTENV_5=\'valor com aspas simples\'\n',
        encoding="utf-8",
    )

    carregar_dotenv_no_ambiente(arquivo)

    assert os.environ["MINHA_VAR_DOTENV_4"] == "valor com aspas duplas"
    assert os.environ["MINHA_VAR_DOTENV_5"] == "valor com aspas simples"


def test_espaco_em_volta_do_igual_e_tolerado(monkeypatch, tmp_path):
    monkeypatch.delenv("MINHA_VAR_DOTENV_6", raising=False)
    arquivo = tmp_path / ".env"
    arquivo.write_text("MINHA_VAR_DOTENV_6 = valor-com-espaco \n", encoding="utf-8")

    carregar_dotenv_no_ambiente(arquivo)

    assert os.environ["MINHA_VAR_DOTENV_6"] == "valor-com-espaco"


def test_bom_utf8_no_inicio_do_arquivo_e_tolerado(monkeypatch, tmp_path):
    """Achado real desta frente: o Bloco de Notas grava BOM UTF-8 (`\\ufeff`) no início do
    arquivo — sem `utf-8-sig`, a primeira chave da primeira linha viria com o BOM colado, e a
    variável nunca seria encontrada por nome exato."""
    monkeypatch.delenv("MINHA_VAR_DOTENV_7", raising=False)
    arquivo = tmp_path / ".env"
    arquivo.write_bytes("MINHA_VAR_DOTENV_7=valor-apos-bom\n".encode("utf-8-sig"))

    carregar_dotenv_no_ambiente(arquivo)

    assert os.environ["MINHA_VAR_DOTENV_7"] == "valor-apos-bom"


def test_crlf_e_tolerado(monkeypatch, tmp_path):
    """Achado real: Bloco de Notas grava `\\r\\n`. `splitlines()` trata os dois finais de linha
    igual, mas o teste prova em vez de assumir."""
    monkeypatch.delenv("MINHA_VAR_DOTENV_8", raising=False)
    arquivo = tmp_path / ".env"
    arquivo.write_bytes(b"MINHA_VAR_DOTENV_8=valor-crlf\r\n")

    carregar_dotenv_no_ambiente(arquivo)

    assert os.environ["MINHA_VAR_DOTENV_8"] == "valor-crlf"


def test_arquivo_ausente_nao_faz_nada(tmp_path):
    carregar_dotenv_no_ambiente(tmp_path / "nao-existe.env")  # não levanta exceção
