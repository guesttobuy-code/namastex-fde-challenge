"""`POST /api/chat/planos-indisponivel` (issue #95): o chat chama esta rota quando `GET
/api/planos` falhou tentativas suficientes para desistir de deixar o lead escolher um plano.
Módulo PRÓPRIO, não em `interfaces/servidor.py` — que já está no teto do `file-loc-ceiling` (589
linhas), mesmo motivo que já tinha extraído `rotas_status_conversa.py`/`chat_mensagem.py`.

Só traduz HTTP -> `aplicacao.servico_conversa.encaminhar_planos_indisponiveis` (LEI 11 — nenhuma
regra nova aqui; a decisão de NUNCA chamar `portal.cotar()` mora na aplicação, documentada lá).
Recebe idade/veiculo_ano/veiculo_modelo/cep no CORPO (não em `_ESTADOS_EM_MEMORIA`, que só
`/api/chat/cotar` preenche — o lead nunca chega lá quando `/api/planos` falha antes, exatamente o
caso que esta rota existe para cobrir): `_ESTADOS_EM_MEMORIA` fica sempre vazio neste caminho."""
from __future__ import annotations

from pathlib import Path

from aplicacao.portas.repositorio_contato import RepositorioDeContato
from aplicacao.servico_conversa import encaminhar_planos_indisponiveis, montar_estado
from aplicacao.servico_trilha import ServicoDeTrilha
from dominio.validacao import normalizar_cep
from infra.trava_por_conversa import trava_da_conversa
from infra.trilha_jsonl import RepositorioDeTrilhaJSONL
from interfaces.http_comum import METODO_NAO_SUPORTADO as _METODO_NAO_SUPORTADO
from interfaces.http_comum import conversation_id_ou_400 as _conversation_id_ou_400
from interfaces.http_comum import json_resposta as _json
from interfaces.http_comum import ler_corpo_json as _ler_corpo_json
from interfaces.painel.gerar import gerar_paineis


def responder_planos_indisponivel(
    *, painel_dir: Path, trilha_dir: Path, repositorio_contato: RepositorioDeContato | None, environ, metodo: str
):
    """`POST /api/chat/planos-indisponivel` — corpo `{"conversation_id", "idade", "veiculo_ano",
    "cep", "veiculo_modelo"?}`. `idade`/`veiculo_ano`/`cep` ausentes/incompletos -> 400 sem gravar
    nada (o mesmo mínimo que `dominio.validacao` já exige pra qualquer cotação — sem isso não dá
    pra nem montar o `contexto_coletado` do `handoff` de verdade)."""
    if metodo != "POST":
        return _json(*_METODO_NAO_SUPORTADO)
    dados = _ler_corpo_json(environ)
    if dados is None:
        return _json("400 Bad Request", {"erro": "corpo não é JSON válido"})
    conversation_id, resposta_erro = _conversation_id_ou_400(dados)
    if resposta_erro is not None:
        return resposta_erro

    cep_bruto = dados.get("cep")
    if cep_bruto not in (None, "") and normalizar_cep(cep_bruto) is None:
        return _json("400 Bad Request", {"erro": "cep fora do formato válido (00000-000)"})

    estado = montar_estado(conversation_id, dados)
    if estado.campos_faltantes:
        return _json("400 Bad Request", {
            "erro": "dados insuficientes para encaminhar",
            "campos_faltantes": sorted(estado.campos_faltantes),
        })

    # issue #110: mesma trava por conversa que as outras rotas do chat, mesmo esta nunca tocando
    # `_ESTADOS_EM_MEMORIA` (ver docstring do módulo) — protege a trilha desta conversa.
    with trava_da_conversa(conversation_id):
        trilha = ServicoDeTrilha(RepositorioDeTrilhaJSONL(trilha_dir / f"trilha_{conversation_id}.jsonl"))
        turno = encaminhar_planos_indisponiveis(trilha, estado)

    gerar_paineis(trilha_dir, painel_dir, repositorio_contato=repositorio_contato)

    return _json("200 OK", {
        "texto": turno.texto,
        "decisao": {
            "tipo": turno.decisao.tipo.value,
            "reason_code": turno.decisao.reason_code.value if turno.decisao.reason_code else None,
        },
    })
