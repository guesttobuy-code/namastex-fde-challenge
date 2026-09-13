"""Nenhum teste aqui abre socket real (achado da coordenação, 2026-09-12) — `render` recebe
`planos` pronto por parâmetro (issue #51/#55: `tela_regras` deixou de importar `infra` direto); a
chamada real a `GET /planos` só acontece em `painel/gerar.py`, na geração de verdade."""

import re

from dominio.decisao import MotivoHandoff

from interfaces.painel import tela_regras


def test_sem_quote_service_de_pe_mostra_buraco_nos_planos():
    html = tela_regras.render(planos=None)

    assert "GET /planos" in html
    assert "ausente na trilha" in html


def test_regra_de_regras_motivos_de_handoff_e_exatamente_o_enum():
    html = tela_regras.render(planos=None)

    exibidos = set(re.findall(r'<div class="regra"><code>([^<]+)</code></div>', html))

    assert exibidos == {m.value for m in MotivoHandoff}


def test_retry_le_as_constantes_reais_de_cliente_quote():
    """Escopo #13, regra 3: nenhum número de retry é redigitado — o teste importa as constantes
    reais de `infra.cliente_quote` (PR #35, mergeado) e as PASSA para `render`, que não lê mais
    nada sozinha (issue #51/#55: `tela_regras` não importa `infra`)."""
    from infra.cliente_quote import (
        ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS,
        MAX_TENTATIVAS,
        ORCAMENTO_TOTAL_SEGUNDOS,
        TIMEOUT_POR_TENTATIVA_SEGUNDOS,
    )

    html = tela_regras.render(
        planos=None,
        orcamento_total_segundos=ORCAMENTO_TOTAL_SEGUNDOS,
        timeout_por_tentativa_segundos=TIMEOUT_POR_TENTATIVA_SEGUNDOS,
        max_tentativas=MAX_TENTATIVAS,
        esperas_entre_tentativas_segundos=ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS,
    )

    assert f"{ORCAMENTO_TOTAL_SEGUNDOS:.0f} s" in html
    assert f"{TIMEOUT_POR_TENTATIVA_SEGUNDOS:.0f} s" in html
    assert str(MAX_TENTATIVAS) in html
    for espera in ESPERAS_ENTRE_TENTATIVAS_SEGUNDOS:
        assert f"{espera:.1f}s" in html


def test_planos_reais_quando_o_servico_responde():
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

    html = tela_regras.render(planos=fake)

    assert "Essencial" in html
    assert "119.9" in html
    assert html.count("Idade do condutor") == 1  # rótulo só na primeira faixa do grupo
