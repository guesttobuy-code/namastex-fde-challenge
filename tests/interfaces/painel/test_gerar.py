"""Orquestração do gerador e a varredura de PII exigida pelo escopo #13 (regra "reaproveite os
padrões do redator_pii da F4 — não escreva regex nova de PII")."""

from __future__ import annotations

import pytest

from dominio.redator_pii import _PADROES
from interfaces.painel.gerar import gerar_paineis


@pytest.fixture(autouse=True)
def _sem_rede_real(monkeypatch):
    """Nenhum teste de geração abre socket real (achado da coordenação, 2026-09-12) — a tela Regras
    chama `GET /planos` de verdade só na geração real, nunca em teste."""
    monkeypatch.setattr("interfaces.painel.tela_regras.buscar_planos", lambda base_url: None)


def test_gerar_paineis_escreve_as_seis_telas(tmp_path, trilha_fixture, conftest_caminho_trilha):
    escritos = gerar_paineis(conftest_caminho_trilha, tmp_path)

    nomes = {c.name for c in escritos}
    assert nomes == {"index.html", "rastreio.html", "cotacoes.html", "handoffs.html", "regras.html", "avaliacao.html"}
    for caminho in escritos:
        assert caminho.exists()
        assert caminho.read_text(encoding="utf-8").startswith("<!doctype html>")


def test_html_gerado_nao_tem_pii_reconhecivel_pelos_padroes_do_redator(tmp_path, trilha_fixture, conftest_caminho_trilha):
    """A fixture não injeta PII de propósito (CEP/telefone/CPF não aparecem nos textos), então esta
    varredura afirma o caso feliz: gerar não introduz PII por conta própria (ex.: vazando id de
    sessão em formato de CPF). A defesa de fundo contra PII que a TRILHA já contém é o redator na
    fronteira de escrita (aplicacao.ServicoDeTrilha, F4) — esta tela só lê o que já foi redigido.
    """
    escritos = gerar_paineis(conftest_caminho_trilha, tmp_path)

    for caminho in escritos:
        html = caminho.read_text(encoding="utf-8")
        for padrao in _PADROES:
            achado = padrao.search(html)
            assert achado is None, f"{caminho.name}: padrão de PII {padrao.pattern!r} casou com {achado.group()!r}"


def test_main_com_argumentos_errados_devolve_2(capsys):
    from interfaces.painel.gerar import main

    codigo = main([])

    assert codigo == 2
    assert "uso:" in capsys.readouterr().err
