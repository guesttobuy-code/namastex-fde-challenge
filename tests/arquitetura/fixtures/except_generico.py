"""Fixture ruim: except Exception genérico demais. Prova que BLE001 morde."""


def le_arquivo_com_except_generico(caminho: str) -> str:
    try:
        with open(caminho) as f:
            return f.read()
    except Exception:
        return ""
