"""O ponto de desenho que decide a #9 (F6): o CEP é PII e o redator (F4) troca por `[REDIGIDO]` —
mas sem CEP a `/quote` não cota. Por isso o CEP é extraído do texto BRUTO, por código
determinístico, ANTES do mascaramento (`dominio.redator_pii.extrair_cep`); só depois o texto
mascarado vai ao portal de linguagem. Prova obrigatória, os DOIS lados no mesmo teste: o "espião"
(o portal) só vê `[REDIGIDO]`, e o `EstadoDaConversa`/payload da `/quote` têm o CEP real.
"""

from __future__ import annotations

from aplicacao.servico_conversa import _payload_da_quote, extrair_dados_da_mensagem
from dominio.estado_conversa import EstadoDaConversa
from infra.adaptador_de_linguagem import AdaptadorDeLinguagemDeterministico

CEP_REAL = "26703-384"
MENSAGEM_DO_LEAD = f"Tenho 30 anos, cep {CEP_REAL}, meu carro é um Sandero 2022"


class _PortalEspiao:
    """Envolve o adaptador determinístico real e grava o texto mascarado que recebeu — para o
    teste confirmar que o CEP nunca atravessa para o portal, nos dois formatos (hífen e espaço)."""

    def __init__(self):
        self._real = AdaptadorDeLinguagemDeterministico()
        self.recebido: list[str] = []

    def extrair(self, texto_mascarado: str, estado_atual: EstadoDaConversa):
        self.recebido.append(texto_mascarado)
        return self._real.extrair(texto_mascarado, estado_atual)

    @property
    def origem_do_texto(self) -> str:
        return self._real.origem_do_texto


def test_cep_mascarado_para_o_portal_e_real_no_estado_e_na_quote():
    espiao = _PortalEspiao()
    estado_inicial = EstadoDaConversa(conversation_id="conv-cep")

    estado_final = extrair_dados_da_mensagem(espiao, MENSAGEM_DO_LEAD, estado_inicial)

    # lado 1: o portal (o "LLM") só viu a versão mascarada.
    (texto_recebido,) = espiao.recebido
    assert CEP_REAL not in texto_recebido, f"CEP real vazou para o portal: {texto_recebido!r}"
    assert "[REDIGIDO]" in texto_recebido

    # lado 2: o estado da conversa tem o CEP real (senão a /quote não cota).
    assert estado_final.cep == CEP_REAL

    # lado 3: o payload que vai para a /quote também carrega o CEP real.
    payload = _payload_da_quote(estado_final)
    assert payload["cep"] == CEP_REAL

    # e os outros campos (não-PII) foram extraídos normalmente pelo portal.
    assert estado_final.idade == 30
    assert estado_final.veiculo_ano == 2022


def test_cep_com_espaco_tambem_nao_atravessa_e_normaliza_no_estado():
    espiao = _PortalEspiao()
    estado_inicial = EstadoDaConversa(conversation_id="conv-cep-2")
    mensagem = "meu cep e 07624 954, tenho 45 anos"

    estado_final = extrair_dados_da_mensagem(espiao, mensagem, estado_inicial)

    (texto_recebido,) = espiao.recebido
    assert "07624 954" not in texto_recebido
    assert "07624-954" not in texto_recebido
    assert estado_final.cep == "07624-954"
