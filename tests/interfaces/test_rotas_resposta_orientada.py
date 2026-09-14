"""`POST /api/chat/responder` (issue #58, frente `ia-responde`) — extraído de `test_servidor.py`
só para não estourar o `file-loc-ceiling` daquele arquivo; reusa os MESMOS helpers (`_criar_app`,
`_chamar`, `_FICHA`, fixtures de isolamento) — mesma suíte, arquivo próprio."""

from __future__ import annotations

import json

from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao
from infra.cliente_quote import FakePortalDeCotacao

from tests.interfaces.test_servidor import _FICHA, _chamar, _criar_app


class _PortalDeLinguagemFakeComIntent:
    def __init__(self, intent):
        self._intent = intent

    def extrair(self, texto_mascarado, estado_atual):
        from dominio.saida_de_linguagem import SaidaDeLinguagem

        return SaidaDeLinguagem(intent=self._intent)

    @property
    def origem_do_texto(self):
        return "extrator_fake:v1"


class _PortalDeRespostaFake:
    def __init__(self, texto):
        self._texto = texto

    def responder(self, contexto):
        return self._texto

    @property
    def origem_do_texto(self):
        return "llm_resposta:fake@v1"


def _app_com_cotacao_e_objecao(tmp_path, *, intent, texto_resposta):
    """Monta o app com uma cotação já feita (`/api/chat/cotar`) para `conv-obj`, e os portais da
    #58 trocados por dublês determinísticos — nenhuma chamada de rede."""
    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    portal_de_cotacao = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(PrecoCotado(
        quote_attempt_id="qa_obj", conversation_id="conv-obj", plano_id="completo",
        plano_nome="Completo", premio_mensal=241.38, franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"), moeda="BRL",
    ))])
    app = _criar_app(
        tmp_path=tmp_path, painel_dir=painel_dir, trilha_dir=trilha_dir,
        portal_de_cotacao=portal_de_cotacao,
        portal_de_linguagem=_PortalDeLinguagemFakeComIntent(intent),
        portal_de_resposta_orientada=_PortalDeRespostaFake(texto_resposta),
    )
    # `montar_e_responder` encaminha direto sem ficha publicada nenhuma — publica uma aqui via a
    # MESMA API (nunca escrevendo o repositório por fora) para o caminho feliz existir.
    status, _, corpo = _chamar(app, "PUT", "/api/objecoes/preco-alto", {**_FICHA, "status": "publicado"})
    assert status == "200 OK", corpo
    status, _, _ = _chamar(app, "POST", "/api/chat/cotar", {
        "conversation_id": "conv-obj", "idade": 35, "veiculo_ano": 2019,
        "cep": "01310-100", "plano_id": "completo", "data_inicio": "2026-10-01",
    })
    assert status == "200 OK"
    return app, trilha_dir


def test_chat_responder_objecao_de_preco_com_cotacao_devolve_texto_com_marcador_resolvido(tmp_path):
    app, _ = _app_com_cotacao_e_objecao(
        tmp_path, intent="objecao_de_preco", texto_resposta="No plano Completo, a franquia é {{franquia}}."
    )

    status, _, corpo = _chamar(app, "POST", "/api/chat/responder", {
        "conversation_id": "conv-obj", "texto": "achei caro esse preço",
    })

    assert status == "200 OK"
    resposta = json.loads(corpo)
    assert resposta["tratado"] is True
    assert resposta["texto"] == "No plano Completo, a franquia é R$ 3.000,00."
    assert resposta["intent"] == "objecao_de_preco"


def test_chat_responder_outra_intencao_devolve_texto_fixo_nunca_fica_mudo(tmp_path):
    """Bloqueante B3 do veredito da auditoria do PR #75: antes devolvia `{"tratado": False}` e o
    front apagava a bolha sem mostrar nada ao lead — acontecia SEMPRE sem chave real. Agora a
    rota sempre devolve `tratado: true` com algum texto."""
    app, _ = _app_com_cotacao_e_objecao(
        tmp_path, intent="informar_dados", texto_resposta="não deveria ser chamado"
    )

    status, _, corpo = _chamar(app, "POST", "/api/chat/responder", {
        "conversation_id": "conv-obj", "texto": "tenho 35 anos",
    })

    assert status == "200 OK"
    resposta = json.loads(corpo)
    assert resposta["tratado"] is True
    assert resposta["texto"] == (
        'Por aqui eu consigo tirar dúvidas sobre o preço desta cotação. Para outras perguntas, '
        'toque em "Falar com um corretor".'
    )
    assert resposta["intent"] == "informar_dados"


def test_chat_responder_sem_texto_e_400(tmp_path):
    app = _criar_app(tmp_path=tmp_path)
    status, _, _ = _chamar(app, "POST", "/api/chat/responder", {"conversation_id": "conv-x"})
    assert status == "400 Bad Request"


def test_chat_responder_sem_conversation_id_e_400(tmp_path):
    app = _criar_app(tmp_path=tmp_path)
    status, _, _ = _chamar(app, "POST", "/api/chat/responder", {"texto": "oi"})
    assert status == "400 Bad Request"


def test_chat_responder_digito_fora_de_marcador_encaminha_e_grava_handoff_na_trilha(tmp_path):
    """Mutação do "Pronto quando" da #58: o LLM devolve um número solto — nunca deve chegar cru ao
    lead; encaminha ao corretor e grava `handoff` na trilha."""
    app, trilha_dir = _app_com_cotacao_e_objecao(
        tmp_path, intent="objecao_de_preco", texto_resposta="Sai por 241 reais, sem marcador nenhum."
    )

    status, _, corpo = _chamar(app, "POST", "/api/chat/responder", {
        "conversation_id": "conv-obj", "texto": "achei caro",
    })

    assert status == "200 OK"
    resposta = json.loads(corpo)
    assert resposta["tratado"] is True
    assert resposta["texto"] == "Logo um corretor vai entrar em contato para te dar todo o suporte."

    trilha_texto = (trilha_dir / "trilha_conv-obj.jsonl").read_text(encoding="utf-8")
    assert '"evento": "handoff"' in trilha_texto or '"evento":"handoff"' in trilha_texto
    assert "resposta_orientada_indisponivel" in trilha_texto
