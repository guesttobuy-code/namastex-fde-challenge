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

from sanitizar_ai_logs import PLACEHOLDER_PADRAO_PESSOAL, exportar, verificacao_final


def rodar_self_test() -> int:
    """Roteiro de mutacao: planta uma chave FALSA num .jsonl de teste, mostra a exportacao
    abortando; remove a chave, mostra passando limpo. S1 (issue #15): um padrao pessoal FICTICIO
    numa CHAVE e num VALOR agora e SUBSTITUIDO por `[DADO PESSOAL REMOVIDO]`, exportacao passa (nao
    aborta mais so por isso) -- e o arquivo de padroes pessoais ausente continua abortando ANTES de
    escrever qualquer coisa. S2 (issue #15): um arquivo pre-existente em `saida` (nao gerado por
    este script) sobrevive tanto a um abort quanto a um sucesso -- a pasta inteira nunca e apagada,
    so as pastas de SESSAO exportadas. S3 (issue #15): a ultima linha do arquivo de origem sem '\n'
    final (sessao ainda sendo escrita no instante da copia) nao aborta mais -- so essa linha e
    descartada, com aviso, e o resto exporta normal. S4 (issue #15): `verificacao_final` separa
    "linha" so por '\n' real (bytes) -- um registro valido com U+2028/U+0085 embutido num valor
    string nao aborta mais (json.dumps nao escapa esses caracteres, e o antigo `str.splitlines()`
    os tratava como quebra de linha, fragmentando 1 registro em 2+ "linhas" invalidas falsas); uma
    linha de verdade invalida no meio continua abortando. Nao toca em nada de `_local/` real (todo
    caminho e temporario)."""
    import contextlib
    import io
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

        # 6) S3: ultima linha do arquivo de origem SEM '\n' final (sessao sendo escrita no instante
        #    da copia) -> nao aborta, descarta so essa linha, avisa a contagem, resto passa normal
        principal.write_bytes(
            (json.dumps({"type": "user", "message": {"content": "MARCA-LINHA-COMPLETA"}}) + "\n").encode("utf-8")
            + json.dumps({"type": "user", "message": {"content": "MARCA-LINHA-INCOMPLETA"}}).encode("utf-8")
        )
        captura = io.StringIO()
        with contextlib.redirect_stdout(captura):
            exit_linha_incompleta = exportar(config_path, saida, apenas_sessoes=["teste"], padroes_pessoais_path=padroes_path)
        saida_capturada_s3 = captura.getvalue()
        conteudo_linha_incompleta = arquivo_saida.read_text(encoding="utf-8") if arquivo_saida.exists() else ""

        # 7) S4 (achado da exportacao real, issue #15): verificacao_final tem que separar "linha" por
        #    `\n` REAL (bytes), nunca por `str.splitlines()` -- `json.dumps` nao escapa U+0085 (NEL)
        #    nem U+2028/U+2029 (fora do range 0x00-0x1F que o JSON exige escapar), e `splitlines()`
        #    trata esses caracteres como quebra de linha, fragmentando 1 registro VALIDO em 2+
        #    "linhas" falsas (achado ao vivo: 2 registros reais da sessao da coordenacao, cada um com
        #    um separador desses dentro de um valor string, viraram 4 "linhas invalidas" reportadas,
        #    quando nenhum registro estava quebrado). Testa `verificacao_final` DIRETO (sem passar
        #    por `exportar`/`sanitizar_arquivo_jsonl`, que so escrevem `\n` real e nunca produziriam o
        #    caso por si so): 1 registro valido com U+2028 e U+0085 embutidos (nao pode reportar
        #    problema) e, na linha seguinte, 1 registro DE VERDADE invalido (tem que continuar
        #    reportando -- a troca de separador nao pode fazer a checagem parar de pegar erro real).
        pasta_verificacao_s4 = tmp / "verificacao-s4"
        pasta_verificacao_s4.mkdir()
        arquivo_verificacao_s4 = pasta_verificacao_s4 / "sessao-verificacao.jsonl"
        # chr(0x2028)/chr(0x0085) -- nunca um caractere cru no fonte (LS/NEL nao aparecem no
        # editor de forma confiavel; construir por codigo evita mutilacao do arquivo-fonte).
        separador_ls = chr(0x2028)
        separador_nel = chr(0x0085)
        conteudo_com_separadores = f"linha1{separador_ls}linha2{separador_nel}linha3"
        # ensure_ascii=False, igual ao `json.dumps` real (linha 308) -- com o default (True) os
        # caracteres nao-ASCII virariam escape `\uXXXX` e o caso de teste nao reproduziria o achado
        # real (U+2028/U+0085 CRUS na saida, que so aparecem com ensure_ascii=False).
        registro_com_separadores = json.dumps(
            {"type": "user", "message": {"content": conteudo_com_separadores}}, ensure_ascii=False
        )
        arquivo_verificacao_s4.write_text(
            registro_com_separadores + "\n" + "{isto nao e json valido" + "\n", encoding="utf-8"
        )
        problemas_s4 = verificacao_final(pasta_verificacao_s4, ["PADRAO-FICTICIO-TESTE"])
        registro_com_separadores_nao_reportado = not any(
            "sessao-verificacao.jsonl:1:" in p for p in problemas_s4
        )
        linha_invalida_ainda_reportada = any(
            "sessao-verificacao.jsonl:2: linha nao e JSON valido" in p for p in problemas_s4
        )

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
        and exit_linha_incompleta == 0
        and "MARCA-LINHA-COMPLETA" in conteudo_linha_incompleta
        and "MARCA-LINHA-INCOMPLETA" not in conteudo_linha_incompleta
        and "linha(s) final(is) incompleta(s) descartada(s)" in saida_capturada_s3
        and registro_com_separadores_nao_reportado
        and linha_invalida_ainda_reportada
    )
    print()
    print("[sanitizar_ai_logs] SELF-TEST (roteiro de mutacao):")
    print(f"  chave falsa plantada          -> exit={exit_com_chave} (esperado 1), marcador pre-existente sobreviveu={marcador_sobreviveu_ao_abort}, pasta teste nao criada={pasta_teste_nao_criada_no_abort}")
    print(f"  chave removida                -> exit={exit_sem_chave} (esperado 0), substituicao aplicada={'<usuario>' in conteudo_final}, marcador pre-existente sobreviveu={marcador_sobreviveu_ao_sucesso}")
    print(f"  padrao pessoal na CHAVE (S1)  -> exit={exit_padrao_na_chave} (esperado 0), substituido={PLACEHOLDER_PADRAO_PESSOAL in conteudo_padrao_chave}")
    print(f"  padrao pessoal no valor (S1)  -> exit={exit_padrao_no_valor} (esperado 0), substituido={PLACEHOLDER_PADRAO_PESSOAL in conteudo_padrao_valor}")
    print(f"  arquivo de padroes ausente    -> abortou={arquivo_ausente_abortou} (esperado True), nada escrito={not saida_sem_padroes_existe}")
    print(f"  linha final sem '\\n' (S3)     -> exit={exit_linha_incompleta} (esperado 0), linha completa preservada={'MARCA-LINHA-COMPLETA' in conteudo_linha_incompleta}, linha incompleta descartada={'MARCA-LINHA-INCOMPLETA' not in conteudo_linha_incompleta}, avisou={'linha(s) final(is) incompleta(s) descartada(s)' in saida_capturada_s3}")
    print(f"  separador U+2028/U+0085 (S4)  -> registro valido NAO reportado={registro_com_separadores_nao_reportado} (esperado True), linha de verdade invalida continua reportada={linha_invalida_ainda_reportada} (esperado True)")
    print("SELF-TEST OK" if ok else "SELF-TEST FALHOU")
    return 0 if ok else 1
