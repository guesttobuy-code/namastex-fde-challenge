"""`ServicoDeTrilha` é a porta que a encomenda da F4 pede: "nada é escrito em log ou trilha sem
passar pelo redator". O teste prova a invariante testando o COMPORTAMENTO (o que chega ao
repositório), não a implementação — se alguém trocar `registrar_evento` para delegar direto ao
repositório sem redigir, este teste fica vermelho.
"""

from aplicacao.portas.repositorio_de_trilha import RepositorioDeTrilha
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.eventos_trilha import MensagemRecebida


class _RepositorioEspiao(RepositorioDeTrilha):
    def __init__(self):
        self.gravados: list[dict] = []

    def registrar(self, evento: dict) -> None:
        self.gravados.append(evento)

    def eventos_da_conversa(self, conversation_id: str) -> list[dict]:
        return [e for e in self.gravados if e["conversation_id"] == conversation_id]


def _evento_com_cpf() -> MensagemRecebida:
    return MensagemRecebida(
        evento="mensagem_recebida",
        conversation_id="conv_00000",
        id="msg_01",
        instante="2026-09-12T10:00:00",
        texto="meu cpf é 389.083.863-43",
    )


def test_registrar_evento_nunca_deixa_cpf_chegar_ao_repositorio():
    repositorio = _RepositorioEspiao()
    servico = ServicoDeTrilha(repositorio)

    servico.registrar_evento(_evento_com_cpf())

    (gravado,) = repositorio.gravados
    assert "389.083.863-43" not in gravado["texto"], (
        f"CPF chegou ao repositório sem passar pelo redator: {gravado!r}"
    )


def test_registrar_evento_preserva_campos_nao_textuais():
    repositorio = _RepositorioEspiao()
    servico = ServicoDeTrilha(repositorio)

    servico.registrar_evento(_evento_com_cpf())

    (gravado,) = repositorio.gravados
    assert gravado["conversation_id"] == "conv_00000"
    assert gravado["id"] == "msg_01"


def test_eventos_da_conversa_e_passthrough_para_o_repositorio():
    repositorio = _RepositorioEspiao()
    servico = ServicoDeTrilha(repositorio)
    servico.registrar_evento(_evento_com_cpf())
    servico.registrar_evento(
        MensagemRecebida(
            evento="mensagem_recebida",
            conversation_id="conv_outra",
            id="msg_99",
            instante="2026-09-12T11:00:00",
            texto="oi",
        )
    )

    eventos = servico.eventos_da_conversa("conv_00000")

    assert len(eventos) == 1
    assert eventos[0]["conversation_id"] == "conv_00000"


def test_registrar_evento_redige_nomes_conhecidos():
    repositorio = _RepositorioEspiao()
    servico = ServicoDeTrilha(repositorio)
    evento = MensagemRecebida(
        evento="mensagem_recebida",
        conversation_id="conv_00000",
        id="msg_02",
        instante="2026-09-12T10:01:00",
        texto="aqui é a Ursula Souza",
    )

    servico.registrar_evento(evento, nomes_conhecidos=["Ursula Souza"])

    (gravado,) = repositorio.gravados
    assert "Ursula Souza" not in gravado["texto"]
