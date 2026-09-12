from interfaces.painel import tela_avaliacao


def test_sem_eval_casos_jsonl_mostra_buraco_com_o_motivo(tmp_path):
    html = tela_avaliacao.render(caminho_casos=tmp_path / "nao_existe.jsonl")

    assert "ausente na trilha" in html
    assert "eval/casos.jsonl" in html
    assert "F8" in html
