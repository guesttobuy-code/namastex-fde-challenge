"""Fixture ruim: dívida marcada sem link de issue. Prova que TD003/FIX002 mordem."""


def calcula_desconto(valor: float) -> float:
    # TODO: revisar a regra de desconto quando o dataset novo chegar
    # FIXME: este calculo esta errado para valores negativos
    return valor * 0.9
