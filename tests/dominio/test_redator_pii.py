"""`redigir_texto` é a invariante desta frente (issue #7): nada que passe por ele pode manter PII
original. O `.capitalize()` de `scripts/generate_dataset.py:113` baixa `CPF`/`CEP` para minúsculo
quando não é a primeira palavra do bloco — medido ao vivo e citado no PLANO da #7 — por isso toda
regex tem que ser `(?i)`. Casos com dado real do dataset (`dataset/sample.jsonl`) primeiro; fixtures
manuais dos formatos alternativos depois, para o limite ficar declarado, não escondido.
"""

from dominio.redator_pii import extrair_cep, redigir_texto

# Linhas reais de `dataset/sample.jsonl`, coladas — não reformatadas — para provar que o teste mede
# o dado que o gerador realmente produz (cpf/cep minúsculos), não um exemplo inventado.
MENSAGENS_REAIS_DO_DATASET = [
    "Tenho 35 anos, cep 26703-384, cpf 389.083.863-43",
    "Cep 07624-954, cpf 662.011.621-35, tenho 30 anos",
    "Tenho 55 anos, cpf 965.515.492-09, cep 04623-171",
    "meu email é ursula.souza@gmail.com e o whats é esse mesmo +55 21 97224-2584",
    "a placa é GGE4X30 se precisar",
]

CPFS_ORIGINAIS = ["389.083.863-43", "662.011.621-35", "965.515.492-09"]
CEPS_ORIGINAIS = ["26703-384", "07624-954", "04623-171"]
EMAIL_ORIGINAL = "ursula.souza@gmail.com"
TELEFONE_ORIGINAL = "+55 21 97224-2584"
PLACA_MERCOSUL_ORIGINAL = "GGE4X30"


def test_cpf_minusculo_do_dataset_nao_sobrevive_ao_redator():
    for texto in MENSAGENS_REAIS_DO_DATASET:
        saida = redigir_texto(texto)
        for cpf in CPFS_ORIGINAIS:
            assert cpf not in saida, f"CPF apareceu na saída: {cpf!r} em {saida!r}"


def test_cep_minusculo_do_dataset_nao_sobrevive_ao_redator():
    for texto in MENSAGENS_REAIS_DO_DATASET:
        saida = redigir_texto(texto)
        for cep in CEPS_ORIGINAIS:
            assert cep not in saida, f"CEP apareceu na saída: {cep!r} em {saida!r}"


def test_email_nao_sobrevive_ao_redator():
    saida = redigir_texto(MENSAGENS_REAIS_DO_DATASET[3])
    assert EMAIL_ORIGINAL not in saida, f"e-mail apareceu na saída: {saida!r}"


def test_telefone_nao_sobrevive_ao_redator():
    saida = redigir_texto(MENSAGENS_REAIS_DO_DATASET[3])
    assert TELEFONE_ORIGINAL not in saida, f"telefone apareceu na saída: {saida!r}"


def test_placa_mercosul_nao_sobrevive_ao_redator():
    saida = redigir_texto(MENSAGENS_REAIS_DO_DATASET[4])
    assert PLACA_MERCOSUL_ORIGINAL not in saida, f"placa apareceu na saída: {saida!r}"


# --- Limite declarado: formatos alternativos que a varredura por regex não teria certeza de pegar
# sem fixture manual (issue #7, "Limite que tem que ficar declarado"). ---


def test_cpf_sem_pontuacao_fixture_manual():
    saida = redigir_texto("meu cpf é 38908386343, pode confirmar?")
    assert "38908386343" not in saida


def test_telefone_sem_ddi_fixture_manual():
    saida = redigir_texto("pode me chamar no 21 97224-2584 mesmo")
    assert "21 97224-2584" not in saida


def test_cep_com_espaco_fixture_manual():
    saida = redigir_texto("o cep aqui de casa e 26703 384")
    assert "26703 384" not in saida


