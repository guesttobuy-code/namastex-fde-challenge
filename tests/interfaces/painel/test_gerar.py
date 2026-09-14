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
    """Nenhum teste de geração abre socket real (achado da coordenação, 2026-09-12) — quem chama
    `GET /planos` de verdade é `painel/gerar.py` (issue #51/#55: `tela_regras` não importa `infra`
    mais, então o mock migrou para cá)."""
    monkeypatch.setattr("interfaces.painel.gerar.buscar_planos", lambda base_url: None)


def test_gerar_paineis_escreve_as_cinco_telas_e_o_csv_do_relatorio(tmp_path, trilha_fixture, conftest_caminho_trilha):
    """`handoffs.html` (Fila humana) não é mais gerado (issue #57, P14, PR 2 de 2, pré-auditoria do
    PR #87) — o menu aponta pro Histórico já filtrado, e o catálogo de motivos migrou para
    `regras.html`. `relatorio.html`/`relatorio.csv` entram nesta frente (issue #59, PR 2/2).
    `avaliacao.html` some (issue #115, decisão do dono — a tela não tinha função nesta entrega). O
    nome do teste não decora número: se o conjunto mudar de novo, o teste é quem afirma qual é."""
    escritos = gerar_paineis(conftest_caminho_trilha, tmp_path)

    nomes = {c.name for c in escritos}
    assert nomes == {
        "index.html", "rastreio.html", "cotacoes.html", "regras.html",
        "relatorio.html", "relatorio.csv",
    }
    assert not (tmp_path / "avaliacao.html").exists()
    for caminho in escritos:
        assert caminho.exists()
        if caminho.suffix == ".html":
            assert caminho.read_text(encoding="utf-8").startswith("<!doctype html>")
        else:
            assert caminho.read_bytes().startswith(b"\xef\xbb\xbf")  # BOM do CSV


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


# catraca-reduz-de-proposito: test_gerar_paineis_com_repositorio_contato_leva_nome_e_whatsapp_para_
# a_fila_humana removido (issue #57, P14, PR 2 de 2, pré-auditoria do PR #87) — `handoffs.html` não
# existe mais; a mesma asserção (nome/WhatsApp aparecem pra `conv_b93c`) já é coberta pelo teste
# abaixo, que checa `index.html` (Histórico), o único lugar que agora recebe `contatos`.


def test_gerar_paineis_com_repositorio_contato_leva_nome_e_whatsapp_para_o_historico_tambem(
    tmp_path, trilha_fixture, conftest_caminho_trilha
):
    """S12 do roteiro de aceite (issue #57, PR 2 de 2): o contato do lead que a Fila humana já
    mostrava aparece agora TAMBÉM no Histórico de atendimentos (`index.html`), na conversa
    `conv_b93c` (a que tem `handoff`) — não só em `handoffs.html`."""
    repositorio = RepositorioDeContatoMemoria()
    repositorio.salvar("conv_b93c", ContatoLead(nome="Ursula Souza", whatsapp="+55 21 97224-2584"))

    escritos = gerar_paineis(conftest_caminho_trilha, tmp_path, repositorio_contato=repositorio)

    index_html = next(c for c in escritos if c.name == "index.html").read_text(encoding="utf-8")
    assert "Ursula Souza" in index_html
    assert "+55 21 97224-2584" in index_html


def test_gerar_paineis_sem_repositorio_contato_continua_funcionando_igual(
    tmp_path, trilha_fixture, conftest_caminho_trilha
):
    """`repositorio_contato=None` (default) não muda nada do comportamento de hoje — nenhum
    chamador existente (Dockerfile, `interfaces.servidor` antes desta frente) precisa mudar."""
    escritos = gerar_paineis(conftest_caminho_trilha, tmp_path)

    index_html = next(c for c in escritos if c.name == "index.html").read_text(encoding="utf-8")
    assert "conv_b93c" in index_html
    assert "não informado" in index_html


def test_main_com_argumentos_errados_devolve_2(capsys):
    from interfaces.painel.gerar import main

    codigo = main([])

    assert codigo == 2
    assert "uso:" in capsys.readouterr().err


def test_gerar_paineis_busca_planos_e_repassa_para_tela_regras(
    tmp_path, monkeypatch, trilha_fixture, conftest_caminho_trilha
):
    """issue #51/#55: `gerar_paineis` é a raiz de composição que busca `GET /planos` (via
    `infra.planos_http.buscar_planos`) e repassa pronto para `tela_regras.render` — a tela nunca
    importa `infra` direto. Mock em `interfaces.painel.gerar.buscar_planos` (não mais em
    `tela_regras.buscar_planos`, que deixou de existir)."""
    fake = {
        "moeda": "BRL",
        "planos": [{"id": "essencial", "nome": "Plano Fake E2E", "base_mensal": 99.9, "franquia": 1000, "coberturas": ["colisao"]}],
        "regras": {"faixa_etaria": [], "idade_veiculo": [], "regiao_cep": {"multiplicador": 1.0}},
    }
    monkeypatch.setattr("interfaces.painel.gerar.buscar_planos", lambda base_url: fake)

    escritos = gerar_paineis(conftest_caminho_trilha, tmp_path)

    caminho_regras = next(c for c in escritos if c.name == "regras.html")
    assert "Plano Fake E2E" in caminho_regras.read_text(encoding="utf-8")
