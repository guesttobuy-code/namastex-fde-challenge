import pytest

from dominio.decisao import Decisao, MotivoHandoff, TipoDecisao


def test_encaminhar_exige_reason_code():
    with pytest.raises(ValueError, match="reason_code"):
        Decisao(TipoDecisao.ENCAMINHAR)


def test_encaminhar_com_motivo_e_valido():
    d = Decisao(TipoDecisao.ENCAMINHAR, reason_code=MotivoHandoff.QUOTE_TIMEOUT)
    assert d.reason_code is MotivoHandoff.QUOTE_TIMEOUT


def test_decisao_fora_de_encaminhar_nao_aceita_reason_code():
    with pytest.raises(ValueError, match="reason_code"):
        Decisao(TipoDecisao.ENCERRAR, reason_code=MotivoHandoff.QUOTE_TIMEOUT)


def test_decisao_sem_reason_code_fora_de_encaminhar_e_valida():
    d = Decisao(TipoDecisao.ENCERRAR)
    assert d.reason_code is None
