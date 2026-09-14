"""Vermelho-antes do caso de uso da IA respondendo objeção de preço (issue #58, frente
`ia-responde`): `montar_e_responder` monta contexto sem PII, valida o marcador antes de mostrar ao
lead, tenta de novo se a primeira resposta do LLM reprovar, e encaminha ao corretor (nunca inventa
número) quando não há ficha publicada ou as tentativas se esgotam. `processar_mensagem_livre`
classifica a mensagem livre e grava a trilha."""

from __future__ import annotations

from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.decisao import MotivoHandoff
from dominio.estado_conversa import EstadoDaConversa
from dominio.preco_cotado import PrecoCotado
from dominio.saida_de_linguagem import SaidaDeLinguagem

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from aplicacao.servico_resposta_orientada import (
    montar_contexto,
    montar_e_responder,
    processar_mensagem_livre,
)
from aplicacao.servico_trilha import ServicoDeTrilha
from infra.repositorio_conhecimento_json import RepositorioDeConhecimentoMemoria
from infra.trilha_jsonl import RepositorioDeTrilhaMemoria

TEXTO_ENCAMINHAMENTO = "Logo um corretor vai entrar em contato para te dar todo o suporte."
TEXTO_FORA_DE_ESCOPO = (
    'Por aqui eu consigo tirar dúvidas sobre o preço desta cotação. Para outras perguntas, toque '
    'em "Falar com um corretor".'
)


class _PortalDeLinguagemComIntent:
    """Dublê que devolve sempre o mesmo `intent` — para provar a classificação e o desvio."""

    def __init__(self, intent: str | None) -> None:
        self._intent = intent
        self.textos_recebidos: list[str] = []

    def extrair(self, texto_mascarado: str, estado_atual: EstadoDaConversa) -> SaidaDeLinguagem:
        self.textos_recebidos.append(texto_mascarado)
        return SaidaDeLinguagem(intent=self._intent)

    @property
    def origem_do_texto(self) -> str:
        return "extrator_fake:v1"


class _PortalIndisponivel:
    """Dublê que sempre devolve `None` — rede fora do ar, timeout, sem chave, ou esquema que a
    porta não conseguiu interpretar (mesmo padrão de `dominio.resultado_cotacao.ResultadoDaCotacao`:
    falha é um valor, nunca uma exceção cruzando de `infra` para `aplicacao`)."""

    def responder(self, contexto: dict) -> str | None:
        return None

    @property
    def origem_do_texto(self) -> str:
        return "llm_resposta:fake@v1"


class _PortalFixo:
    """Dublê que sempre devolve o mesmo texto — para os testes que não precisam variar por
    tentativa."""

    def __init__(self, texto: str) -> None:
        self._texto = texto
        self.contextos_recebidos: list[dict] = []

    def responder(self, contexto: dict) -> str:
        self.contextos_recebidos.append(contexto)
        return self._texto

    @property
    def origem_do_texto(self) -> str:
        return "llm_resposta:fake@v1"


class _PortalPorTentativa:
    """Dublê que devolve um texto diferente a cada chamada — para provar a retentativa."""

    def __init__(self, textos: list[str]) -> None:
        self._textos = list(textos)
        self.chamadas = 0

    def responder(self, contexto: dict) -> str:
        texto = self._textos[self.chamadas]
        self.chamadas += 1
        return texto

    @property
    def origem_do_texto(self) -> str:
        return "llm_resposta:fake@v1"


def _preco(**kw) -> PrecoCotado:
    base = dict(
        quote_attempt_id="qa_1",
        conversation_id="conv-1",
        plano_id="completo",
        plano_nome="Completo",
        premio_mensal=241.38,
        franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"),
        moeda="BRL",
    )
    base.update(kw)
    return PrecoCotado(**base)


def _estado(**kw) -> EstadoDaConversa:
    base = dict(conversation_id="conv-1")
    base.update(kw)
    return EstadoDaConversa(**base)


