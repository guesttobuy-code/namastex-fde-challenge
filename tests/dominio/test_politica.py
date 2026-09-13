import pytest

from dominio.configuracao_comercial import ConfiguracaoComercial
from dominio.decisao import Decisao, MotivoHandoff, TipoDecisao
from dominio.estado_conversa import EstadoDaConversa
from dominio.intencao import Intencao
from dominio.politica import decidir
from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao


def _estado(**over):
    base = {"conversation_id": "c1", "campos_faltantes": frozenset()}
    base.update(over)
    return EstadoDaConversa(**base)


def _preco() -> PrecoCotado:
    return PrecoCotado(
        quote_attempt_id="qa-1",
        conversation_id="c1",
        plano_id="essencial",
        plano_nome="Essencial",
        premio_mensal=100.0,
        franquia=1000.0,
        coberturas=("colisao",),
        moeda="BRL",
    )


CASOS = [
    pytest.param(_estado(campos_faltantes=frozenset({"cep"})), None, Decisao(TipoDecisao.COLETAR_INFORMACAO), id="falta_cep"),
    pytest.param(_estado(), None, Decisao(TipoDecisao.COTAR), id="pronto_para_cotar"),
    pytest.param(_estado(), ResultadoDaCotacao.sucesso(_preco()), Decisao(TipoDecisao.EXPLICAR_COTACAO), id="sucesso"),
    pytest.param(
        _estado(), ResultadoDaCotacao.indisponivel("upstream_unavailable"),
        Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_INDISPONIVEL), id="indisponivel",
    ),
    pytest.param(
        _estado(), ResultadoDaCotacao.timeout("upstream_timeout"),
        Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_TIMEOUT), id="timeout",
    ),
    pytest.param(
        _estado(), ResultadoDaCotacao.erro_de_payload("payload_invalido"),
        Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_ERRO_DE_PAYLOAD), id="erro_de_payload",
    ),
]


@pytest.mark.parametrize("estado,resultado,esperado", CASOS)
def test_tabela_de_decisao(estado, resultado, esperado):
    assert decidir(estado, resultado) == esperado


@pytest.mark.parametrize(
    "configuracao,esperado",
    [
        pytest.param(
            ConfiguracaoComercial(encaminhar_lead_fora_do_padrao=True),
            Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.RECUSA_REGRA_DE_ACEITACAO),
            id="config_ligada_encaminha",
        ),
        pytest.param(
            ConfiguracaoComercial(encaminhar_lead_fora_do_padrao=False),
            Decisao(TipoDecisao.ENCERRAR),
            id="config_desligada_encerra_como_antes",
        ),
    ],
)
def test_recusa_de_negocio_depende_da_configuracao_comercial(configuracao, esperado):
    """issue #42, decisão do dono (#41): a recusa 422 vira ENCAMINHAR ou ENCERRAR conforme
    `ConfiguracaoComercial.encaminhar_lead_fora_do_padrao` — o domínio só recebe o valor,
    nunca lê arquivo nem decide o padrão sozinho."""
    resultado = ResultadoDaCotacao.recusa_de_negocio("idade fora da faixa")
    assert decidir(_estado(), resultado, configuracao) == esperado


def test_recusa_de_negocio_sem_configuracao_usa_o_padrao_ligado():
    resultado = ResultadoDaCotacao.recusa_de_negocio("idade fora da faixa")
    assert decidir(_estado(), resultado) == Decisao(
        TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.RECUSA_REGRA_DE_ACEITACAO
    )


def test_quer_contratar_encaminha_mesmo_sem_resultado_de_cotacao():
    """issue #42, decisão do dono: "quero contratar" é sinal explícito do lead, incondicional."""
    estado = _estado(ultimo_intent=Intencao.QUER_CONTRATAR)
    assert decidir(estado, None) == Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.LEAD_QUER_CONTRATAR)


def test_quer_contratar_tem_prioridade_sobre_campos_faltantes():
    """Confirmado pelo dono (#42): a intenção não espera dado completo."""
    estado = _estado(campos_faltantes=frozenset({"cep"}), ultimo_intent=Intencao.QUER_CONTRATAR)
    assert decidir(estado, None) == Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.LEAD_QUER_CONTRATAR)
