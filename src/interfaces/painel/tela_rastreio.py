"""Tela Rastreio (prioridade 1, escopo #13) — todos os eventos de cada conversa, na ordem em que
a trilha os gravou, com a proveniência de cada resposta do agente. É a tela que responde "o que
aconteceu nessa conversa?" só lendo a trilha — nenhum dado fica de fora e nenhum é calculado.

Sem JavaScript: a proveniência abre em `<details>` nativo (clique funciona de verdade, sem prometer
um servidor que não existe — regra 4 do escopo). Sem SPA de conversa única: cada conversa vira uma
seção própria da página, ancorada por id, para o painel funcionar igual com 1 ou com 1000 conversas
sem precisar embutir dado da trilha dentro de um `<script>` (regra 1: texto de fora vira HTML só via
`html.escape`; um `<script>const X=...</script>` teria uma segunda regra de escape, para o contexto
JS, e é exatamente esse tipo de superfície duplicada que este painel evita).
"""

from __future__ import annotations

from interfaces.painel.agrupar import (
    agrupar_por_conversa,
    agrupar_tentativas_por_cotacao,
    classe_chip_do_estado,
    estado_da_conversa,
)
from interfaces.painel.campos import buraco, campo, esc, lista
from interfaces.painel.layout import pagina


def render(eventos: list[dict], *, caminho_ui_css=None) -> str:
    por_conversa = agrupar_por_conversa(eventos)

    nav_itens = []
    secoes = []
    for conversation_id, eventos_conversa in por_conversa.items():
        estado = estado_da_conversa(eventos_conversa)
        nav_itens.append(
            f'<a href="#{esc(conversation_id)}" class="item" style="text-decoration:none;display:block">'
            f'<span class="l1"><span class="nome">{esc(conversation_id)}</span></span>'
            f'<span class="chip {esc(classe_chip_do_estado(estado))}" style="margin-top:6px">{esc(estado)}</span>'
            f"</a>"
        )
        secoes.append(_secao_da_conversa(conversation_id, eventos_conversa, estado))

    lista_nav = "\n".join(nav_itens) if nav_itens else f'<div style="padding:14px 16px">{buraco("conversas")}</div>'
    corpo_secoes = "\n".join(secoes) if secoes else f'<div class="painel"><div style="padding:14px 16px">{buraco("eventos da trilha")}</div></div>'

    corpo = f"""
<div class="cabecalho">
  <div>
    <h1>Rastreio</h1>
    <p>Cada mensagem e cada tentativa de cotação, com id, status e tempo — reconstruído a partir da trilha
       que o agente grava. É aqui que se responde "o que aconteceu nessa conversa?" sem depender de memória.</p>
  </div>
  <span class="chip neutra mono">fonte: trilha JSONL</span>
</div>
<div class="duas">
  <nav class="painel" aria-label="Conversas">
    <header><h2>Conversas</h2><span class="aux">{len(por_conversa)}</span></header>
    {lista_nav}
  </nav>
  <div style="display:grid;gap:16px">
    {corpo_secoes}
  </div>
</div>
<p class="nota-rodape"><strong>Gerado da trilha real.</strong> Nenhum dado nesta tela é fictício ou calculado —
  todo campo vem de um evento gravado pelo agente; campo que a trilha não tem aparece como buraco visível.</p>
"""
    return pagina(titulo="Rastreio", pagina_ativa="rastreio.html", corpo=corpo,
                  contagens={"conversas": len(por_conversa)}, caminho_ui_css=caminho_ui_css)


def _secao_da_conversa(conversation_id: str, eventos: list[dict], estado: str) -> str:
    linhas = [_linha_do_evento(evento, eventos) for evento in eventos]
    return f"""<section class="painel" id="{esc(conversation_id)}">
  <header><h2>{esc(conversation_id)}</h2><span class="aux">{esc(estado)}</span></header>
  <div class="tempo">
    {"".join(linhas)}
  </div>
</section>"""


def _linha_do_evento(evento: dict, eventos_da_conversa: list[dict]) -> str:
    tipo = evento.get("evento")
    if tipo == "mensagem_recebida":
        return _ev_mensagem(evento, "lead", "lead")
    if tipo == "mensagem_enviada":
        return _ev_mensagem_enviada(evento, eventos_da_conversa)
    if tipo == "tentativa_de_cotacao":
        return _ev_cotacao_agrupada(evento, eventos_da_conversa)
    if tipo == "decisao":
        return _ev_decisao(evento)
    if tipo == "handoff":
        return _ev_handoff(evento)
    if tipo in ("erro_marcado", "correcao_registrada"):
        return ""  # anexado à mensagem_enviada correspondente, não numa linha própria
    return f'<div class="ev"><span class="meta">{esc(evento.get("instante"))} · {esc(tipo)} · {esc(evento.get("id"))}</span></div>'