def _servico_com_ficha_publicada() -> ServicoDeConhecimento:
    repositorio = RepositorioDeConhecimentoMemoria()
    repositorio.salvar_objecao(
        "preco-alto",
        {
            "id": "preco-alto",
            "nome": "Preço tá salgado",
            "frases_do_lead": ["o preço tá salgado"],
            "resposta_orientada": "Posso ajustar a franquia para {{franquia}}.",
            "argumentos_permitidos": ["franquia_por_plano"],
            "tentativas_antes_do_corretor": 2,
            "status": "publicado",
            "versao": 1,
            "atualizado_em": "2026-09-13T12:00:00+00:00",
        },
    )
    repositorio.salvar_objecao(
        "rascunho-nao-publicado",
        {
            "id": "rascunho-nao-publicado",
            "nome": "Rascunho",
            "frases_do_lead": [],
            "resposta_orientada": "",
            "argumentos_permitidos": [],
            "tentativas_antes_do_corretor": None,
            "status": "rascunho",
            "versao": 0,
            "atualizado_em": "",
        },
    )
    return ServicoDeConhecimento(repositorio)


def _servico_sem_ficha_publicada() -> ServicoDeConhecimento:
    return ServicoDeConhecimento(RepositorioDeConhecimentoMemoria())


# ── montar_contexto: sem PII, só fichas publicadas ──────────────────────────


def test_montar_contexto_inclui_ficha_da_cotacao():
    contexto = montar_contexto(
        _preco(), [], _servico_com_ficha_publicada(), ConfiguracaoComercial()
    )
    assert contexto["ficha_da_cotacao"]["plano_nome"] == "Completo"
    assert contexto["ficha_da_cotacao"]["premio_mensal"] == 241.38


def test_montar_contexto_so_traz_fichas_publicadas_nunca_rascunho():
    contexto = montar_contexto(
        _preco(), [], _servico_com_ficha_publicada(), ConfiguracaoComercial()
    )
    ids = [f["id"] for f in contexto["fichas_de_objecao"]]
    assert ids == ["preco-alto"]


def test_montar_contexto_inclui_texto_do_lead():
    contexto = montar_contexto(
        _preco(), [], _servico_com_ficha_publicada(), ConfiguracaoComercial(),
        texto_do_lead="a franquia tá alta",
    )
    assert contexto["texto_do_lead"] == "a franquia tá alta"


def test_montar_contexto_nunca_contem_nome_whatsapp_ou_email():
    """Mutação (se alguém um dia passar EstadoDaConversa inteiro para dentro do contexto): o
    contexto serializado como string não pode conter esses termos de jeito nenhum."""
    contexto = montar_contexto(
        _preco(), [], _servico_com_ficha_publicada(), ConfiguracaoComercial()
    )
    como_texto = str(contexto)
    for termo_proibido in ("Ursula", "97224-2584", "@example.com", "whatsapp", "email"):
        assert termo_proibido not in como_texto


# ── montar_e_responder: valida, preenche, tenta de novo, encaminha ──────────


def test_resposta_valida_e_preenchida_com_o_valor_real():
    portal = _PortalFixo("No plano Completo, a franquia é {{franquia}}.")
    texto, origem, motivo, dados_usados = montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == "No plano Completo, a franquia é R$ 3.000,00."
    assert origem == "llm_resposta:fake@v1"
    assert motivo is None
    assert dados_usados == ("ficha:preco-alto@1",)


def test_resposta_com_franquia_de_outro_plano_resolve_pelo_catalogo():
    portal = _PortalFixo("O plano Essencial sai com franquia {{franquia_essencial}}.")
    texto, _, motivo, _ = montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[{"id": "essencial", "nome": "Essencial", "franquia": 4500}],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == "O plano Essencial sai com franquia R$ 4.500,00."
    assert motivo is None


def test_digito_fora_de_marcador_na_primeira_tentativa_tenta_de_novo_e_aceita_a_segunda():
    portal = _PortalPorTentativa(
        [
            "Sai por 241 reais.",  # número solto — reprovado
            "Sai por {{premio_mensal}}.",  # válido
        ]
    )
    texto, _, motivo, _ = montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == "Sai por R$ 241,38."
    assert portal.chamadas == 2
    assert motivo is None


