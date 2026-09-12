import dataclasses

import pytest

from dominio.estado_conversa import EstadoDaConversa


def test_estado_guarda_os_fatos_coletados():
    estado = EstadoDaConversa(
        conversation_id="c1",
        idade=30,
        veiculo_ano=2018,
        plano_id="essencial",
        cep="01310-100",
        data_inicio="2026-10-01",
        campos_faltantes=frozenset(),
        ambiguidades=(),
        ultimo_intent="cotar",
        status="coletando",
    )
    assert estado.conversation_id == "c1"
    assert estado.idade == 30
    assert estado.campos_faltantes == frozenset()


def test_estado_novo_nao_exige_nada_alem_do_conversation_id():
    estado = EstadoDaConversa(conversation_id="c1")
    assert estado.idade is None
    assert estado.campos_faltantes == frozenset()
    assert estado.ambiguidades == ()


def test_estado_e_imutavel():
    estado = EstadoDaConversa(conversation_id="c1")
    with pytest.raises(dataclasses.FrozenInstanceError):
        estado.idade = 99
