"""Testes de `tela_relatorio` (issue #59, PR 1/2) — SEM importar nada da #57 PR2: as linhas chegam
já montadas (status como string pronta). Os 5 valores de status usados aqui são um fixture
PROVISÓRIO — a fonte real é `dominio.status_conversa.StatusDaConversa` (issue #57 PR 2/2, ainda não
mergeada); quando ela mergear, o PR 2/2 desta frente troca este fixture pelos valores do Enum real,
nunca reimplementa a lista aqui (LEI 11)."""

from __future__ import annotations

import re

from interfaces.painel import tela_relatorio

# Provisório — ver docstring do módulo. Fonte real: dominio.status_conversa.StatusDaConversa (#57).
_STATUS_VALORES = (
    "com_o_agente",
    "cotada",
    "aguardando_corretor",
    "em_atendimento_humano",
    "encerrada",
)


def _linha(**kw):
    base = {
        "conversation_id": "c1",
        "nome": "João da Silva Santos",
        "status_valor": _STATUS_VALORES[0],
        "status_rotulo": "Com o agente",
        "data_entrada": "2026-09-10T10:00:00",
        "pendencia": "aguardando CEP",
        "plano_cotado": None,
    }
    base.update(kw)
    return base


def test_render_mostra_uma_linha_por_conversa_com_as_5_colunas():
    linhas = [
        _linha(conversation_id="c1", nome="Ana Lima", pendencia="aguardando CEP"),
        _linha(conversation_id="c2", nome="Beto Souza", status_rotulo="Cotada", plano_cotado="Plano C"),
    ]

    html = tela_relatorio.render(linhas)

    assert "Ana Lima" in html
    assert "Beto Souza" in html
    assert "aguardando CEP" in html
    assert "Plano C" in html
    assert html.count("<tr data-status=") == 2


def test_render_campo_ausente_mostra_buraco_nunca_valor_inventado():
    linhas = [_linha(nome=None, pendencia=None, plano_cotado=None)]

    html = tela_relatorio.render(linhas)

    assert html.count("ausente na trilha") >= 2
    assert "None" not in html


def test_render_nome_nunca_aparece_por_extenso_no_csv_mas_aparece_na_tela():
    linhas = [_linha(nome="João da Silva Santos")]

    html = tela_relatorio.render(linhas)
    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "João da Silva Santos" in html
    assert "João da Silva Santos" not in csv_texto
    assert "Silva Santos" not in csv_texto
    assert "João S." in csv_texto


def test_ordenar_por_data_e_por_status():
    linhas_por_data = [
        _linha(conversation_id="c3", nome="Carlos", data_entrada="2026-09-12T09:00:00"),
        _linha(conversation_id="c1", nome="Ana", data_entrada="2026-09-10T09:00:00"),
        _linha(conversation_id="c2", nome="Beto", data_entrada="2026-09-11T09:00:00"),
    ]

    html_por_data = tela_relatorio.render(linhas_por_data, ordenar_por="data_entrada")
    assert html_por_data.index("Ana") < html_por_data.index("Beto") < html_por_data.index("Carlos")

    linhas_por_status = [
        _linha(conversation_id="c1", nome="Zeta", status_rotulo="Z"),
        _linha(conversation_id="c2", nome="Alfa", status_rotulo="A"),
    ]
    html_por_status = tela_relatorio.render(linhas_por_status, ordenar_por="status_rotulo")
    assert html_por_status.index("Alfa") < html_por_status.index("Zeta")


def test_filtro_por_status_usa_o_mesmo_vocabulario_da_5_valores():
    linhas = [_linha(conversation_id=f"c{i}", status_valor=valor) for i, valor in enumerate(_STATUS_VALORES)]

    html = tela_relatorio.render(linhas)

    for valor in _STATUS_VALORES:
        assert f'data-status="{valor}"' in html


def test_csv_neutraliza_injecao_de_formula():
    for perigoso in ("=SOMA(A1:A2)", "+1+1", "-1-1", "@SUM(A1)", "\tperigo", "\rperigo"):
        linhas = [_linha(pendencia=perigoso)]
        csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")
        assert f"'{perigoso}" in csv_texto


def test_csv_usa_ponto_e_virgula_e_bom_utf8():
    linhas = [_linha()]
    csv_bytes = tela_relatorio.gerar_csv(linhas)

    assert csv_bytes.startswith(b"\xef\xbb\xbf")
    csv_texto = csv_bytes.decode("utf-8-sig")
    assert ";" in csv_texto.splitlines()[0]
    assert "," not in csv_texto.splitlines()[0]


def test_render_sem_conversas_mostra_mensagem_e_nao_quebra():
    html = tela_relatorio.render([])

    assert "Nenhuma conversa registrada ainda." in html


def test_render_nao_tem_nenhum_elemento_editavel():
    html = tela_relatorio.render([_linha()])

    assert "<form" not in html
    assert "<input" not in html
    botoes = re.findall(r"<button[^>]*>(.*?)</button>", html, flags=re.DOTALL)
    assert botoes
    assert all("Exportar CSV" in botao for botao in botoes)
