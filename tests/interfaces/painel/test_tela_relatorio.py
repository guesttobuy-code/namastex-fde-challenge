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
    # issue #93 (polimento pós-#99): nome/whatsapp/email todos ausentes colapsam pra UM
    # "não informado" (não mais três) + o "não informado" do histórico (`historico=None`) — 2.
    assert html.count("não informado") == 2
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


def test_csv_leva_whatsapp_so_com_digitos_e_email():
    """B4 da auditoria do PR #94: `+55 11 99999-8888` no CSV virava `'+55 11 99999-8888` — a
    neutralização de fórmula (corretamente) trata `+` como perigoso, e o número com apóstrofo não
    se usa direto. A coluna `whatsapp` do CSV passa a ser só dígitos com DDI (mesma forma do
    `wa.me`, reusando `_link_whatsapp` — nunca `+`/espaço/hífen, então nunca precisa de
    neutralização nessa coluna especificamente)."""
    linhas = [_linha(whatsapp="+55 11 99999-8888", email="joao@example.com")]

    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "5511999998888" in csv_texto
    assert "+55 11 99999-8888" not in csv_texto
    assert "'5511999998888" not in csv_texto
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
    """Achado da auditoria do PR #94 (B2): a trilha grava o instante em UTC de verdade
    (`aplicacao.servico_conversa._agora_iso`, sempre com offset `+00:00`) — mostrar sem converter
    dá a hora ERRADA pro corretor no Brasil (medido: 01:04 em Brasília saía "04:04")."""
    linhas = [_linha(data_entrada="2026-09-14T04:04:19.989289+00:00")]

    html = tela_relatorio.render(linhas)
    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "14/09/2026 01:04" in html
    assert "14/09/2026 01:04" in csv_texto
    assert "2026-09-14T04:04" not in html
    assert "04:04" not in html


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


def _tentativa(classificacao="sucesso", plano_nome="Completo", premio_mensal=241.38, instante="t1"):
    evento = {"evento": "tentativa_de_cotacao", "classificacao": classificacao, "instante": instante}
    if classificacao == "sucesso":
        evento["plano_nome"] = plano_nome
        evento["premio_mensal"] = premio_mensal
    return evento


def test_plano_cotado_da_conversa_com_sucesso_mostra_nome_e_valor_br():
    eventos = [_tentativa(plano_nome="Completo", premio_mensal=241.38)]

    assert tela_relatorio.plano_cotado_da_conversa(eventos) == "Completo — R$ 241,38/mês"


def test_plano_cotado_da_conversa_so_com_falhas_mostra_ainda_nao_cotado():
    eventos = [_tentativa(classificacao="indisponivel"), _tentativa(classificacao="timeout")]

    assert tela_relatorio.plano_cotado_da_conversa(eventos) == "ainda não cotado"


def test_plano_cotado_da_conversa_sucesso_sem_plano_nome_nunca_diz_ainda_nao_cotado():
    """Trilha antiga (gravada antes do campo existir) — sucesso real, mas sem o dado estruturado.
    Não pode dizer 'ainda não cotado' (contradiria o status, que mostraria cotada/aguardando)."""
    eventos = [{"evento": "tentativa_de_cotacao", "classificacao": "sucesso", "instante": "t1"}]

    assert tela_relatorio.plano_cotado_da_conversa(eventos) == "cotado (plano não registrado nesta trilha)"


def test_plano_cotado_da_conversa_duas_cotacoes_usa_a_ultima_com_sucesso():
    eventos = [
        _tentativa(plano_nome="Essencial", premio_mensal=119.90, instante="t1"),
        _tentativa(classificacao="indisponivel", instante="t2"),
        _tentativa(plano_nome="Premium", premio_mensal=339.90, instante="t3"),
    ]

    assert tela_relatorio.plano_cotado_da_conversa(eventos) == "Premium — R$ 339,90/mês"


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