def test_placa_padrao_antigo_fixture_manual():
    saida = redigir_texto("a placa antiga do carro e ABC1234")
    assert "ABC1234" not in saida


def test_nome_conhecido_e_redigido_quando_informado():
    saida = redigir_texto("Aqui é a Ursula Souza, tudo bem?", nomes_conhecidos=["Ursula Souza"])
    assert "Ursula Souza" not in saida


def test_texto_sem_pii_passa_intacto():
    texto = "Oi, queria fazer um seguro pro meu carro"
    assert redigir_texto(texto) == texto


# --- Onde o (?i) é load-bearing de verdade, e onde não é (achado durante a auditoria do PLANO:
# CPF/CEP/telefone são padrões só de dígito — sem letra, (?i) não muda o resultado deles; quem
# precisa da flag é a placa, porque o char class é [a-z] e o dataset sempre gera maiúsculo). ---


def test_padrao_de_cpf_nao_depende_de_case_por_nao_ter_letra():
    import re

    sem_flag = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")
    assert sem_flag.sub("[X]", "cpf 389.083.863-43") == "cpf [X]"


def test_padrao_de_placa_precisa_de_case_insensitive_porque_tem_letra():
    import re

    com_flag = re.compile(r"(?i)\b[a-z]{3}\d[a-z]\d{2}\b")
    sem_flag = re.compile(r"\b[a-z]{3}\d[a-z]\d{2}\b")
    assert com_flag.sub("[X]", "placa GGE4X30") == "placa [X]"
    assert sem_flag.sub("[X]", "placa GGE4X30") == "placa GGE4X30", (
        "sem (?i) o char class [a-z] não bate com a placa maiúscula do dataset — "
        "é aqui que a flag realmente protege, não no CPF"
    )


# --- `extrair_cep` (issue #9, F6): o CEP é PII e nunca vai ao LLM, mas é extraído do texto BRUTO,
# ANTES do mascaramento, com os mesmos padrões acima (nunca duplicados). ---


def test_extrair_cep_do_dataset_com_hifen():
    for texto, cep in zip(MENSAGENS_REAIS_DO_DATASET[:3], CEPS_ORIGINAIS):
        assert extrair_cep(texto) == cep


def test_extrair_cep_com_espaco_fixture_manual_normaliza_para_hifen():
    assert extrair_cep("o cep aqui de casa e 26703 384") == "26703-384"


def test_extrair_cep_ausente_devolve_none():
    assert extrair_cep("Oi, queria fazer um seguro pro meu carro") is None


# --- Telefone internacional (issue #46, PR 2 de 2, item 4 do PLANO): a #43 já cobria +55 e o
# formato sem DDI; o chat guiado aceita QUALQUER DDI (1 a 3 dígitos) + 6 a 14 dígitos (E.164-ish).
# Nascem vermelhos contra o padrão fixo em +55 de hoje, antes de generalizar o regex. ---


def test_telefone_eua_ddi_1_e_redigido():
    saida = redigir_texto("pode me chamar no +1 2025550123 a tarde")
    assert "+1 2025550123" not in saida


def test_telefone_portugal_ddi_351_e_redigido():
    saida = redigir_texto("meu whats é +351 912345678")
    assert "+351 912345678" not in saida


def test_telefone_argentina_ddi_54_e_redigido():
    saida = redigir_texto("aqui é +54 91123456789, formato usado no chat/protótipo")
    assert "+54 91123456789" not in saida


def test_extrair_cep_nao_deixa_o_valor_sobreviver_a_redigir_texto():
    """Os dois lados no mesmo teste: o valor extraído (para o estado/`/quote`) e o valor mascarado
    (para o LLM) vêm do MESMO texto bruto — provando que a extração não interfere na máscara."""
    texto = MENSAGENS_REAIS_DO_DATASET[0]
    cep_extraido = extrair_cep(texto)
    texto_mascarado = redigir_texto(texto)
    assert cep_extraido == CEPS_ORIGINAIS[0]
    assert cep_extraido not in texto_mascarado
