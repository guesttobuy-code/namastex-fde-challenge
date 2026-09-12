"""Mascaramento de PII na fronteira (issue #7). Nada é escrito em trilha ou log sem passar por
`redigir_texto` primeiro — ver `aplicacao/servico_trilha.py`, que é a porta que garante isso.

Toda regex é `(?i)`: o `.capitalize()` de `scripts/generate_dataset.py:113` baixa `CPF`/`CEP` para
minúsculo sempre que não são a primeira palavra do bloco (medido ao vivo, PLANO da #7) — uma regex
sem `(?i)` passaria num teste ingênuo e vazaria o valor real.

Limite declarado (issue #7, "Limite que tem que ficar declarado"): a varredura só pega os formatos
medidos no dataset e nas fixtures manuais desta suíte — CPF sem pontuação, telefone sem `+55`, CEP
com espaço e placa no padrão antigo. Formato fora dessa lista pode não ser pego. Nome próprio não usa
NER: só redige o que está em `nomes_conhecidos`, quando o chamador informa (ex.: o `sender_name` da
conversa) — sem essa lista, nome próprio passa intacto.
"""

from __future__ import annotations

import re

MASCARA = "[REDIGIDO]"

_PADROES = (
    re.compile(r"(?i)\b[\w.+-]+@[\w-]+\.[a-z.]{2,}\b"),  # e-mail
    re.compile(r"(?i)\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),  # CPF com pontuação
    re.compile(r"(?i)\+?55\s?\d{2}\s?9?\d{4}-\d{4}\b"),  # telefone com ou sem +55
    re.compile(r"(?i)\b\d{2}\s?9\d{4}-\d{4}\b"),  # telefone sem DDI (fixture manual)
    re.compile(r"(?i)\b[a-z]{3}\d[a-z]\d{2}\b"),  # placa Mercosul
    re.compile(r"(?i)\b[a-z]{3}-?\d{4}\b"),  # placa padrão antigo (fixture manual)
    re.compile(r"(?i)\b\d{5}-\d{3}\b"),  # CEP com hífen
    re.compile(r"(?i)\b\d{5}\s\d{3}\b"),  # CEP com espaço (fixture manual)
    re.compile(r"(?i)\b\d{11}\b"),  # CPF sem pontuação (fixture manual) — por último: mais genérico
)


def redigir_texto(texto: str, nomes_conhecidos: list[str] | None = None) -> str:
    saida = texto
    for padrao in _PADROES:
        saida = padrao.sub(MASCARA, saida)
    for nome in nomes_conhecidos or []:
        saida = re.sub(re.escape(nome), MASCARA, saida, flags=re.IGNORECASE)
    return saida