def test_duas_tentativas_reprovadas_encaminha_ao_corretor_nunca_numero_fabricado():
    portal = _PortalPorTentativa(["Sai por 241 reais.", "Sai por 300 reais também."])
    texto, origem, motivo, dados_usados = montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == TEXTO_ENCAMINHAMENTO
    assert motivo == MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL
    assert portal.chamadas == 2
    assert dados_usados == ("ficha:preco-alto@1",)  # o que estava no contexto, mesmo sem sucesso


def test_frase_proibida_na_primeira_tentativa_tenta_de_novo_e_aceita_a_segunda():
    """Bloqueante B4 do veredito da auditoria do PR #75: a ficha da demonstração ("Posso ajustar a
    franquia para {{franquia}}") é exatamente o antiexemplo — marcador válido, mas promessa que a
    IA nunca pode fazer por conta própria. Reprovado na validação de frase proibida, igual ao
    dígito solto: tenta de novo, aceita a segunda se ela vier limpa."""
    portal = _PortalPorTentativa(
        [
            "Posso ajustar a franquia para {{franquia}} se você fechar hoje.",  # promessa — reprovado
            "No plano Completo, a franquia é {{franquia}}.",  # sem promessa — válido
        ]
    )
    texto, _, motivo, _ = montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == "No plano Completo, a franquia é R$ 3.000,00."
    assert portal.chamadas == 2
    assert motivo is None


def test_frase_proibida_nas_duas_tentativas_encaminha_nunca_promete_desconto():
    portal = _PortalPorTentativa(
        [
            "Posso ajustar a franquia para {{franquia}}.",
            "Consigo um desconto especial pra você.",
        ]
    )
    texto, _, motivo, _ = montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == TEXTO_ENCAMINHAMENTO
    assert "ajustar" not in texto and "desconto" not in texto
    assert motivo == MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL


