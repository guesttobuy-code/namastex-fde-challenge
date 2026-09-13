"""Orquestração do gerador e a varredura de PII exigida pelo escopo #13 (regra "reaproveite os
padrões do redator_pii da F4 — não escreva regex nova de PII")."""

from __future__ import annotations

from pathlib import Path

import pytest

from dominio.contato_lead import ContatoLead
from dominio.redator_pii import _PADROES
from infra.repositorio_contato_json import RepositorioDeContatoMemoria
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


def test_gerar_paineis_aceita_uma_pasta_com_varios_trilha_star_jsonl(tmp_path, trilha_fixture, conftest_caminho_trilha):
    """`examples/` do desafio guarda uma trilha por conversa (`trilha_<id>.jsonl`) — o painel real
    tem que juntar todas, não só a primeira. Um arquivo `.log` (irmão gerado pela CLI) no meio da
    pasta não pode ser lido como trilha."""
    pasta = tmp_path / "trilhas"
    pasta.mkdir()
    (pasta / "trilha_conv-a.jsonl").write_bytes(Path(conftest_caminho_trilha).read_bytes())
    (pasta / "trilha_conv-b.jsonl").write_text(
        '{"evento": "mensagem_recebida", "conversation_id": "conv_outra", "id": "msg_01", "instante": "x", "texto": "oi"}\n',
        encoding="utf-8",
    )
    (pasta / "trilha_conv-a.log").write_text("nao e jsonl, e o log estruturado irmao", encoding="utf-8")

    escritos = gerar_paineis(pasta, tmp_path / "saida")

    rastreio = next(c for c in escritos if c.name == "rastreio.html").read_text(encoding="utf-8")
    assert "conv_a41f" in rastreio  # veio da trilha_fixture (copiada para conv-a.jsonl)
    assert "conv_outra" in rastreio  # veio de trilha_conv-b.jsonl


def test_gerar_paineis_com_repositorio_contato_leva_nome_e_whatsapp_para_a_fila_humana(
    tmp_path, trilha_fixture, conftest_caminho_trilha
):
    """Issue #46, PR 2 de 2, ADR-0005: `repositorio_contato` é aditivo — passado, `handoffs.html`
    ganha nome/WhatsApp do lead da conversa `conv_b93c` (a única com `handoff` na fixture)."""
    repositorio = RepositorioDeContatoMemoria()
    repositorio.salvar("conv_b93c", ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584"))

    escritos = gerar_paineis(conftest_caminho_trilha, tmp_path, repositorio_contato=repositorio)

    handoffs_html = next(c for c in escritos if c.name == "handoffs.html").read_text(encoding="utf-8")
    assert "Ursula Souza" in handoffs_html
    assert "+55 21 97224-2584" in handoffs_html


def test_gerar_paineis_sem_repositorio_contato_continua_funcionando_igual(
    tmp_path, trilha_fixture, conftest_caminho_trilha
):
    """`repositorio_contato=None` (default) não muda nada do comportamento de hoje — nenhum
    chamador existente (Dockerfile, `interfaces.servidor` antes desta frente) precisa mudar."""
    escritos = gerar_paineis(conftest_caminho_trilha, tmp_path)

    handoffs_html = next(c for c in escritos if c.name == "handoffs.html").read_text(encoding="utf-8")
    assert "conv_b93c" in handoffs_html
    assert "não informado" in handoffs_html


def test_main_com_argumentos_errados_devolve_2(capsys):
    from interfaces.painel.gerar import main

    codigo = main([])

    assert codigo == 2
    assert "uso:" in capsys.readouterr().err
