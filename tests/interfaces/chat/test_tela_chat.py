"""Tela Conversas — o chat centralizado (issue #46, PR 2 de 2): `render()` só costura a casca
compartilhada (`layout.pagina`) com o fragmento estático do chat — nunca decide layout/fluxo por
conta própria (LEI 11, dono único do menu é `interfaces.painel.layout`). Espelha
`tests/interfaces/conhecimento/test_tela_edicao.py` (mesmo padrão de tela dinâmica)."""

from interfaces.chat import tela_chat


def test_render_chama_layout_pagina_com_os_parametros_certos(monkeypatch):
    capturado = {}

    def _pagina_fake(*, titulo, pagina_ativa, corpo, **_kw):
        capturado["titulo"] = titulo
        capturado["pagina_ativa"] = pagina_ativa
        capturado["corpo"] = corpo
        return "<html-fake>"

    monkeypatch.setattr("interfaces.chat.tela_chat.pagina", _pagina_fake)

    html = tela_chat.render()

    assert html == "<html-fake>"
    assert capturado["titulo"] == "Conversas"
    assert capturado["pagina_ativa"] == "/"
    assert "btn-comecar" in capturado["corpo"]  # o fragmento do chat, intacto


def test_render_le_o_fragmento_do_chat_do_disco_com_o_script_intacto():
    html = tela_chat.render()

    assert "btn-comecar" in html
    assert "/api/chat/cotar" in html
    assert "/api/chat/contato" in html
    assert "/api/chat/contratar" in html
    assert "/api/chat/responder" in html
    assert "/api/planos" in html
    assert "/docs/design/paises.json" in html


def test_render_tem_o_campo_de_objecao_de_preco_com_o_texto_exato_aprovado():
    """Issue #58: texto aprovado pelo dono para o campo de objeção depois do card de preço — não
    pode ser redigitado."""
    html = tela_chat.render()
    assert "Ficou com alguma dúvida sobre o preço? Pode escrever aqui." in html
    assert "habilitarCampoDeObjecao" in html


def test_c9_campo_de_objecao_so_e_chamado_depois_do_card_de_preco():
    """C9 do roteiro de aceite da #58: `habilitarCampoDeObjecao()` só pode ser chamado depois do
    `mostrarDoca` do card de preço em `cotar()`, nunca antes — o campo não pode aparecer antes de
    haver uma cotação para explicar."""
    html = tela_chat.render()
    posicao_card_de_preco = html.index('rotulo: "Ver outro plano"')
    posicao_primeira_chamada = html.index("habilitarCampoDeObjecao();")
    assert posicao_primeira_chamada > posicao_card_de_preco


def test_c8_erro_http_na_resposta_de_objecao_mostra_texto_fixo_nunca_fica_pendurado():
    """C8 do roteiro de aceite (bloqueante B3): um 400/500 na rota `/api/chat/responder` não pode
    deixar "Só um instante…" pendurado pra sempre — o front precisa checar `resposta.ok` antes de
    `resposta.json()` e mostrar um texto fixo, com o campo continuando disponível."""
    html = tela_chat.render()
    assert "if (!resposta.ok)" in html
    assert 'Não consegui responder agora. Toque em "Falar com um corretor"' in html


def test_render_tem_os_textos_exatos_aprovados_pela_issue_46():
    """Os textos aprovados (issue #46, B.2 e B.3.4) não podem ser redigitados — nasce vermelho se
    alguém reescrever a mensagem com outras palavras."""
    html = tela_chat.render()

    assert (
        "Seus dados são usados só para esta cotação e para um corretor falar com você, "
        "conforme a LGPD." in html
    )
    assert (
        "Que bom que você está pesquisando um seguro! A cotação e a contratação precisam ser "
        "feitas por um adulto, com 18 anos ou mais. Chame seu pai, sua mãe ou o responsável para "
        "fazer a cotação com os dados dele. Leva poucos minutos, e a gente fica esperando vocês "
        "por aqui." in html
    )


def test_render_instrumenta_as_9_perguntas_da_coleta_na_trilha():
    """Issue #51, parte 2: cada uma das 9 perguntas do fluxo guiado grava pergunta E resposta na
    trilha via POST /api/chat/mensagem, chamando `perguntar(...)`/`responder(...)` — pega quem
    remover a instrumentação de um dos passos ao editar `_corpo.html`."""
    html = tela_chat.render()

    assert "/api/chat/mensagem" in html
    assert html.count("perguntar(") >= 9
    assert html.count("responder(") >= 9


def test_render_esta_dentro_da_casca_compartilhada():
    """Achado da auditoria do PR #62 (13/09/2026): a tela tinha um `.cabecalho` extra, com texto
    de programador ("ligado ao agente real via aplicacao.servico_conversa... /api/chat/*") visível
    para o lead — o protótipo aprovado não tem esse bloco. Removido; a casca (menu + `<title>`)
    continua provada pelo `<title>`/`aria-current`, e o título visível vira o `<h2>` do hero, igual
    ao protótipo."""
    html = tela_chat.render()

    assert "<title>AutoSeguro · Conversas</title>" in html
    assert 'aria-current="page"' in html
    assert "servico_conversa" not in html  # nada de vocabulário de programador na tela do lead
    assert "Faça aqui sua cotação" in html
    assert "sem cadastro · sem compromisso" in html


