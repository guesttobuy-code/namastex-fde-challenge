"""Tela Conversas (índice, escopo #13) — o atendimento como o lead vê: só `mensagem_recebida`,
`mensagem_enviada` e `decisao`. A prova de proveniência mora no Rastreio; aqui é o tom da conversa.
"""

from __future__ import annotations

from interfaces.painel.agrupar import agrupar_por_conversa, classe_chip_do_estado, estado_da_conversa
from interfaces.painel.campos import buraco, campo, esc
from interfaces.painel.layout import css_extra_da_tela, pagina

_EVENTOS_RELEVANTES = {"mensagem_recebida", "mensagem_enviada", "decisao"}


def render(eventos: list[dict], *, caminho_ui_css=None) -> str:
    por_conversa = agrupar_por_conversa(eventos)

    nav_itens = []
    secoes = []
    for conversation_id, eventos_conversa in por_conversa.items():
        estado = estado_da_conversa(eventos_conversa)
        primeira_mensagem = next((e for e in eventos_conversa if e.get("evento") == "mensagem_recebida"), None)
        previa = campo(primeira_mensagem, "texto") if primeira_mensagem else buraco("mensagem_recebida")
        nav_itens.append(f"""<button class="item">
          <span class="l1"><span class="nome">{esc(conversation_id)}</span></span>
          <span class="previa">{previa}</span>
          <span class="chip {esc(classe_chip_do_estado(estado))}" style="margin-top:6px">{esc(estado)}</span>
        </button>""")
        secoes.append(_secao_conversa(conversation_id, eventos_conversa, estado))

    lista_nav = "\n".join(nav_itens) if nav_itens else f'<div style="padding:14px 16px">{buraco("conversas")}</div>'
    corpo_secoes = "\n".join(secoes) if secoes else buraco("eventos da trilha")

    corpo = f"""
<div class="cabecalho">
  <div>
    <h1>Conversas</h1>
    <p>O atendimento como o lead vê. A prova do que aconteceu fica no <a href="rastreio.html">Rastreio</a>.</p>
  </div>
  <span class="chip viva">{len(por_conversa)} conversa(s) na trilha</span>
</div>
<div class="duas">
  <nav class="painel" aria-label="Lista de conversas">
    <header><h2>Caixa de entrada</h2><span class="aux">trilha</span></header>
    {lista_nav}
  </nav>
  <div style="display:grid;gap:16px">
    {corpo_secoes}
  </div>
</div>
<p class="nota-rodape"><strong>Gerado da trilha real.</strong> Campo que a trilha não gravou aparece como buraco visível.</p>
"""
    return pagina(titulo="Conversas", pagina_ativa="/painel/index.html", corpo=corpo,
                  contagens={"conversas": len(por_conversa)}, caminho_ui_css=caminho_ui_css,
                  css_extra=css_extra_da_tela("index.html"))


def _secao_conversa(conversation_id: str, eventos: list[dict], estado: str) -> str:
    balões = []
    for evento in eventos:
        tipo = evento.get("evento")
        if tipo == "mensagem_recebida":
            balões.append(f"""<div class="msg lead"><div class="balao">{campo(evento, "texto")}</div>
              <div class="rodape-msg"><span>{esc(evento.get("instante"))}</span><span>{esc(evento.get("id"))}</span></div></div>""")
        elif tipo == "mensagem_enviada":
            balões.append(f"""<div class="msg agente"><div class="balao">{campo(evento, "texto")}</div>
              <div class="rodape-msg"><span>{esc(evento.get("instante"))}</span><span>{esc(evento.get("id"))}</span></div></div>""")
    return f"""<section class="painel conversa" id="{esc(conversation_id)}">
      <header><h2>{esc(conversation_id)}</h2><span class="aux">{esc(estado)}</span></header>
      <div class="fluxo">{"".join(balões) if balões else buraco("mensagens")}</div>
    </section>"""
