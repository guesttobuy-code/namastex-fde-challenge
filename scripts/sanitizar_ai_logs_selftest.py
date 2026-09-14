# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Self-test (roteiro de mutacao) de `sanitizar_ai_logs.py`, extraido para arquivo proprio (issue
#15) so' pra caber no teto de linhas do guard `file-loc-ceiling` -- comportamento identico ao que
morava antes dentro do modulo principal, nenhuma logica de SANITIZACAO mudou de lugar (so o
arnes de teste). Chamado via `uv run scripts/sanitizar_ai_logs.py --self-test` (import tardio
dentro de `main()`, para nao virar import circular)."""
from __future__ import annotations

import json
from pathlib import Path

from sanitizar_ai_logs import PLACEHOLDER_PADRAO_PESSOAL, exportar


def rodar_self_test() -> int:
    """Roteiro de mutacao: planta uma chave FALSA num .jsonl de teste, mostra a exportacao
    abortando; remove a chave, mostra passando limpo. S1 (issue #15): um padrao pessoal FICTICIO
    numa CHAVE e num VALOR agora e SUBSTITUIDO por `[DADO PESSOAL REMOVIDO]`, exportacao passa (nao
    aborta mais so por isso) -- e o arquivo de padroes pessoais ausente continua abortando ANTES de
    escrever qualquer coisa. S2 (issue #15): um arquivo pre-existente em `saida` (nao gerado por
    este script) sobrevive tanto a um abort quanto a um sucesso -- a pasta inteira nunca e apagada,
    so as pastas de SESSAO exportadas. Nao toca em nada de `_local/` real (todo caminho e
    temporario)."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        pasta_sessao = tmp / "sessao-teste"
        pasta_sessao.mkdir()
        principal = pasta_sessao / "conv-teste.jsonl"
        config_path = tmp / "config.json"
        padroes_path = tmp / "padroes_pessoais.txt"
        saida = tmp / "saida"

        config = {
            "raiz_projects": str(tmp),
            "prefixo_frentes": "sessao-",
            "mapa_fixo": {},
            "excluir_pastas": [],
            "substituicoes": [{"regex": "USUARIO_FALSO", "flags": "i", "por": "<usuario>"}],
            "excluir": [],
        }
        config_path.write_text(json.dumps(config), encoding="utf-8")
        padroes_path.write_text("# comentario ignorado\n\nPADRAO-FICTICIO-TESTE\n", encoding="utf-8")

        # S2: planta um arquivo e uma pasta PRE-EXISTENTES em `saida`, nunca gerados por este
        # script -- tem que sobreviver a TUDO que vem depois (abort e sucesso).
        saida.mkdir()
        marcador_arquivo = saida / "README.md"
        marcador_conteudo = "marcador pre-existente, nunca gerado por este script\n"
        marcador_arquivo.write_text(marcador_conteudo, encoding="utf-8")
        marcador_pasta = saida / "outra-sessao-nao-exportada-agora"
        marcador_pasta.mkdir()
        (marcador_pasta / "arquivo.txt").write_text("nao mexer\n", encoding="utf-8")

        # 1) com chave falsa plantada -> tem que abortar
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "minha chave e sk-or-v1-" + "a" * 64}}) + "\n",
            encoding="utf-8",
        )
        exit_com_chave = exportar(config_path, saida, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_path)
        marcador_sobreviveu_ao_abort = (
            marcador_arquivo.exists() and marcador_arquivo.read_text(encoding="utf-8") == marcador_conteudo
            and (marcador_pasta / "arquivo.txt").exists()
        )
        pasta_teste_nao_criada_no_abort = not (saida / "teste").exists()

        # 2) sem a chave -> tem que passar limpo
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "ola, tudo bem, USUARIO_FALSO?"}}) + "\n",
            encoding="utf-8",
        )
        exit_sem_chave = exportar(config_path, saida, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_path)
        arquivo_saida = saida / "teste" / "conv-teste.jsonl"
        conteudo_final = arquivo_saida.read_text(encoding="utf-8") if arquivo_saida.exists() else ""
        marcador_sobreviveu_ao_sucesso = (
            marcador_arquivo.exists() and marcador_arquivo.read_text(encoding="utf-8") == marcador_conteudo
            and (marcador_pasta / "arquivo.txt").exists()
        )

        # 3) padrao pessoal ficticio numa CHAVE de dict -> S1: substituido, exportacao PASSA (o
        #    achado real: so checar valor nunca pegaria isso; agora tambem SANITIZA, nao so checa)
        principal.write_text(
            json.dumps({"type": "user", "snapshot": {"trackedFileBackups": {"C:\\x\\PADRAO-FICTICIO-TESTE\\a.py": {"v": 1}}}}) + "\n",
            encoding="utf-8",
        )
        exit_padrao_na_chave = exportar(config_path, saida, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_path)
        conteudo_padrao_chave = arquivo_saida.read_text(encoding="utf-8") if arquivo_saida.exists() else ""

        # 4) padrao pessoal ficticio num VALOR -> S1: substituido, exportacao PASSA
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "texto com PADRAO-FICTICIO-TESTE dentro"}}) + "\n",
            encoding="utf-8",
        )
        exit_padrao_no_valor = exportar(config_path, saida, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_path)
        conteudo_padrao_valor = arquivo_saida.read_text(encoding="utf-8") if arquivo_saida.exists() else ""

        # 5) arquivo de padroes pessoais AUSENTE -> tem que abortar ANTES de escrever qualquer
        #    coisa (SystemExit, nunca silencio)
        padroes_ausente = tmp / "nao-existe-padroes.txt"
        principal.write_text(
            json.dumps({"type": "user", "message": {"content": "ola, tudo bem, USUARIO_FALSO?"}}) + "\n",
            encoding="utf-8",
        )
        saida_sem_padroes = tmp / "saida-sem-padroes"
        try:
            exportar(config_path, saida_sem_padroes, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_ausente)
            arquivo_ausente_abortou = False
        except SystemExit:
            arquivo_ausente_abortou = True
        saida_sem_padroes_existe = saida_sem_padroes.exists()

    ok = (
        exit_com_chave == 1
        and marcador_sobreviveu_ao_abort
        and pasta_teste_nao_criada_no_abort
        and exit_sem_chave == 0
        and "<usuario>" in conteudo_final
        and "USUARIO_FALSO" not in conteudo_final
        and marcador_sobreviveu_ao_sucesso
        and exit_padrao_na_chave == 0
        and "PADRAO-FICTICIO-TESTE" not in conteudo_padrao_chave
        and PLACEHOLDER_PADRAO_PESSOAL in conteudo_padrao_chave
        and exit_padrao_no_valor == 0
        and "PADRAO-FICTICIO-TESTE" not in conteudo_padrao_valor
        and PLACEHOLDER_PADRAO_PESSOAL in conteudo_padrao_valor
        and arquivo_ausente_abortou
        and not saida_sem_padroes_existe
    )
    print()
    print("[sanitizar_ai_logs] SELF-TEST (roteiro de mutacao):")
    print(f"  chave falsa plantada          -> exit={exit_com_chave} (esperado 1), marcador pre-existente sobreviveu={marcador_sobreviveu_ao_abort}, pasta teste nao criada={pasta_teste_nao_criada_no_abort}")
    print(f"  chave removida                -> exit={exit_sem_chave} (esperado 0), substituicao aplicada={'<usuario>' in conteudo_final}, marcador pre-existente sobreviveu={marcador_sobreviveu_ao_sucesso}")
    print(f"  padrao pessoal na CHAVE (S1)  -> exit={exit_padrao_na_chave} (esperado 0), substituido={PLACEHOLDER_PADRAO_PESSOAL in conteudo_padrao_chave}")
    print(f"  padrao pessoal no valor (S1)  -> exit={exit_padrao_no_valor} (esperado 0), substituido={PLACEHOLDER_PADRAO_PESSOAL in conteudo_padrao_valor}")
    print(f"  arquivo de padroes ausente    -> abortou={arquivo_ausente_abortou} (esperado True), nada escrito={not saida_sem_padroes_existe}")
    print("SELF-TEST OK" if ok else "SELF-TEST FALHOU")
    return 0 if ok else 1