# ── issue #95: GET /api/planos falhando repetidas vezes não pode deixar o lead preso em "Tentar
# de novo" pra sempre — na 2ª falha seguida, o chat encaminha pra um corretor.


def test_planos_so_encaminha_na_segunda_falha_seguida_de_api_planos():
    """1ª falha ainda oferece "Tentar de novo" (não desiste cedo demais numa oscilação de rede);
    só a 2ª falha seguida chama `encaminharPorPlanosIndisponiveis`."""
    html = tela_chat.render()
    assert 'dados._falhasPlanos = (dados._falhasPlanos || 0) + 1;' in html
    assert "if (dados._falhasPlanos >= 2) { return encaminharPorPlanosIndisponiveis(); }" in html
    assert '{ rotulo: "Tentar de novo", primaria: true, acao: () => PASSOS.plano() }' in html


def test_planos_indisponivel_chama_a_rota_nova_nunca_a_de_cotar():
    """O JS só decide QUANDO chamar — nunca o motivo nem se cota (issue #95, condição do PLANO):
    `encaminharPorPlanosIndisponiveis` chama `/api/chat/planos-indisponivel`, nunca
    `/api/chat/cotar` (que cotaria de verdade pro plano "essencial" sem o lead ter escolhido)."""
    html = tela_chat.render()
    inicio_funcao = html.index("async function encaminharPorPlanosIndisponiveis()")
    fim_funcao = html.index("\n  }", inicio_funcao)
    corpo_funcao = html[inicio_funcao:fim_funcao]
    assert "/api/chat/planos-indisponivel" in corpo_funcao
    assert "/api/chat/cotar" not in corpo_funcao


def test_planos_indisponivel_encaminhado_nao_oferece_tentar_de_novo_nem_escolha_de_plano():
    """Depois do encaminhamento, a doca só tem "Fazer nova cotação" — nunca "Tentar de novo" nem
    volta pra tela de planos (roteiro de tela da coordenação, issue #95)."""
    html = tela_chat.render()
    inicio_funcao = html.index("async function encaminharPorPlanosIndisponiveis()")
    fim_funcao = html.index("\n  }", inicio_funcao)
    corpo_funcao = html[inicio_funcao:fim_funcao]
    assert 'rotulo: "Fazer nova cotação"' in corpo_funcao
    assert "Tentar de novo" not in corpo_funcao
    assert "PASSOS.plano" not in corpo_funcao


def test_encaminhamento_planos_indisponivel_tem_trava_contra_chamada_em_andamento():
    """issue #109 (achado A1): duplo clique em "Tentar de novo" antes da 1ª chamada de
    `PASSOS.plano()` resolver dispara 2 invocações concorrentes de
    `encaminharPorPlanosIndisponiveis`, cada uma criando seu próprio balão "Um momento…" — dois
    balões de encaminhamento pra um único evento. Trava por variável de estado, checada e setada
    ANTES de qualquer efeito colateral (esconderDoca/mensagemBot), pra que a 2ª chamada concorrente
    volte sem criar um segundo balão."""
    html = tela_chat.render()
    inicio_funcao = html.index("async function encaminharPorPlanosIndisponiveis()")
    fim_funcao = html.index("\n  }", inicio_funcao)
    corpo_funcao = html[inicio_funcao:fim_funcao]
    assert "if (encaminhandoPlanosIndisponiveis) return;" in corpo_funcao
    pos_trava = corpo_funcao.index("encaminhandoPlanosIndisponiveis = true;")
    pos_esconder_doca = corpo_funcao.index("esconderDoca()")
    assert pos_trava < pos_esconder_doca


def test_contratar_nao_mostra_aviso_de_jargao_interno_pro_lead():
    """issue #109 (achado A3): a tela do LEAD mostrava um aviso de vocabulário interno da operação
    junto da mensagem de encaminhamento — nada muda no painel do corretor, só sai da tela do lead.
    Checa a frase completa, não a palavra solta: "Fila humana" sozinha também aparece legitimamente
    no menu de navegação da casca compartilhada (`layout.pagina`), que não é o alvo do achado."""
    html = tela_chat.render()
    assert "entra na Fila humana" not in html


def test_resumo_nao_duplica_o_ano_quando_o_modelo_ja_termina_com_ele():
    """issue #109 (achado A4): "corolla cross 2019" + ano 2019 virava "corolla cross 2019 2019" no
    card de resumo — só a EXIBIÇÃO muda; `dados.veiculo_modelo`/`dados.veiculo_ano` (o que é
    gravado/enviado pra `/api/chat/cotar`) continuam intocados."""
    html = tela_chat.render()
    inicio_funcao = html.index("resumo() {")
    fim_funcao = html.index("\n    },", inicio_funcao)
    corpo_funcao = html[inicio_funcao:fim_funcao]
    assert "endsWith" in corpo_funcao
    assert '"Carro", dados.veiculo_modelo + " " + dados.veiculo_ano' not in corpo_funcao
