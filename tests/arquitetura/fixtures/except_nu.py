"""Fixture ruim: except nu engolindo erro. Prova que E722/BLE001/S110 mordem."""


def le_arquivo_de_configuracao(caminho: str) -> str:
    try:
        with open(caminho) as f:
            return f.read()
    except:
        pass
    return ""
