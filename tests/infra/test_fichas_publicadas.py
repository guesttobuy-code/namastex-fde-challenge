"""As 4 fichas de objeção de preço aprovadas pelo dono na #70 (commit e13d974) foram lidas do
disco — `conhecimento/objecoes/*.json`, publicadas pelo caminho real do sistema (`PUT
/api/objecoes/<id>`), nunca escritas à mão. Sem este teste commitado, nada impede alguém de editar
uma ficha depois e reintroduzir um dígito solto ou uma frase proibida (achado da pré-auditoria do
PR — rodar o smoke test à mão uma vez não protege o futuro). Ids esperados e vocabulário de
marcadores (`essencial`/`completo`/`premium`) vêm de `quote-service/data/plans.json:6,13,20` — a
mesma fonte única que `aplicacao/servico_resposta_orientada.py` usa em produção (issue #43, F13)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from dominio.ficha_objecao import (
    validar_frases_proibidas,
    validar_resposta_orientada,
    vocabulario_de_marcadores,
)

DIRETORIO = Path(__file__).resolve().parents[2] / "conhecimento" / "objecoes"
IDS_DOS_PLANOS = ("essencial", "completo", "premium")
VOCABULARIO = vocabulario_de_marcadores(IDS_DOS_PLANOS)

IDS_ESPERADOS = frozenset(
    {"preco-salgado", "mais-barato-na-concorrente", "franquia-alta", "caro-com-carencia"}
)


def _ler_todas() -> list[dict]:
    return [
        json.loads(caminho.read_text(encoding="utf-8"))
        for caminho in sorted(DIRETORIO.glob("*.json"))
    ]


def test_sao_exatamente_as_4_fichas_aprovadas_pelo_dono():
    fichas = _ler_todas()
    assert {f["id"] for f in fichas} == IDS_ESPERADOS
    assert len(fichas) == 4


@pytest.mark.parametrize("id_", sorted(IDS_ESPERADOS))
def test_ficha_esta_publicada_com_versao(id_):
    caminho = DIRETORIO / f"{id_}.json"
    ficha = json.loads(caminho.read_text(encoding="utf-8"))
    assert ficha["status"] == "publicado"
    assert ficha["versao"] >= 1


@pytest.mark.parametrize("id_", sorted(IDS_ESPERADOS))
def test_resposta_orientada_so_usa_marcadores_conhecidos(id_):
    ficha = json.loads((DIRETORIO / f"{id_}.json").read_text(encoding="utf-8"))
    validar_resposta_orientada(ficha["resposta_orientada"], VOCABULARIO)


@pytest.mark.parametrize("id_", sorted(IDS_ESPERADOS))
def test_resposta_orientada_nao_contem_frase_proibida(id_):
    ficha = json.loads((DIRETORIO / f"{id_}.json").read_text(encoding="utf-8"))
    validar_frases_proibidas(ficha["resposta_orientada"])


def test_um_digito_solto_fora_de_marcador_e_pego_pelo_teste():
    """Mutação colada: se alguém editar uma ficha publicada e escrever um preço fixo fora de
    `{{marcador}}`, este teste tem que ficar vermelho — prova de que a rede acima realmente
    protege, não só "passou por acaso"."""
    ficha = json.loads((DIRETORIO / "preco-salgado.json").read_text(encoding="utf-8"))
    adulterada = ficha["resposta_orientada"] + " Sai por R$ 199,90."
    with pytest.raises(Exception, match="número escrito fora de um marcador"):
        validar_resposta_orientada(adulterada, VOCABULARIO)