def test_marcador_reconhecido_mas_sem_valor_para_este_preco_encaminha():
    """`carencia_dias` está no vocabulário base (MARCADORES_BASE) — passa a validação de FORMA —
    mas só tem valor em `valores` quando `preco.carencia` existe. Um `PrecoCotado` sem carência
    (este `_preco()`, que não define `carencia`) expõe o buraco: marcador válido, sem valor.
    `preencher_marcadores` recusa, e as 2 tentativas esgotam — nunca `{{carencia_dias}}` cru
    escapa para o texto que o lead lê."""
    portal = _PortalFixo("A carência é de {{carencia_dias}} dias.")
    texto, _, motivo, _ = montar_e_responder(
        portal=portal,
        preco=_preco(),  # carencia=None por padrão
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert "{{" not in texto
    assert texto == TEXTO_ENCAMINHAMENTO
    assert motivo == MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL


def test_porta_indisponivel_rede_timeout_ou_sem_chave_encaminha_sem_travar():
    texto, origem, motivo, _ = montar_e_responder(
        portal=_PortalIndisponivel(),
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == TEXTO_ENCAMINHAMENTO
    assert motivo == MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL


def test_sem_ficha_publicada_encaminha_sem_chamar_o_llm():
    """Decisão da coordenação: sem base de conhecimento para basear a resposta, nem vale a pena
    gastar uma chamada de LLM — encaminha direto."""
    portal = _PortalFixo("nunca deveria ser chamado")
    texto, _, motivo, dados_usados = montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_sem_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == TEXTO_ENCAMINHAMENTO
    assert motivo == MotivoHandoff.RESPOSTA_ORIENTADA_INDISPONIVEL
    assert portal.contextos_recebidos == []
    assert dados_usados == ()


def test_texto_do_lead_chega_no_contexto_da_resposta():
    """Bloqueante B2 do veredito da auditoria do PR #75: sem o texto do lead no contexto, o LLM
    não tinha como escolher a ficha certa — media 4 de 4 respostas idênticas, sempre a primeira
    publicada, mesmo com a ficha certa disponível."""
    portal = _PortalFixo("No plano Completo, a franquia é {{franquia}}.")
    montar_e_responder(
        portal=portal,
        preco=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        texto_do_lead="a franquia tá alta",
    )
    assert portal.contextos_recebidos[0]["texto_do_lead"] == "a franquia tá alta"


# ── processar_mensagem_livre: classifica, desvia, grava a trilha ───────────


def test_objecao_de_preco_com_cotacao_existente_desvia_para_resposta_orientada():
    portal_linguagem = _PortalDeLinguagemComIntent("objecao_de_preco")
    texto, origem, intencao = processar_mensagem_livre(
        portal_de_linguagem=portal_linguagem,
        portal_de_resposta=_PortalFixo("No plano Completo, a franquia é {{franquia}}."),
        texto_bruto="achei caro esse preço",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == "No plano Completo, a franquia é R$ 3.000,00."
    assert origem == "llm_resposta:fake@v1"
    assert intencao.value == "objecao_de_preco"


def test_outra_intencao_devolve_texto_fixo_de_fora_de_escopo_nunca_fica_mudo():
    """Bloqueante B3 do veredito da auditoria do PR #75: antes devolvia `None` e o lead ficava sem
    NENHUMA resposta na tela (sempre acontecia sem chave, já que o extrator determinístico devolve
    `informar_dados` fixo). Este campo é dedicado a dúvida de preço — "não responder nada" nunca
    foi a opção certa."""
    portal_linguagem = _PortalDeLinguagemComIntent("informar_dados")
    portal_resposta = _PortalFixo("não deveria ser chamado")
    texto, origem, intencao = processar_mensagem_livre(
        portal_de_linguagem=portal_linguagem,
        portal_de_resposta=portal_resposta,
        texto_bruto="tenho 35 anos",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == TEXTO_FORA_DE_ESCOPO
    assert origem == "texto_fixo:fora_do_escopo_resposta_orientada"
    assert intencao.value == "informar_dados"
    assert portal_resposta.contextos_recebidos == []  # não gasta LLM à toa


def test_objecao_de_preco_sem_cotacao_ainda_devolve_texto_fixo_de_fora_de_escopo():
    """Sem `PrecoCotado`, não há valor real pra preencher marcador nenhum — melhor não chamar o
    LLM do que arriscar um texto sem número, ou pior, inventar um. Mas o lead ainda precisa de
    alguma resposta (B3), não silêncio."""
    portal_linguagem = _PortalDeLinguagemComIntent("objecao_de_preco")
    portal_resposta = _PortalFixo("não deveria ser chamado")
    texto, origem, intencao = processar_mensagem_livre(
        portal_de_linguagem=portal_linguagem,
        portal_de_resposta=portal_resposta,
        texto_bruto="achei caro",
        estado=_estado(),
        preco_atual=None,
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert texto == TEXTO_FORA_DE_ESCOPO
    assert intencao.value == "objecao_de_preco"
    assert portal_resposta.contextos_recebidos == []


def test_texto_bruto_nunca_chega_cru_ao_portal_de_linguagem_cep_e_mascarado():
    """Mesma disciplina de `extrair_dados_da_mensagem`: o texto que chega ao portal já passou por
    `redigir_texto`."""
    portal_linguagem = _PortalDeLinguagemComIntent("objecao_de_preco")
    processar_mensagem_livre(
        portal_de_linguagem=portal_linguagem,
        portal_de_resposta=_PortalFixo("No plano Completo, a franquia é {{franquia}}."),
        texto_bruto="achei caro, meu CEP é 01310-100",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    assert "01310-100" not in portal_linguagem.textos_recebidos[0]


def test_c10_texto_do_lead_no_contexto_da_resposta_vai_mascarado():
    """C10 do roteiro de aceite: o payload que chega ao portal de resposta (via `texto_do_lead`)
    nunca contém dígitos de WhatsApp — mesma disciplina de `redigir_texto` já aplicada antes de
    chamar o portal de linguagem."""
    portal_resposta = _PortalFixo("No plano Completo, a franquia é {{franquia}}.")
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("objecao_de_preco"),
        portal_de_resposta=portal_resposta,
        texto_bruto="meu whatsapp é +55 11 97224-2584, achei caro",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
    )
    texto_do_lead_no_contexto = portal_resposta.contextos_recebidos[0]["texto_do_lead"]
    assert "97224-2584" not in texto_do_lead_no_contexto
    assert "[REDIGIDO]" in texto_do_lead_no_contexto


def test_trilha_grava_mensagem_recebida_mesmo_quando_intencao_nao_e_objecao():
    """A pergunta do lead vai para a trilha independente do resultado da classificação — vira
    Histórico de atendimentos para o corretor, mesmo quando não é objeção de preço."""
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("informar_dados"),
        portal_de_resposta=_PortalFixo("não deveria ser chamado"),
        texto_bruto="tenho 35 anos",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    assert any(e["evento"] == "mensagem_recebida" for e in eventos)


def test_trilha_grava_mensagem_enviada_com_origem_do_texto():
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("objecao_de_preco"),
        portal_de_resposta=_PortalFixo("No plano Completo, a franquia é {{franquia}}."),
        texto_bruto="achei caro",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    enviada = next(e for e in eventos if e["evento"] == "mensagem_enviada")
    assert enviada["origem_do_texto"] == "llm_resposta:fake@v1"


def test_trilha_grava_regra_aplicada_fora_de_escopo_quando_nao_e_objecao():
    """Achado da re-auditoria do PR #75: `regra_aplicada` continuava fixa em
    `resposta_orientada:objecao_de_preco` mesmo no caminho de fora de escopo (B3) — a trilha
    dizia que uma regra rodou que não rodou."""
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("informar_dados"),
        portal_de_resposta=_PortalFixo("não deveria ser chamado"),
        texto_bruto="tenho 35 anos",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    enviada = next(e for e in eventos if e["evento"] == "mensagem_enviada")
    assert enviada["regra_aplicada"] == "resposta_orientada:fora_de_escopo"


def test_trilha_grava_dados_usados_com_id_e_versao_da_ficha():
    """Bloqueante B5 do veredito da auditoria do PR #75: a trilha precisa registrar quais peças da
    base de conhecimento alimentaram a resposta, não só que "algum LLM respondeu"."""
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("objecao_de_preco"),
        portal_de_resposta=_PortalFixo("No plano Completo, a franquia é {{franquia}}."),
        texto_bruto="achei caro",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    enviada = next(e for e in eventos if e["evento"] == "mensagem_enviada")
    assert enviada["dados_usados"] == ("ficha:preco-alto@1",)


def test_trilha_grava_handoff_quando_encaminha_ao_corretor():
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("objecao_de_preco"),
        portal_de_resposta=_PortalIndisponivel(),
        texto_bruto="achei caro",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    handoff = next(e for e in eventos if e["evento"] == "handoff")
    assert handoff["reason_code"] == "resposta_orientada_indisponivel"


def test_trilha_nunca_grava_handoff_quando_resposta_e_valida():
    repositorio_trilha = RepositorioDeTrilhaMemoria()
    trilha = ServicoDeTrilha(repositorio_trilha)
    processar_mensagem_livre(
        portal_de_linguagem=_PortalDeLinguagemComIntent("objecao_de_preco"),
        portal_de_resposta=_PortalFixo("No plano Completo, a franquia é {{franquia}}."),
        texto_bruto="achei caro",
        estado=_estado(),
        preco_atual=_preco(),
        planos=[],
        servico_conhecimento=_servico_com_ficha_publicada(),
        configuracao=ConfiguracaoComercial(),
        trilha=trilha,
    )
    eventos = repositorio_trilha.eventos_da_conversa("conv-1")
    assert not any(e["evento"] == "handoff" for e in eventos)
    assert not any(e["evento"] == "status_alterado" for e in eventos), (
        "resposta válida não é handoff — não deveria mudar o status da conversa"
    )
