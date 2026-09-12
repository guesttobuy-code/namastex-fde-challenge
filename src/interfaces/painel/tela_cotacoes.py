"""Tela Cotações (prioridade 2, escopo #13) — a história do retry: uma linha por TENTATIVA, não
por cotação, com latência e orçamento restante. Estatísticas (sucesso, latência, chamadas por
cotação) são agregação simples sobre os eventos reais — não regra de negócio, não vem do serviço.
"""

from __future__ import annotations

from interfaces.painel.agrupar import agrupar_tentativas_em_cotacoes
from interfaces.painel.campos import buraco, campo, esc, resposta_http_textual
from interfaces.painel.layout import css_extra_da_tela, pagina


def render(eventos: list[dict], *, caminho_ui_css=None) -> str:
    tentativas = [e for e in eventos if e.get("evento") == "tentativa_de_cotacao"]
    grupos_de_cotacao = agrupar_tentativas_em_cotacoes(eventos)

    corpo = f"""
<div class="cabecalho">
  <div>
    <h1>Cotações</h1>
    <p>A saúde da integração com o serviço de cotação. Cada linha é uma TENTATIVA — a história do retry,
       não só o resultado final.</p>
  </div>
  <span class="chip neutra mono">fonte: trilha JSONL</span>
</div>
{_kpis(tentativas, grupos_de_cotacao)}
<section class="painel">
  <header><h2>Tentativas</h2><span class="aux">{len(tentativas)} tentativa(s) em {len(grupos_de_cotacao)} cotação(ões)</span></header>
  {_tabela_tentativas(tentativas)}
</section>
<p class="nota-rodape"><strong>Gerado da trilha real.</strong> Nenhum número aqui é estimado — cada um vem de
  agregação simples sobre os eventos `tentativa_de_cotacao` gravados.</p>
"""
    return pagina(titulo="Cotações", pagina_ativa="cotacoes.html", corpo=corpo, caminho_ui_css=caminho_ui_css,
                  css_extra=css_extra_da_tela("cotacoes.html"))


def _kpis(tentativas: list[dict], grupos_de_cotacao: list[list[dict]]) -> str:
    if not tentativas:
        return f'<div class="kpis"><div class="kpi">{buraco("tentativa_de_cotacao")}</div></div>'

    total_cotacoes = len(grupos_de_cotacao)
    cotacoes_com_sucesso = sum(
        1 for grupo in grupos_de_cotacao if any(t.get("classificacao") == "sucesso" for t in grupo)
    )
    taxa_sucesso = 100 * cotacoes_com_sucesso / total_cotacoes if total_cotacoes else None
    chamadas_por_cotacao = len(tentativas) / total_cotacoes if total_cotacoes else None
    falhas = sum(1 for t in tentativas if t.get("classificacao") != "sucesso")
    taxa_falha = 100 * falhas / len(tentativas)
    latencias = sorted(t.get("latencia_ms") for t in tentativas if isinstance(t.get("latencia_ms"), (int, float)))

    def _fmt_pct(valor: float | None) -> str:
        return f"{valor:.1f}%" if valor is not None else buraco("latencia_ms")

    return f"""<div class="kpis">
      <div class="kpi"><div class="rotulo">Sucesso</div><div class="valor">{_fmt_pct(taxa_sucesso)}</div>
        <div class="nota">{cotacoes_com_sucesso} de {total_cotacoes} cotações</div></div>
      <div class="kpi"><div class="rotulo">Latência (mediana)</div><div class="valor">{esc(_mediana(latencias))} ms</div>
        <div class="nota">máx {esc(max(latencias)) if latencias else buraco("latencia_ms")} ms</div></div>
      <div class="kpi"><div class="rotulo">Chamadas por cotação</div>
        <div class="valor">{f"{chamadas_por_cotacao:.2f}" if chamadas_por_cotacao else buraco("tentativa_de_cotacao")}</div></div>
      <div class="kpi perigo"><div class="rotulo">Falhas do legado</div><div class="valor">{_fmt_pct(taxa_falha)}</div>
        <div class="nota">absorvidas por retry</div></div>
    </div>"""


def _mediana(valores: list[float]) -> str:
    if not valores:
        return buraco("latencia_ms")
    meio = len(valores) // 2
    if len(valores) % 2:
        return str(valores[meio])
    return str((valores[meio - 1] + valores[meio]) / 2)


def _tabela_tentativas(tentativas: list[dict]) -> str:
    if not tentativas:
        return f'<div style="padding:14px 16px">{buraco("tentativa_de_cotacao")}</div>'
    linhas = []
    for tentativa in tentativas:
        classe = "ok" if tentativa.get("classificacao") == "sucesso" else "falha"
        linhas.append(f"""<tr>
          <td class="mono">{campo(tentativa, "quote_attempt_id")}·{campo(tentativa, "numero_da_tentativa")}</td>
          <td class="mono">{campo(tentativa, "conversation_id")}</td>
          <td class="mono">{resposta_http_textual(tentativa)}</td>
          <td class="num">{campo(tentativa, "latencia_ms")} ms</td>
          <td><span class="chip {classe}">{campo(tentativa, "classificacao")}</span></td>
          <td class="num">{campo(tentativa, "orcamento_restante_ms")} ms restantes</td>
        </tr>""")
    return f"""<table>
      <thead><tr><th>Id</th><th>Conversa</th><th>Resposta</th><th class="num">Latência</th><th>Classificação</th><th class="num">Orçamento</th></tr></thead>
      <tbody>{"".join(linhas)}</tbody>
    </table>"""
