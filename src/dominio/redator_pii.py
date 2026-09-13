"""Mascaramento de PII na fronteira (issue #7). Nada é escrito em trilha ou log sem passar por
`redigir_texto` primeiro — ver `aplicacao/servico_trilha.py`, que é a porta que garante isso.

`extrair_cep` (issue #9, F6) é a exceção deliberada: o CEP é PII e nunca vai ao LLM, mas a `/quote`
precisa dele para cotar. Por isso ele é extraído do texto BRUTO, com os MESMOS padrões que
`redigir_texto` usa para reconhecer o formato (nunca duplicados — LEI 11), ANTES do mascaramento —
e só o valor extraído localmente atravessa para o estado da conversa e para a `/quote`.

O `.capitalize()` de `scripts/generate_dataset.py:113` baixa `CPF`/`CEP` para minúsculo sempre que
não são a primeira palavra do bloco (medido ao vivo, PLANO da #7). Por isso a extração NUNCA usa a
palavra "CPF"/"CEP" como âncora — cada padrão casa pelo FORMATO do valor (dígitos e separadores),
que não tem maiúscula/minúscula. `(?i)` continua em todo padrão por consistência e porque ele É
load-bearing em dois lugares que têm letra: a placa (`[a-z]{3}...` só bate com "GGE4X30" maiúsculo
com a flag ligada — conferido ao vivo, teste some se a flag sai de só esse padrão) e o nome próprio
(`re.IGNORECASE` no loop de `nomes_conhecidos`, para casar independente de como o nome apareceu na
frase). Nos padrões só-dígito (CPF, CEP, telefone) a flag é redundante, não corretiva.

Limite declarado (issue #7, "Limite que tem que ficar declarado"): a varredura só pega os formatos
medidos no dataset e nas fixtures manuais desta suíte — CPF sem pontuação, telefone sem `+55`, CEP
com espaço e placa no padrão antigo. Formato fora dessa lista pode não ser pego. Nome próprio não usa
NER: só redige o que está em `nomes_conhecidos`, quando o chamador informa (ex.: o `sender_name` da
conversa) — sem essa lista, nome próprio passa intacto.
"""

from __future__ import annotations

import re

MASCARA = "[REDIGIDO]"

_PADRAO_CEP_HIFEN = re.compile(r"(?i)\b\d{5}-\d{3}\b")  # CEP com hífen
_PADRAO_CEP_ESPACO = re.compile(r"(?i)\b\d{5}\s\d{3}\b")  # CEP com espaço (fixture manual)

_PADROES = (
    re.compile(r"(?i)\b[\w.+-]+@[\w-]+\.[a-z.]{2,}\b"),  # e-mail
    re.compile(r"(?i)\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),  # CPF com pontuação
    re.compile(r"(?i)\+?55\s?\d{2}\s?9?\d{4}-\d{4}\b"),  # telefone com ou sem +55
    re.compile(r"(?i)\b\d{2}\s?9\d{4}-\d{4}\b"),  # telefone sem DDI (fixture manual)
    re.compile(r"(?i)\b[a-z]{3}\d[a-z]\d{2}\b"),  # placa Mercosul
    re.compile(r"(?i)\b[a-z]{3}-?\d{4}\b"),  # placa padrão antigo (fixture manual)
    _PADRAO_CEP_HIFEN,
    _PADRAO_CEP_ESPACO,
    re.compile(r"(?i)\b\d{11}\b"),  # CPF sem pontuação (fixture manual) — por último: mais genérico
)


def redigir_texto(texto: str, nomes_conhecidos: list[str] | None = None) -> str:
    saida = texto
    for padrao in _PADROES:
        saida = padrao.sub(MASCARA, saida)
    for nome in nomes_conhecidos or []:
        saida = re.sub(re.escape(nome), MASCARA, saida, flags=re.IGNORECASE)
    return saida


def extrair_cep(texto: str) -> str | None:
    """Acha o primeiro CEP no texto BRUTO (mesmos padrões de `_PADROES`, nunca duplicados),
    normalizado para o formato `00000-000` — o mesmo que `dominio.validacao.cep_valido` aceita e
    que a CLI já pede. Devolve `None` se nenhum CEP reconhecível aparecer."""
    encontrado = _PADRAO_CEP_HIFEN.search(texto)
    if encontrado:
        return encontrado.group(0)
    encontrado = _PADRAO_CEP_ESPACO.search(texto)
    if encontrado:
        return encontrado.group(0).replace(" ", "-")
    return None