def test_ver_conversa_mostra_o_horario_da_mensagem_em_brasilia():
    """B2 da auditoria do PR #94: o horário de cada mensagem também precisa da conversão UTC→
    Brasília, não só a data de entrada."""
    historico = [{"remetente": "Lead", "texto": "Quero cotar", "instante": "2026-09-14T04:04:19.989289+00:00"}]
    linhas = [_linha(historico=historico)]

    html = tela_relatorio.render(linhas)

    assert "14/09/2026 01:04" in html
    assert "04:04" not in html


def test_mensagem_com_texto_vazio_nao_vira_buraco():
    """issue #93 (polimento pós-#99): resposta vazia (Enter num campo opcional) no histórico do
    "Ver conversa" tinha que ficar coerente com o resto do painel (Rastreio/Histórico) — não é o
    buraco de falha de gravação."""
    historico = [{"remetente": "Lead", "texto": "", "instante": "2026-09-14T04:04:19.989289+00:00"}]
    linhas = [_linha(historico=historico)]

    html = tela_relatorio.render(linhas)

    assert "ausente na trilha" not in html
    assert "(sem resposta — seguiu o padrão)" in html


def test_csv_historico_com_resposta_vazia_mostra_marcador_texto_puro():
    """O CSV é texto simples — o marcador de resposta vazia não pode carregar HTML (`<span>`)."""
    historico = [{"remetente": "Lead", "texto": "", "instante": "t1"}]
    linhas = [_linha(historico=historico)]

    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "Lead: (sem resposta — seguiu o padrão)" in csv_texto
    assert "<span" not in csv_texto


def test_lead_sem_nenhum_contato_mostra_um_nao_informado_so():
    """issue #93 (polimento pós-#99): contato nunca registrado (nome/whatsapp/email todos
    ausentes) mostrava três linhas "não informado" — vira uma só. `historico` não-vazio (em vez
    do default `None`) pra não contar o "não informado" do "Ver conversa", que é outra célula."""
    linhas = [_linha(nome=None, whatsapp=None, email=None, historico=[{"remetente": "Lead", "texto": "oi", "instante": "t1"}])]

    html = tela_relatorio.render(linhas)

    assert html.count("não informado") == 1


def test_lead_com_contato_parcial_continua_mostrando_cada_campo():
    """Contraprova: quando só ALGUM campo falta, cada linha continua aparecendo (não colapsa)."""
    linhas = [_linha(nome="Maria Exemplo", whatsapp=None, email=None, historico=[{"remetente": "Lead", "texto": "oi", "instante": "t1"}])]

    html = tela_relatorio.render(linhas)

    assert "Maria Exemplo" in html
    assert html.count("não informado") == 2


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

    for coluna in ("conversation_id", "lead", "whatsapp", "email", "status", "data_entrada", "pendencia", "plano_cotado", "historico"):
        assert coluna in cabecalho


def test_conversation_id_aparece_na_coluna_conversa_e_no_csv():
    """Ordem do dono: 'todos os campos, sem exceção' — conversation_id é a chave de rastreio, tem
    que aparecer na tela E no CSV, não só existir na linha internamente."""
    linhas = [_linha(conversation_id="conv_abc123")]

    html = tela_relatorio.render(linhas)
    csv_texto = tela_relatorio.gerar_csv(linhas).decode("utf-8-sig")

    assert "conv_abc123" in html
    linha_csv = csv_texto.splitlines()[1]
    assert "conv_abc123" in linha_csv


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


class _ContatoFake:
    def __init__(self, nome, whatsapp, email=None):
        self.nome = nome
        self.whatsapp = whatsapp
        self.email = email


