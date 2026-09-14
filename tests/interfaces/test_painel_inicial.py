"""`aquecer_painel_em_segundo_plano` (issue #89, R1 da auditoria fria): sem rede pra `quote-api`
no build, `/painel/regras.html` mostrava o buraco de `GET /planos` até a 1a cotação/handoff
regenerar o painel em runtime. Vermelho antes: o módulo não existia."""
from __future__ import annotations

import time

from interfaces.painel_inicial import aquecer_painel_em_segundo_plano


def test_gera_o_painel_uma_vez_na_primeira_resposta_nao_nula(tmp_path):
    chamadas = {"buscar_planos": 0}
    respostas = [None, None, {"planos": [{"id": "completo"}]}]

    def buscar_planos_falso():
        chamadas["buscar_planos"] += 1
        return respostas[chamadas["buscar_planos"] - 1]

    trilha_dir = tmp_path / "trilha"
    painel_dir = tmp_path / "painel-saida"
    trilha_dir.mkdir()

    thread = aquecer_painel_em_segundo_plano(
        buscar_planos=buscar_planos_falso, trilha_dir=trilha_dir, painel_dir=painel_dir,
        max_tentativas=5, espera_segundos=0.01,
    )
    thread.join(timeout=2)

    assert chamadas["buscar_planos"] == 3
    assert (painel_dir / "index.html").is_file(), "gerar_paineis devia ter rodado depois da 3a tentativa"


def test_esgota_as_tentativas_sem_excecao_e_sem_gerar_nada_quando_planos_nunca_responde(tmp_path):
    chamadas = {"buscar_planos": 0}

    def buscar_planos_sempre_none():
        chamadas["buscar_planos"] += 1
        return None

    trilha_dir = tmp_path / "trilha"
    painel_dir = tmp_path / "painel-saida"
    trilha_dir.mkdir()

    thread = aquecer_painel_em_segundo_plano(
        buscar_planos=buscar_planos_sempre_none, trilha_dir=trilha_dir, painel_dir=painel_dir,
        max_tentativas=4, espera_segundos=0.01,
    )
    thread.join(timeout=2)

    assert chamadas["buscar_planos"] == 4
    assert not painel_dir.exists(), "sem nenhuma resposta da /quote, gerar_paineis nunca devia rodar"


def test_devolve_o_controle_na_hora_porque_e_thread(tmp_path):
    def buscar_planos_lento():
        time.sleep(5)
        return {"planos": []}

    trilha_dir = tmp_path / "trilha"
    painel_dir = tmp_path / "painel-saida"
    trilha_dir.mkdir()

    inicio = time.monotonic()
    thread = aquecer_painel_em_segundo_plano(
        buscar_planos=buscar_planos_lento, trilha_dir=trilha_dir, painel_dir=painel_dir,
        max_tentativas=1, espera_segundos=0.01,
    )
    duracao = time.monotonic() - inicio

    assert duracao < 1.0, "a função não pode esperar a thread terminar — isso atrasaria o boot"
    assert thread.daemon is True
    assert thread.is_alive()
