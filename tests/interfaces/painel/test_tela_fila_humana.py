import re

from dominio.decisao import MotivoHandoff

from interfaces.painel import tela_fila_humana


def test_handoff_da_fixture_aparece_com_motivo_e_contexto(trilha_fixture):
    html = tela_fila_humana.render(trilha_fixture)

    assert "conv_b93c" in html
    assert "quote_indisponivel" in html
    assert "HB20 2021" in html


def test_botoes_de_acao_ficam_desabilitados_com_motivo(trilha_fixture):
    html = tela_fila_humana.render(trilha_fixture)

    assert "disabled" in html
    assert "requer servidor" in html


def test_regra_de_regras_a_lista_exibida_e_exatamente_a_do_enum():
    """Escopo #13, prova exigida: a lista de reason_code na tela é igual a
    `[m.value for m in MotivoHandoff]` — se alguém acrescentar um motivo ao Enum, a tela acompanha
    sem edição."""
    html = tela_fila_humana.render([])

    exibidos = set(re.findall(r'<div class="regra"><code>([^<]+)</code>', html))

    assert exibidos == {m.value for m in MotivoHandoff}


def test_sem_handoff_mostra_buraco():
    eventos = [{"evento": "mensagem_recebida", "conversation_id": "conv_x", "id": "msg_01"}]
    html = tela_fila_humana.render(eventos)
    assert "ausente na trilha" in html
