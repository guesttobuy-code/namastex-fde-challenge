"""Testes de `tela_relatorio` (issue #59) — SEM importar nada da #57 PR2: as linhas chegam já
montadas (status como string pronta). Os 5 valores de status usados aqui são um fixture
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
        "whatsapp": "+55 11 99999-8888",
        "email": "joao@example.com",
        "status_valor": _STATUS_VALORES[0],
        "status_rotulo": "Com o agente",
        "data_entrada": "2026-09-13T21:40:00",
        "pendencia": "Cotação indisponível",
        "plano_cotado": None,
        "historico": None,
    }
    base.update(kw)
    return base


def test_render_mostra_uma_linha_por_conversa_com_as_colunas():
    linhas = [
        _linha(conversation_id="c1", nome="Ana Lima"),
        _linha(conversation_id="c2", nome="Beto Souza", status_rotulo="Cotada", plano_cotado="Plano C"),
    ]

    html = tela_relatorio.render(linhas)

    assert "Ana Lima" in html
    assert "Beto Souza" in html
    assert "Plano C" in html
    assert html.count("<tr data-status=") == 2


def test_render_status_ausente_mostra_buraco_da_trilha_mas_contato_ausente_mostra_nao_informado():
    linhas = [_linha(status_rotulo=None, nome=None, whatsapp=None, email=None)]

    html = tela_relatorio.render(linhas)

    assert "ausente na trilha" in html  # status_rotulo passa por campos.campo() — dado da trilha
    assert html.count("não informado") == 4  # nome, whatsapp, email, histórico — nunca buraco
    assert "None" not in html


def test_render_nome_sempre_aparece_por_extenso_na_tela_e_no_csv():
    """Decisão do dono (comentário 5657857383): 'o csv precisa ser completo com todos os campos,
    sem exceção' — revoga a abreviação do PR 1/2. Nome NUNCA é abreviado, em lugar nenhum."""
    linhas = [_linha(nome="João da Silva Santos")]

    html = tela_relatorio.render(linhas)
    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "João da Silva Santos" in html
    assert "João da Silva Santos" in csv_texto
    assert "João S." not in csv_texto


def test_whatsapp_vira_link_wa_me_so_com_digitos_e_ddi():
    linhas = [_linha(whatsapp="+55 (11) 99999-8888")]

    html = tela_relatorio.render(linhas)

    assert 'href="https://wa.me/5511999998888"' in html
    assert 'target="_blank"' in html
    assert "+55 (11) 99999-8888" in html  # valor original ainda visível como texto do link


def test_csv_leva_whatsapp_no_formato_original_e_email():
    linhas = [_linha(whatsapp="+55 11 99999-8888", email="joao@example.com")]

    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "+55 11 99999-8888" in csv_texto
    assert "joao@example.com" in csv_texto


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


def test_data_entrada_formatada_em_br_na_tela_e_no_csv():
    linhas = [_linha(data_entrada="2026-09-13T21:40:00")]

    html = tela_relatorio.render(linhas)
    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "13/09/2026 21:40" in html
    assert "13/09/2026 21:40" in csv_texto
    assert "2026-09-13T21:40:00" not in html


def test_plano_cotado_ausente_mostra_ainda_nao_cotado_nunca_buraco():
    linhas = [_linha(plano_cotado=None)]

    html = tela_relatorio.render(linhas)
    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "ainda não cotado" in html
    assert "ainda não cotado" in csv_texto
    assert "ausente na trilha" not in html


def test_pendencia_ausente_mostra_traco_nunca_buraco():
    linhas = [_linha(pendencia=None)]

    html = tela_relatorio.render(linhas)

    assert "—" in html
    assert "ausente na trilha: pendencia" not in html


def test_montar_historico_ordena_e_identifica_remetente_por_sender_role_com_fallback():
    eventos = [
        {"evento": "mensagem_recebida", "texto": "Quero cotar", "instante": "t1"},
        {"evento": "mensagem_enviada", "texto": "Qual seu CEP?", "instante": "t2",
         "origem_do_texto": "redator_deterministico:v1"},
        {"evento": "mensagem_enviada", "texto": "Encontrei uma objeção", "instante": "t3",
         "origem_do_texto": "llm:deepseek@v2"},
        {"evento": "mensagem_enviada", "texto": "Vou verificar", "instante": "t4",
         "sender_role": "corretor", "origem_do_texto": "redator_deterministico:v1"},
        {"evento": "decisao", "tipo": "cotar", "instante": "t5"},
    ]

    historico = tela_relatorio.montar_historico(eventos)

    assert [h["remetente"] for h in historico] == ["Lead", "Robô", "IA", "Corretor"]
    assert [h["texto"] for h in historico] == ["Quero cotar", "Qual seu CEP?", "Encontrei uma objeção", "Vou verificar"]


def test_ver_conversa_expande_o_historico_completo_na_linha():
    historico = [
        {"remetente": "Lead", "texto": "Quero cotar", "instante": "t1"},
        {"remetente": "Robô", "texto": "Qual seu CEP?", "instante": "t2"},
    ]
    linhas = [_linha(historico=historico)]

    html = tela_relatorio.render(linhas)

    assert "<details>" in html
    assert "Ver conversa" in html
    assert "Quero cotar" in html
    assert "Qual seu CEP?" in html
    assert html.index("Quero cotar") < html.index("Qual seu CEP?")


def test_csv_historico_vira_uma_coluna_com_mensagens_separadas_por_pipe():
    historico = [
        {"remetente": "Lead", "texto": "Quero cotar", "instante": "t1"},
        {"remetente": "IA", "texto": "Sem objeção pendente", "instante": "t2"},
    ]
    linhas = [_linha(historico=historico)]

    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "Lead: Quero cotar | IA: Sem objeção pendente" in csv_texto


def test_csv_tem_todas_as_colunas_da_tela_mais_historico():
    linhas = [_linha()]

    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")
    cabecalho = csv_texto.splitlines()[0]

    for coluna in ("lead", "whatsapp", "email", "status", "data_entrada", "pendencia", "plano_cotado", "historico"):
        assert coluna in cabecalho


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
    historico = [{"remetente": "Lead", "texto": "oi", "instante": "t1"}]
    html = tela_relatorio.render([_linha(historico=historico)])

    assert "<form" not in html
    assert "<input" not in html
    assert "<button" not in html
    links = re.findall(r'<a[^>]*href="([^"]*)"[^>]*>', html)
    assert "relatorio.csv" in links
