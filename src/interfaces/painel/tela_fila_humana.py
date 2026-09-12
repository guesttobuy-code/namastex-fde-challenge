"""Tela Fila humana (escopo #13) — toda conversa com `handoff` na trilha, com o motivo e o
`contexto_coletado` que a trilha gravou. Sem servidor: os botões de ação do mock (regra 4) ficam
visivelmente desabilitados, com o motivo escrito ao lado, em vez de fingir que funcionam.
"""

from __future__ import annotations

from dominio.decisao import MotivoHandoff

from interfaces.painel.agrupar import agrupar_por_conversa
from interfaces.painel.campos import buraco, campo, esc
from interfaces.painel.layout import css_extra_da_tela, pagina

_DESCRICAO_MOTIVO = {
    MotivoHandoff.QUOTE_INDISPONIVEL.value: "Cotação indisponível: o serviço de cotação falhou de forma persistente.",
    MotivoHandoff.QUOTE_TIMEOUT.value: "Cotação expirou: orçamento de tempo esgotado sem resposta.",
    MotivoHandoff.QUOTE_ERRO_DE_PAYLOAD.value: "Erro de payload nosso (400) — não repete, registra e passa adiante.",
}


def render(eventos: list[dict], *, caminho_ui_css=None) -> str:
    por_conversa = agrupar_por_conversa(eventos)
    handoffs = []
    for conversation_id, eventos_conversa in por_conversa.items():
        for evento in eventos_conversa:
            if evento.get("evento") == "handoff":
                handoffs.append((conversation_id, evento))

    cartoes = "\n".join(_cartao(cid, ev) for cid, ev in handoffs) if handoffs else f'<div class="painel"><div style="padding:14px 16px">{buraco("handoff")}</div></div>'
    regras = "\n".join(
        f'<div class="regra"><code>{esc(valor)}</code><p>{esc(_DESCRICAO_MOTIVO.get(valor, "sem descrição registrada"))}</p></div>'
        for valor in [m.value for m in MotivoHandoff]
    )

    corpo = f"""
<div class="cabecalho">
  <div>
    <h1>Fila humana</h1>
    <p>Toda conversa encaminhada chega aqui com o motivo escrito e o contexto já coletado.</p>
  </div>
  <span class="chip alerta">{len(handoffs)} encaminhada(s) na trilha</span>
</div>
{cartoes}
<section class="painel" style="margin-top:20px">
  <header><h2>Quando o agente encaminha</h2><span class="aux">{esc(MotivoHandoff.__name__)} — {len(list(MotivoHandoff))} motivo(s) implementado(s)</span></header>
  <div style="padding:14px 16px"><div class="regras">{regras}</div></div>
</section>
<p class="nota-rodape"><strong>Gerado da trilha real.</strong> Botões de ação exigem servidor, fora do escopo desta
  frente — aparecem desabilitados, com o motivo ao lado, em vez de prometer o que não existe (ESPECIFICACAO.md §3).</p>
"""
    return pagina(titulo="Fila humana", pagina_ativa="handoffs.html", corpo=corpo,
                  contagens={"fila": len(handoffs)}, caminho_ui_css=caminho_ui_css,
                  css_extra=css_extra_da_tela("handoffs.html"))


def _cartao(conversation_id: str, evento: dict) -> str:
    contexto = evento.get("contexto_coletado")
    contexto_html = (
        ", ".join(f"{esc(k)}: {esc(v)}" for k, v in contexto.items())
        if isinstance(contexto, dict) and contexto
        else buraco("contexto_coletado")
    )
    return f"""<section class="cartao">
      <div class="topo-c"><h3>{esc(conversation_id)}</h3><span class="chip alerta">{esc(evento.get("instante"))}</span></div>
      <div class="motivo">reason_code: {campo(evento, "reason_code")}</div>
      <div class="contexto"><b>Já coletado:</b> {contexto_html}<br>
        <b>Última mensagem ao lead:</b> "{campo(evento, "mensagem_ao_lead")}"</div>
      <div class="acoes">
        <button class="botao" disabled title="requer servidor — fora do escopo desta frente">Assumir atendimento</button>
        <button class="botao" disabled title="requer servidor — fora do escopo desta frente">Tentar cotar de novo</button>
      </div>
    </section>"""
