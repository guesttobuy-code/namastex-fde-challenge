"""Dono único (LEI 11) dos nomes legíveis de cobertura — achado #54: os ids crus vêm da `/quote`/
`/planos` (`quote-service/data/plans.json`) sem acento e em snake_case; este mapa é o único lugar
que traduz id -> nome para o texto que o lead lê."""
import json
from pathlib import Path

import pytest

from dominio.nomes_cobertura import ids_mapeados, nome_legivel

# Os 7 ids que existem hoje em quote-service/data/plans.json (essencial + completo + premium).
_IDS_DE_PLANS_JSON = {
    "colisao": "colisão",
    "roubo": "roubo",
    "furto": "furto",
    "terceiros": "terceiros",
    "vidros": "vidros",
    "carro_reserva": "carro reserva",
    "assistencia_24h": "assistência 24h",
}

_PLANS_JSON = Path(__file__).resolve().parents[2] / "quote-service" / "data" / "plans.json"


def _ids_reais_de_plans_json() -> set[str]:
    dados = json.loads(_PLANS_JSON.read_text(encoding="utf-8"))
    return {id_cobertura for plano in dados["planos"] for id_cobertura in plano["coberturas"]}


@pytest.mark.parametrize("id_cru,nome_esperado", sorted(_IDS_DE_PLANS_JSON.items()))
def test_os_7_ids_de_plans_json_tem_nome_legivel(id_cru, nome_esperado):
    assert nome_legivel(id_cru) == nome_esperado


def test_todo_id_real_de_plans_json_tem_entrada_explicita_no_mapa():
    """Achado da auditoria do PR #60: `nome_legivel` sozinha NÃO pega id sem nome quando o nome
    esperado é igual ao id cru (`roubo`, `furto`, `terceiros`, `vidros`) — o fallback devolve o
    mesmo valor, então removê-los do mapa não deixava nada vermelho. Este teste lê os ids DE
    VERDADE de `plans.json` (não a cópia à mão `_IDS_DE_PLANS_JSON` acima) e exige que cada um
    seja CHAVE EXPLÍCITA do mapa (`ids_mapeados()`), sem passar pelo fallback — um 8º id novo em
    `plans.json` sem entrada no mapa também fica vermelho aqui."""
    ids_reais = _ids_reais_de_plans_json()
    assert ids_reais, "plans.json não trouxe nenhuma cobertura — este teste não mediria nada"
    faltando = ids_reais - ids_mapeados()
    assert not faltando, f"ids de plans.json sem entrada explícita em nomes_cobertura: {sorted(faltando)}"


def test_id_desconhecido_cai_no_proprio_id_nunca_inventa_nome():
    """LEI 2: dado real ausente se omite, nunca se fabrica — um id que `plans.json` ainda não tem
    aparece como veio, em vez de um nome adivinhado."""
    assert nome_legivel("cobertura_nova_que_ainda_nao_existe") == "cobertura_nova_que_ainda_nao_existe"
