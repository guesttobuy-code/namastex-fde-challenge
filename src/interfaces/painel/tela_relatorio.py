"""Tela Relatório ("CRM simples de leitura", issue #59, PR 1/2) — uma linha por conversa: lead,
status, data de entrada, pendência e plano cotado, com exportação em CSV. `render()`/`gerar_csv()`
recebem as LINHAS já montadas (status como valor string + rótulo prontos) e NUNCA decidem o que é
status — só exibem. A montagem real a partir da trilha e do módulo oficial de status
(`dominio.status_conversa`, issue #57 PR 2/2, ainda não mergeada) e a ligação com `layout.py`/
`gerar.py` (item de menu) ficam para o PR 2/2 desta frente: importar esse módulo aqui hoje
duplicaria a regra antes mesmo dela existir em commit alcançável (LEI 11).

Nome do lead (decisão da coordenação até o dono decidir diferente, comentário 5657544152 da #59):
`_nome_para_exibicao` é o dono único da regra — a tela mostra o nome completo (como a Fila humana,
ADR-0005 C.3, tela interna do corretor), o CSV mostra abreviado (o arquivo sai do sistema, sem
WhatsApp/e-mail).

Sem mock aprovado: ao contrário das outras seis telas, não existe `docs/design/relatorio.html` —
esta tela nasceu depois do desenho original (o próprio dono pediu "deixa isso por último"). Por
isso `pagina()` recebe `css_extra=""` em vez de `layout.css_extra_da_tela(...)`: inventar um mock
que ninguém aprovou violaria a LEI DO NÃO-CHUTE.
"""

from __future__ import annotations

import csv
import io
from typing import Any

from interfaces.painel.campos import buraco, campo, esc
from interfaces.painel.layout import pagina

_COLUNAS_CSV = ("lead", "status", "data_entrada", "pendencia", "plano_cotado")

# Injeção de fórmula em CSV aberto no Excel (R4, condição 4 da coordenação — comentário 5657544152):
# célula que começa com qualquer um destes ganha um `'` na frente.
_CARACTERES_PERIGOSOS_CSV = ("=", "+", "-", "@", "\t", "\r")


def render(linhas: list[dict[str, Any]], *, ordenar_por: str = "data_entrada", caminho_ui_css=None) -> str:
    linhas_ordenadas = _ordenar(linhas, ordenar_por)
    corpo_tabela = (
        "\n".join(_linha_html(linha) for linha in linhas_ordenadas)
        if linhas_ordenadas
        else f'<tr><td colspan="5">{esc("Nenhuma conversa registrada ainda.")}</td></tr>'
    )
    corpo = f"""
<div class="cabecalho">
  <div>
    <h1>Relatório</h1>
    <p>Uma linha por conversa: lead, status, data de entrada, pendência e plano cotado — leitura e priorização, nunca edição.</p>
  </div>
  <span class="chip alerta">{len(linhas_ordenadas)} conversa(s)</span>
</div>
<section class="painel">
  <header><h2>Conversas</h2></header>
  <div style="padding:16px">
    <table class="tabela-relatorio">
      <thead><tr><th>Lead</th><th>Status</th><th>Data de entrada</th><th>Pendência</th><th>Plano cotado</th></tr></thead>
      <tbody>
{corpo_tabela}
      </tbody>
    </table>
    <button class="botao" onclick="location.href='relatorio.csv'">Exportar CSV</button>
  </div>
</section>
"""
    return pagina(titulo="Relatório", pagina_ativa="/painel/relatorio.html", corpo=corpo,
                  caminho_ui_css=caminho_ui_css, css_extra="")


def _ordenar(linhas: list[dict[str, Any]], chave: str) -> list[dict[str, Any]]:
    """Ordena por `chave` (ex.: "data_entrada", "status_rotulo") — valor ausente vai para o fim,
    nunca quebra nem inventa data. `sorted` é estável: linhas empatadas mantêm a ordem de entrada."""
    return sorted(linhas, key=lambda linha: (linha.get(chave) is None, linha.get(chave) or ""))


def _linha_html(linha: dict[str, Any]) -> str:
    status_valor = linha.get("status_valor") or ""
    return f"""<tr data-status="{esc(status_valor)}">
      <td>{_nome_html(linha)}</td>
      <td>{campo(linha, "status_rotulo")}</td>
      <td>{campo(linha, "data_entrada")}</td>
      <td>{campo(linha, "pendencia")}</td>
      <td>{campo(linha, "plano_cotado")}</td>
    </tr>"""


def _nome_html(linha: dict[str, Any]) -> str:
    nome = linha.get("nome")
    if not nome:
        return buraco("nome")
    return esc(_nome_para_exibicao(nome, destino="tela"))


def _nome_para_exibicao(nome: str, *, destino: str) -> str:
    """Dono único da exibição do nome (comentário 5657544152 da #59) — muda numa linha só se o dono
    decidir outra regra. `destino="tela"`: nome completo, igual à Fila humana (ADR-0005 C.3), tela
    interna do corretor. `destino="csv"`: abreviado ("João S.") — o arquivo sai do sistema."""
    if destino != "csv":
        return nome
    partes = nome.strip().split()
    if len(partes) <= 1:
        return nome.strip()
    return f"{partes[0]} {partes[-1][0]}."


def gerar_csv(linhas: list[dict[str, Any]]) -> bytes:
    """`;` (decimal do pt-BR é `,`) e BOM UTF-8 (Excel pt-BR não detecta UTF-8 puro) — por isso
    bytes, não str: BOM é um artefato de byte, não de texto."""
    buffer = io.StringIO()
    escritor = csv.writer(buffer, delimiter=";")
    escritor.writerow(_COLUNAS_CSV)
    for linha in linhas:
        nome = linha.get("nome")
        escritor.writerow([
            _neutralizar_formula_csv(_nome_para_exibicao(nome, destino="csv") if nome else ""),
            _neutralizar_formula_csv(linha.get("status_rotulo") or ""),
            _neutralizar_formula_csv(linha.get("data_entrada") or ""),
            _neutralizar_formula_csv(linha.get("pendencia") or ""),
            _neutralizar_formula_csv(linha.get("plano_cotado") or ""),
        ])
    return buffer.getvalue().encode("utf-8-sig")


def _neutralizar_formula_csv(valor: Any) -> str:
    texto = str(valor)
    if texto and texto[0] in _CARACTERES_PERIGOSOS_CSV:
        return f"'{texto}"
    return texto
