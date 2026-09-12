"""O teste que a auditoria externa exigiu (ai-logs/codex/2026-09-11, achado incorporado na âncora #3
§9): "ninguém provava que a PII não atravessa para o LLM". Nasceu na F4/#7 com um dublê local
mínimo (`PortalDeLinguagemEspiao`, sem `.extrair`/`.origem_do_texto` de verdade) porque a F6 ainda
não existia. **A F6/#9 troca esse dublê pela porta real**: `_AdaptadorEspiao` envolve
`infra.AdaptadorDeLinguagemDeterministico` (o padrão, sem chave) e só registra o que recebeu — a
exigência do item 6 do "O que entregar" da #9.

Cenário: uma mensagem do lead com CPF, telefone, e-mail, placa e CEP completo (formato real do
dataset). O adaptador real só pode ter recebido a versão mascarada; nem a trilha nem a "resposta
final" do agente podem conter o valor original.
"""

from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.estado_conversa import EstadoDaConversa
from dominio.eventos_trilha import MensagemEnviada, MensagemRecebida
from dominio.redator_pii import redigir_texto
from dominio.saida_de_linguagem import SaidaDeLinguagem
from infra.adaptador_de_linguagem import AdaptadorDeLinguagemDeterministico
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


class _AdaptadorEspiao:
    """Envolve o adaptador real e grava o texto mascarado que ele recebeu, sem mudar o
    comportamento — o teste espia a FRONTEIRA, não o adaptador."""

    def __init__(self):
        self._real = AdaptadorDeLinguagemDeterministico()
        self.recebido: list[str] = []

    def extrair(self, texto_mascarado: str, estado_atual: EstadoDaConversa) -> SaidaDeLinguagem:
        self.recebido.append(texto_mascarado)
        return self._real.extrair(texto_mascarado, estado_atual)

    @property
    def origem_do_texto(self) -> str:
        return self._real.origem_do_texto


def _resposta_de_confirmacao(saida: SaidaDeLinguagem) -> str:
    """Texto determinístico, nunca escrito pelo LLM (issue #9: preço/recusa/handoff nunca vêm do
    modelo) — só reconhece o que a extração conseguiu ou pede esclarecimento."""
    return saida.pedido_de_esclarecimento or "Perfeito, já registrei seus dados para cotar."


def _processar_mensagem_do_lead(texto_bruto: str, espiao: _AdaptadorEspiao, servico: ServicoDeTrilha) -> str:
    """Simula a fronteira que `aplicacao.servico_conversa.extrair_dados_da_mensagem` orquestra de
    verdade: grava o recebido (redigido pela trilha), manda só o texto redigido para o portal,
    grava a resposta (também redigida)."""
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
    saida = espiao.extrair(texto_para_llm, EstadoDaConversa(conversation_id="conv_espiao"))
    resposta = _resposta_de_confirmacao(saida)
    servico.registrar_evento(
        MensagemEnviada(
            evento="mensagem_enviada",
            conversation_id="conv_espiao",
            id="msg_02",
            instante="2026-09-12T10:00:05",
            texto=resposta,
            decisao_id="dec_01",
            regra_aplicada="confirmar_dados",
            origem_do_texto=espiao.origem_do_texto,
        )
    )
    return resposta


def test_espiao_so_ve_a_versao_mascarada():
    espiao = _AdaptadorEspiao()
    servico = ServicoDeTrilha(RepositorioDeTrilhaMemoria())

    _processar_mensagem_do_lead(MENSAGEM_COM_TODA_PII, espiao, servico)

    (prompt_recebido,) = espiao.recebido
    for valor in VALORES_ORIGINAIS:
        assert valor not in prompt_recebido, f"{valor!r} chegou ao LLM sem mascarar: {prompt_recebido!r}"


def test_trilha_nao_contem_pii_original():
    espiao = _AdaptadorEspiao()
    repositorio = RepositorioDeTrilhaMemoria()
    servico = ServicoDeTrilha(repositorio)

    _processar_mensagem_do_lead(MENSAGEM_COM_TODA_PII, espiao, servico)

    eventos = repositorio.eventos_da_conversa("conv_espiao")
    trilha_serializada = str(eventos)
    for valor in VALORES_ORIGINAIS:
        assert valor not in trilha_serializada, f"{valor!r} apareceu na trilha: {trilha_serializada!r}"


def test_resposta_final_nao_contem_pii_original():
    espiao = _AdaptadorEspiao()
    servico = ServicoDeTrilha(RepositorioDeTrilhaMemoria())

    resposta = _processar_mensagem_do_lead(MENSAGEM_COM_TODA_PII, espiao, servico)

    for valor in VALORES_ORIGINAIS:
        assert valor not in resposta