def _ev_mensagem(evento: dict, classe: str, quem: str) -> str:
    return f"""<div class="ev {classe}">
      <div class="meta"><span class="quem">{esc(quem)}</span><span>{esc(evento.get("instante"))}</span><span>{esc(evento.get("id"))}</span></div>
      <div class="balao">{campo(evento, "texto")}</div>
    </div>"""


def _marca_de_erro(mensagem_id: str, eventos_da_conversa: list[dict]) -> str:
    marcados = [e for e in eventos_da_conversa if e.get("evento") == "erro_marcado" and e.get("mensagem_id") == mensagem_id]
    if not marcados:
        return ""
    partes = ['<span title="marcado como erro">⚑</span>']
    for marca in marcados:
        correcoes = [e for e in eventos_da_conversa if e.get("evento") == "correcao_registrada" and e.get("erro_id") == marca.get("id")]
        for correcao in correcoes:
            partes.append(f'<span class="motivo">correção: {campo(correcao, "comportamento_esperado")}</span>')
    return "".join(partes)


def _ev_mensagem_enviada(evento: dict, eventos_da_conversa: list[dict]) -> str:
    marca = _marca_de_erro(evento.get("id"), eventos_da_conversa)
    proveniencia = f"""<details class="proveniencia">
      <summary style="cursor:pointer;padding:8px 13px;color:var(--texto-fraco);font-size:12px">de onde veio esta resposta</summary>
      <div class="corpo">
        <div class="par"><span class="rot">decisão</span><span class="val">{campo(evento, "decisao_id")}</span></div>
        <div class="par"><span class="rot">regra aplicada</span><span class="val">{campo(evento, "regra_aplicada")}</span></div>
        <div class="par"><span class="rot">texto veio de</span><span class="val">{campo(evento, "origem_do_texto")}</span></div>
        <div class="par"><span class="rot">dados usados</span><span class="val">{lista(evento.get("dados_usados"))}</span></div>
      </div>
    </details>"""
    return f"""<div class="ev agente">
      <div class="meta"><span class="quem">agente</span><span>{esc(evento.get("instante"))}</span><span>{esc(evento.get("id"))}</span>{marca}</div>
      <div class="balao">{campo(evento, "texto")}</div>
      {proveniencia}
    </div>"""


def _ev_cotacao_agrupada(evento: dict, eventos_da_conversa: list[dict]) -> str:
    quote_attempt_id = evento.get("quote_attempt_id")
    todas = agrupar_tentativas_por_cotacao(eventos_da_conversa).get(quote_attempt_id, [evento])
    # Só renderiza no primeiro evento do grupo — evita repetir o mesmo bloco por tentativa.
    if todas[0] is not evento:
        return ""
    linhas_tentativa = []
    sucesso = None
    for tentativa in todas:
        ok = tentativa.get("classificacao") == "sucesso"
        if ok:
            sucesso = tentativa
        classe = "boa" if ok else "ruim"
        estado_txt = f'{campo(tentativa, "http_status")} {esc(tentativa.get("classificacao"))}'
        linhas_tentativa.append(
            f'<div class="tent {classe}"><span class="n">{campo(tentativa, "numero_da_tentativa")}ª</span>'
            f'<span class="estado">{estado_txt}</span><span class="ms">{campo(tentativa, "latencia_ms")} ms</span></div>'
        )
    prova = ""
    if sucesso is not None:
        prova = f"""<div class="prova"><header>cotação obtida</header><div class="corpo">
          <div><span class="rot">prêmio</span><div class="val grande">{campo(sucesso, "premio_mensal")}</div></div>
          <div><span class="rot">franquia</span><div class="val">{campo(sucesso, "franquia")}</div></div>
          <div><span class="rot">orçamento restante</span><div class="val">{campo(sucesso, "orcamento_restante_ms")} ms</div></div>
        </div></div>"""
    return f"""<div class="ev cotacao">
      <div class="meta"><span class="quem">cotação</span><span>{esc(evento.get("instante"))}</span><span>{esc(quote_attempt_id)}</span></div>
      <div class="tentativas">{"".join(linhas_tentativa)}</div>
      {prova}
    </div>"""


def _ev_decisao(evento: dict) -> str:
    motivo = evento.get("motivo")
    sufixo = f" — {esc(motivo)}" if motivo else ""
    return f"""<div class="ev decisao">
      <div class="meta"><span class="quem">decisão</span><span>{esc(evento.get("instante"))}</span><span>{esc(evento.get("id"))}</span></div>
      <div class="balao">{campo(evento, "tipo")}{sufixo}</div>
    </div>"""


def _ev_handoff(evento: dict) -> str:
    return f"""<div class="ev handoff">
      <div class="meta"><span class="quem">handoff</span><span>{esc(evento.get("instante"))}</span><span>{esc(evento.get("id"))}</span></div>
      <div class="motivo">reason_code: {campo(evento, "reason_code")}</div>
      <div class="balao">{campo(evento, "mensagem_ao_lead")}</div>
    </div>"""