def test_montar_linhas_reconstroi_status_de_trilha_sem_status_alterado():
    """R7 — trilha antiga (sem MudancaDeStatus): montar_linhas usa agrupar.estado_da_conversa, que
    já reconstrói pelo último decisao/handoff — nunca uma segunda regra aqui (LEI 11)."""
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "c1", "id": "m1", "instante": "2026-09-13T10:00:00", "texto": "oi"},
        {"evento": "decisao", "conversation_id": "c1", "id": "d1", "instante": "2026-09-13T10:00:01", "tipo": "coletar_informacao"},
    ]

    linhas = tela_relatorio.montar_linhas(eventos)

    assert len(linhas) == 1
    assert linhas[0]["status_valor"] == "com_o_agente"
    assert linhas[0]["status_rotulo"] == "Com o agente"


def test_montar_linhas_preenche_contato_a_partir_do_dict_contatos():
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "c1", "id": "m1", "instante": "2026-09-13T10:00:00", "texto": "oi"},
    ]
    contatos = {"c1": _ContatoFake(nome="Ana Lima", whatsapp="+5511988887777", email="ana@example.com")}

    linhas = tela_relatorio.montar_linhas(eventos, contatos=contatos)

    assert linhas[0]["nome"] == "Ana Lima"
    assert linhas[0]["whatsapp"] == "+5511988887777"
    assert linhas[0]["email"] == "ana@example.com"


def test_montar_linhas_sem_contato_nao_inventa_nome():
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "c1", "id": "m1", "instante": "2026-09-13T10:00:00", "texto": "oi"},
    ]

    linhas = tela_relatorio.montar_linhas(eventos, contatos={})

    assert linhas[0]["nome"] is None
    assert linhas[0]["whatsapp"] is None
    assert linhas[0]["email"] is None


def test_montar_linhas_historico_vem_de_montar_historico():
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "c1", "id": "m1", "instante": "t1", "texto": "oi"},
        {"evento": "mensagem_enviada", "conversation_id": "c1", "id": "m2", "instante": "t2", "texto": "olá",
         "origem_do_texto": "redator_deterministico:v1"},
    ]

    linhas = tela_relatorio.montar_linhas(eventos)

    assert linhas[0]["historico"] == tela_relatorio.montar_historico(eventos)


def test_montar_linhas_pendencia_vem_do_motivo_do_ultimo_handoff():
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "c1", "id": "m1", "instante": "t1", "texto": "oi"},
        {"evento": "handoff", "conversation_id": "c1", "id": "h1", "instante": "t2",
         "reason_code": "quote_indisponivel", "contexto_coletado": {}, "mensagem_ao_lead": ""},
    ]

    linhas = tela_relatorio.montar_linhas(eventos)

    assert linhas[0]["pendencia"] == "Cotação indisponível: o serviço de cotação falhou de forma persistente."


def test_montar_linhas_sem_handoff_pendencia_e_none():
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "c1", "id": "m1", "instante": "t1", "texto": "oi"},
    ]

    linhas = tela_relatorio.montar_linhas(eventos)

    assert linhas[0]["pendencia"] is None


def test_montar_linhas_data_entrada_e_o_instante_do_primeiro_evento():
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "c1", "id": "m1", "instante": "2026-09-13T09:00:00", "texto": "oi"},
        {"evento": "decisao", "conversation_id": "c1", "id": "d1", "instante": "2026-09-13T09:05:00", "tipo": "coletar_informacao"},
    ]

    linhas = tela_relatorio.montar_linhas(eventos)

    assert linhas[0]["data_entrada"] == "2026-09-13T09:00:00"


def test_montar_linhas_plano_cotado_delega_para_plano_cotado_da_conversa():
    eventos = [
        {"evento": "mensagem_recebida", "conversation_id": "c1", "id": "m1", "instante": "t1", "texto": "oi"},
        {"evento": "tentativa_de_cotacao", "conversation_id": "c1", "id": "qa1", "instante": "t2",
         "classificacao": "sucesso", "plano_nome": "Completo", "premio_mensal": 241.38},
    ]

    linhas = tela_relatorio.montar_linhas(eventos)

    assert linhas[0]["plano_cotado"] == "Completo — R$ 241,38/mês"
