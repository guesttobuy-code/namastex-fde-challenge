from interfaces.painel import tela_conversas


def test_mensagem_com_html_e_escapada(trilha_fixture):
    html = tela_conversas.render(trilha_fixture)
    assert "<script>" not in html


def test_conversas_da_fixture_aparecem_com_estado(trilha_fixture):
    html = tela_conversas.render(trilha_fixture)
    assert "conv_a41f" in html
    assert "conv_b93c" in html
    assert "cotada" in html
    assert "handoff" in html


def test_sem_eventos_mostra_buraco():
    html = tela_conversas.render([])
    assert "ausente na trilha" in html
