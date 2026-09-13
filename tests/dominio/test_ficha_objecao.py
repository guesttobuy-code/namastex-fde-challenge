"""Vermelho-antes da invariante da #43: publicar uma ficha de objeção de preço recusa dígito fora
de marcador ou marcador fora do vocabulário conhecido (LEI 2 — número não verificável nunca passa
por publicado calado)."""
from __future__ import annotations

import pytest

from dominio.ficha_objecao import FichaDeObjecao, MarcadorInvalido, validar_resposta_orientada


def _ficha(resposta_orientada: str, **kw) -> FichaDeObjecao:
    base = dict(
        id="preco-alto",
        nome="Preço tá salgado",
        frases_do_lead=("o preço tá salgado", "achei caro pra esse carro"),
        resposta_orientada=resposta_orientada,
        argumentos_permitidos=("coberturas", "franquia_por_plano"),
        tentativas_antes_do_corretor=2,
    )
    base.update(kw)
    return FichaDeObjecao(**base)


def test_resposta_so_com_marcadores_conhecidos_valida():
    validar_resposta_orientada("Sua franquia fica em {{franquia}} e a mensalidade em {{premio_mensal}}.")


def test_resposta_sem_nenhum_numero_valida():
    validar_resposta_orientada("Posso te mostrar as coberturas incluídas no plano.")


def test_digito_fora_de_marcador_e_recusado():
    with pytest.raises(MarcadorInvalido, match="dígito fora de marcador"):
        validar_resposta_orientada("O plano custa R$ 199,90 por mês.")


def test_marcador_desconhecido_e_recusado():
    with pytest.raises(MarcadorInvalido, match="marcador desconhecido"):
        validar_resposta_orientada("O plano custa {{preco_inventado}}.")


def test_digito_dentro_do_nome_do_marcador_nao_conta_como_fora():
    # regressão: o dígito faz parte do TOKEN do marcador, não do texto ao redor.
    validar_resposta_orientada("Carência: {{carencia_dias}} dias.")


def test_publicar_ficha_valida_muda_status_e_incrementa_versao():
    rascunho = _ficha("Posso ajustar a franquia para {{franquia}}.", status="rascunho", versao=1)
    publicada = rascunho.publicar()
    assert publicada.status == "publicado"
    assert publicada.versao == 2
    assert publicada.atualizado_em != ""
    # publicar nunca muta a ficha original (dataclass congelada = auditável)
    assert rascunho.status == "rascunho"


def test_publicar_ficha_com_digito_fora_de_marcador_e_recusado_e_nao_gera_nova_versao():
    rascunho = _ficha("O plano custa R$ 199,90.")
    with pytest.raises(MarcadorInvalido):
        rascunho.publicar()
    assert rascunho.status == "rascunho"
    assert rascunho.versao == 1


@pytest.mark.parametrize("tentativas", [0, 6, -1])
def test_tentativas_antes_do_corretor_fora_da_faixa_e_recusado(tentativas):
    rascunho = _ficha("Sem números aqui.", tentativas_antes_do_corretor=tentativas)
    with pytest.raises(ValueError, match="tentativas_antes_do_corretor"):
        rascunho.publicar()
