from dominio.decisao import MotivoHandoff
from interfaces.painel.motivos import DESCRICAO_MOTIVO, descricao_do_motivo


def test_todo_motivohandoff_tem_descricao_registrada():
    """Pedido da coordenação (issue #42): sem este teste, um `MotivoHandoff` novo sem entrada em
    `DESCRICAO_MOTIVO` cai em silêncio no fallback "sem descrição registrada" — nenhum outro
    teste pegava esse silêncio antes daquela issue. Movido de `test_tela_fila_humana.py` para cá
    (issue #57, P14, PR 2 de 2) quando `_DESCRICAO_MOTIVO` ganhou dono único em
    `interfaces.painel.motivos`, usado também por `tela_conversas` (S12)."""
    sem_descricao = {m.value for m in MotivoHandoff} - set(DESCRICAO_MOTIVO.keys())
    assert not sem_descricao, f"MotivoHandoff sem entrada em DESCRICAO_MOTIVO: {sem_descricao}"


def test_descricao_do_motivo_desconhecido_nunca_inventa_texto():
    assert descricao_do_motivo("motivo_que_nao_existe") == "sem descrição registrada"


def test_descricao_do_motivo_none_nunca_inventa_texto():
    assert descricao_do_motivo(None) == "sem descrição registrada"
