"""Vermelho-antes da invariante da #43 e dos achados da auditoria do PR #45: publicar uma ficha de
objeção de preço recusa dígito fora de marcador, marcador fora do vocabulário (agora dinâmico por
plano — B2), argumentos fora da lista fechada (R2), tentativas vazias/fora de faixa (R1), e a
primeira publicação nasce versão 1, não 2 (R3). Mensagens são frase para o dono (R4)."""
from __future__ import annotations

import pytest

from dominio.ficha_objecao import (
    ARGUMENTOS_PERMITIDOS_CONHECIDOS,
    FichaDeObjecao,
    MARCADORES_BASE,
    MarcadorInvalido,
    validar_argumentos_permitidos,
    validar_resposta_orientada,
    vocabulario_de_marcadores,
)


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


# ── vocabulário de marcadores (B2) ──────────────────────────────────────────


def test_vocabulario_de_marcadores_sem_planos_e_so_a_base():
    assert vocabulario_de_marcadores() == MARCADORES_BASE


def test_vocabulario_de_marcadores_acrescenta_franquia_por_plano():
    vocabulario = vocabulario_de_marcadores(["essencial", "premium"])
    assert "franquia_essencial" in vocabulario
    assert "franquia_premium" in vocabulario
    assert MARCADORES_BASE <= vocabulario


def test_coberturas_e_marcador_base_aprovado_pelo_dono():
    assert "coberturas" in MARCADORES_BASE


def test_resposta_so_com_marcadores_conhecidos_valida():
    validar_resposta_orientada("Sua franquia fica em {{franquia}} e a mensalidade em {{premio_mensal}}.")


def test_resposta_sem_nenhum_numero_valida():
    validar_resposta_orientada("Posso te mostrar as {{coberturas}} incluídas no plano.")


def test_marcador_de_plano_so_valida_quando_o_id_do_plano_e_informado():
    texto = "O Premium tem franquia de {{franquia_premium}}."
    with pytest.raises(MarcadorInvalido, match="não é reconhecido"):
        validar_resposta_orientada(texto)
    validar_resposta_orientada(texto, vocabulario_de_marcadores(["premium"]))


def test_digito_fora_de_marcador_e_recusado_com_frase_para_o_dono():
    with pytest.raises(MarcadorInvalido, match="Coloque o valor dentro de chaves duplas"):
        validar_resposta_orientada("O plano custa R$ 199,90 por mês.")


def test_marcador_desconhecido_e_recusado_com_frase_para_o_dono():
    with pytest.raises(MarcadorInvalido, match="não é reconhecido"):
        validar_resposta_orientada("O plano custa {{preco_inventado}}.")


def test_digito_dentro_do_nome_do_marcador_nao_conta_como_fora():
    # regressão: o dígito faz parte do TOKEN do marcador, não do texto ao redor.
    validar_resposta_orientada("Carência: {{carencia_dias}} dias.")


# ── argumentos permitidos: lista fechada (R2) ───────────────────────────────


def test_lista_fechada_tem_os_4_argumentos_aprovados_pelo_dono():
    assert ARGUMENTOS_PERMITIDOS_CONHECIDOS == {
        "coberturas",
        "franquia_por_plano",
        "carencia",
        "comparacao_entre_planos",
    }


def test_argumentos_vazios_sao_recusados():
    with pytest.raises(ValueError, match="Selecione ao menos um argumento"):
        validar_argumentos_permitidos(())


def test_argumento_fora_da_lista_aprovada_e_recusado():
    with pytest.raises(ValueError, match="Argumento não permitido"):
        validar_argumentos_permitidos(("desconto_agressivo",))


def test_argumentos_dentro_da_lista_aprovada_validam():
    validar_argumentos_permitidos(("coberturas", "carencia"))


# ── publicar: orquestra tudo, sem mutar, mensagens em frase para o dono ────


def test_publicar_ficha_valida_muda_status_e_primeira_versao_e_1():
    rascunho = _ficha("Posso ajustar a franquia para {{franquia}}.", status="rascunho", versao=0)
    publicada = rascunho.publicar()
    assert publicada.status == "publicado"
    assert publicada.versao == 1  # achado R3 — a primeira publicação nunca é 2
    assert publicada.atualizado_em != ""
    # publicar nunca muta a ficha original (dataclass congelada = auditável)
    assert rascunho.status == "rascunho"


def test_publicar_de_novo_incrementa_a_partir_da_versao_ja_publicada():
    ja_publicada = _ficha("Posso ajustar a franquia para {{franquia}}.", status="publicado", versao=1)
    republicada = ja_publicada.publicar()
    assert republicada.versao == 2


def test_publicar_ficha_com_digito_fora_de_marcador_e_recusado_e_nao_gera_nova_versao():
    rascunho = _ficha("O plano custa R$ 199,90.", versao=0)
    with pytest.raises(MarcadorInvalido):
        rascunho.publicar()
    assert rascunho.status == "rascunho"
    assert rascunho.versao == 0


def test_publicar_com_marcador_de_plano_exige_o_id_do_plano_na_chamada():
    rascunho = _ficha("Franquia do Premium: {{franquia_premium}}.")
    with pytest.raises(MarcadorInvalido):
        rascunho.publicar()  # sem ids_dos_planos, o marcador por plano não existe
    rascunho.publicar(["premium"])  # não levanta


@pytest.mark.parametrize("tentativas", [None, 0, 6, -1])
def test_tentativas_vazia_ou_fora_da_faixa_e_recusada_ao_publicar(tentativas):
    rascunho = _ficha("Sem números aqui.", tentativas_antes_do_corretor=tentativas)
    with pytest.raises(ValueError, match="tentativas antes do corretor"):
        rascunho.publicar()


def test_tentativas_ausente_no_de_dict_vira_none_nunca_um_numero_fabricado():
    # achado R1: campo ausente é None, não um default como 1 ou 2.
    ficha = FichaDeObjecao.de_dict({"id": "x", "resposta_orientada": ""})
    assert ficha.tentativas_antes_do_corretor is None


def test_publicar_sem_argumento_selecionado_e_recusado():
    rascunho = _ficha("Sem números aqui.", argumentos_permitidos=())
    with pytest.raises(ValueError, match="Selecione ao menos um argumento"):
        rascunho.publicar()
