"""O teste que a auditoria externa exigiu (ai-logs/codex/2026-09-11, achado incorporado na âncora #3
§9): "ninguém provava que a PII não atravessa para o LLM". Nasce aqui (F4/#7) e é reaproveitado pela
F6/#9, que ainda não existe — por isso o `PortalDeLinguagem` aqui é um dublê local mínimo, não a
porta real (a F6 é quem vai declará-la em `aplicacao/portas/portal_de_linguagem.py`).

Cenário: uma mensagem do lead com CPF, telefone, e-mail, placa e CEP completo (formato real do
dataset). O espião só pode ter recebido a versão mascarada; nem a trilha nem a "resposta final" do
agente (dublê) podem conter o valor original.
"""

from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.eventos_trilha import MensagemEnviada, MensagemRecebida
from dominio.redator_pii import redigir_texto
from infra.trilha_jsonl import RepositorioDeTrilhaMemoria

MENSAGEM_COM_TODA_PII = (
    "Meu cpf e 389.083.863-43, cep 26703-384, "
    "email ursula.souza@gmail.com, whats +55 21 97224-2584, placa GGE4X30"
)

VALORES_ORIGINAIS = [
    "389.083.863-43",
    "26703-384",
    "ursula.souza@gmail.com",
    "+55 21 97224-2584",
    "GGE4X30",
]


class PortalDeLinguagemEspiao:
    """Dublê mínimo: registra tudo que recebeu, devolve uma resposta fixa e inócua."""

    def __init__(self):
        self.recebido: list[str] = []

    def perguntar(self, prompt: str) -> str:
        self.recebido.append(prompt)
        return "Perfeito, já registrei seus dados para cotar."


def _processar_mensagem_do_lead(texto_bruto: str, espiao: PortalDeLinguagemEspiao, servico: ServicoDeTrilha) -> str:
    """Simula a fronteira que a F5 vai orquestrar de verdade: grava o recebido (redigido pela
    trilha), manda só o texto redigido para o LLM, grava a resposta (também redigida)."""
    servico.registrar_evento(
        MensagemRecebida(
            evento="mensagem_recebida",
            conversation_id="conv_espiao",
            id="msg_01",
            instante="2026-09-12T10:00:00",
            texto=texto_bruto,
        )
    )
    texto_para_llm = redigir_texto(texto_bruto)
    resposta = espiao.perguntar(texto_para_llm)
    servico.registrar_evento(
        MensagemEnviada(
            evento="mensagem_enviada",
            conversation_id="conv_espiao",
            id="msg_02",
            instante="2026-09-12T10:00:05",
            texto=resposta,
            decisao_id="dec_01",
            regra_aplicada="confirmar_dados",
            origem_do_texto="llm:espiao@teste",
        )
    )
    return resposta


def test_espiao_so_ve_a_versao_mascarada():
    espiao = PortalDeLinguagemEspiao()
    servico = ServicoDeTrilha(RepositorioDeTrilhaMemoria())

    _processar_mensagem_do_lead(MENSAGEM_COM_TODA_PII, espiao, servico)

    (prompt_recebido,) = espiao.recebido
    for valor in VALORES_ORIGINAIS:
        assert valor not in prompt_recebido, f"{valor!r} chegou ao LLM sem mascarar: {prompt_recebido!r}"


def test_trilha_nao_contem_pii_original():
    espiao = PortalDeLinguagemEspiao()
    repositorio = RepositorioDeTrilhaMemoria()
    servico = ServicoDeTrilha(repositorio)

    _processar_mensagem_do_lead(MENSAGEM_COM_TODA_PII, espiao, servico)

    eventos = repositorio.eventos_da_conversa("conv_espiao")
    trilha_serializada = str(eventos)
    for valor in VALORES_ORIGINAIS:
        assert valor not in trilha_serializada, f"{valor!r} apareceu na trilha: {trilha_serializada!r}"


def test_resposta_final_nao_contem_pii_original():
    espiao = PortalDeLinguagemEspiao()
    servico = ServicoDeTrilha(RepositorioDeTrilhaMemoria())

    resposta = _processar_mensagem_do_lead(MENSAGEM_COM_TODA_PII, espiao, servico)

    for valor in VALORES_ORIGINAIS:
        assert valor not in resposta
