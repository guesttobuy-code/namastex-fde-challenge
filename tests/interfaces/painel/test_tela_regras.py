"""Nenhum teste aqui abre socket real (achado da coordenação, 2026-09-12) — `buscar_planos` é
sempre mockado; a chamada real ao quote-service só acontece na geração de verdade, e ela já tem
timeout explícito (`quote_client.py`, provado em `test_quote_client.py`)."""

import re

from dominio.decisao import MotivoHandoff

from interfaces.painel import tela_regras


def test_sem_quote_service_de_pe_mostra_buraco_nos_planos(monkeypatch):
    monkeypatch.setattr("interfaces.painel.tela_regras.buscar_planos", lambda base_url: None)

    html = tela_regras.render()

    assert "GET /planos" in html
    assert "ausente na trilha" in html


def test_regra_de_regras_motivos_de_handoff_e_exatamente_o_enum(monkeypatch):
    monkeypatch.setattr("interfaces.painel.tela_regras.buscar_planos", lambda base_url: None)

    html = tela_regras.render()

    exibidos = set(re.findall(r'<div class="regra"><code>([^<]+)</code></div>', html))

    assert exibidos == {m.value for m in MotivoHandoff}


def test_retry_le_as_constantes_reais_de_cliente_quote(monkeypatch):
    """Escopo #13, regra 3: nenhum número de retry é redigitado — a tela lê direto de
    `infra.cliente_quote` (PR #35, mergeado)."""
    from infra.cliente_quote import (
        ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS,
        MAX_TENTATIVAS,
        ORCAMENTO_TOTAL_SEGUNDOS,
        TIMEOUT_POR_TENTATIVA_SEGUNDOS,
    )

    monkeypatch.setattr("interfaces.painel.tela_regras.buscar_planos", lambda base_url: None)

    html = tela_regras.render()

    assert f"{ORCAMENTO_TOTAL_SEGUNDOS:.0f} s" in html
    assert f"{TIMEOUT_POR_TENTATIVA_SEGUNDOS:.0f} s" in html
    assert str(MAX_TENTATIVAS) in html
    for espera in ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS:
        assert f"{espera:.1f}s" in html


def test_planos_reais_quando_o_servico_responde(monkeypatch):
    fake = {
        "moeda": "BRL",
        "planos": [{"id": "essencial", "nome": "Essencial", "base_mensal": 119.9, "franquia": 4500, "coberturas": ["colisao"]}],
        "regras": {
            "faixa_etaria": [
                {"idade_min": 18, "idade_max": 24, "multiplicador": 1.6},
                {"idade_min": 25, "idade_max": 29, "multiplicador": 1.25},
            ],
            "idade_veiculo": [{"anos_min": 0, "anos_max": 5, "multiplicador": 1.0}],
            "regiao_cep": {"multiplicador": 1.3},
        },
    }
    monkeypatch.setattr("interfaces.painel.tela_regras.buscar_planos", lambda base_url: fake)

    html = tela_regras.render()

    assert "Essencial" in html
    assert "119.9" in html
    assert html.count("Idade do condutor") == 1  # rótulo só na primeira faixa do grupo
