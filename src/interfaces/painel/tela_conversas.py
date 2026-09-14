"""Tela Histórico de atendimentos (índice, escopo #13) — o atendimento como o lead vê: só
`mensagem_recebida`, `mensagem_enviada` e `decisao`. A prova de proveniência mora no Rastreio; aqui
é o tom da conversa.

Renomeada de "Conversas" para "Histórico de atendimentos" na issue #46 (PR 1/2, achado B2 da
auditoria do PR #47): o rótulo "Conversas" no menu agora é o chat centralizado (`/`, PR 2); esta
tela — a lista de conversas já gravadas na trilha — precisa dizer o que é, senão o título contradiz
o item ativo no menu.

Issue #57 (P14, PR 2 de 2) acrescenta, sem mexer no que já existia: (1) filtro client-side pelos 5
status oficiais (`data-status` por item + `<select>`, S10); (2) botões "Assumir"/"Encerrar"
chamando `POST /api/conversa/{assumir,encerrar}` (`interfaces.rotas_status_conversa`), habilitados
só quando `dominio.status_conversa` permite a transição — a mesma decisão do servidor, nunca uma
segunda regra em JS; (3) contato do lead e motivo do handoff em linguagem simples (S12,
`interfaces.painel.motivos`, dono único); (4) caixa de entrada de verdade (S13, pedido do dono ao
testar a tela): lista à esquerda, UMA conversa por vez à direita — a mais recente (última a
aparecer na trilha) por padrão, com `hidden` nas outras (armadilha do mock: só funciona com
`[hidden]{display:none!important}`, já em `docs/design/ui.css`); clicar na lista seleciona,
atualiza `location.hash` (`#<conversation_id>`, sobrevive a recarregar) e reage ao filtro (S10) —
se a selecionada sair do filtro, a primeira visível assume.

Issue #86 (atendimento contínuo, ainda não implementada): o cabeçalho da conversa selecionada é o
ponto de extensão para a caixa de resposta do corretor — por isso os botões Assumir/Encerrar já
chamam o caso de uso da aplicação (nunca uma regra em JS), e o cabeçalho fica isolado em
`_secao_conversa` pronto para ganhar um rodapé de resposta num PR futuro, sem precisar desta tela
ser reescrita."""

from __future__ import annotations

from dominio.contato_lead import ContatoLead
from dominio.status_conversa import StatusDaConversa, pode_assumir, pode_encerrar
from interfaces.painel.agrupar import agrupar_por_conversa, classe_chip_do_estado, estado_da_conversa, rotulo_de_exibicao
from interfaces.painel.campos import buraco, campo, esc
from interfaces.painel.layout import css_extra_da_tela, pagina
from interfaces.painel.motivos import descricao_do_motivo

_EVENTOS_RELEVANTES = {"mensagem_recebida", "mensagem_enviada", "decisao"}

_OPCOES_FILTRO = (
    ("", "Todos os status"),
    (StatusDaConversa.COM_O_AGENTE.value, rotulo_de_exibicao(StatusDaConversa.COM_O_AGENTE.value)),
    (StatusDaConversa.COTADA.value, rotulo_de_exibicao(StatusDaConversa.COTADA.value)),
    (StatusDaConversa.AGUARDANDO_CORRETOR.value, rotulo_de_exibicao(StatusDaConversa.AGUARDANDO_CORRETOR.value)),
    (StatusDaConversa.EM_ATENDIMENTO_HUMANO.value, rotulo_de_exibicao(StatusDaConversa.EM_ATENDIMENTO_HUMANO.value)),
    (StatusDaConversa.ENCERRADA.value, rotulo_de_exibicao(StatusDaConversa.ENCERRADA.value)),
)

_JS = """
function selecionarConversa(alvo, atualizarHash) {
  document.querySelectorAll(".conversa").forEach(function (s) { s.hidden = s.id !== alvo; });
  document.querySelectorAll(".item[data-status]").forEach(function (it) {
    it.classList.toggle("selecionado", it.getAttribute("data-alvo") === alvo);
  });
  if (atualizarHash !== false) window.location.hash = alvo;
}
function itensVisiveis() {
  return Array.prototype.filter.call(document.querySelectorAll(".item[data-status]"), function (it) { return !it.hidden; });
}
function filtrarPorStatus(status) {
  document.querySelectorAll(".item[data-status]").forEach(function (item) {
    item.hidden = !(!status || item.getAttribute("data-status") === status);
  });
  var visiveis = itensVisiveis();
  var selecionado = document.querySelector(".item.selecionado");
  var aindaValido = selecionado && !selecionado.hidden;
  if (!aindaValido) {
    if (visiveis.length) selecionarConversa(visiveis[0].getAttribute("data-alvo"), false);
    else document.querySelectorAll(".conversa").forEach(function (s) { s.hidden = true; });
  }
}
function transicaoDeStatus(conversationId, rota) {
  fetch(rota, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation_id: conversationId }),
  }).then(function (resposta) {
    if (resposta.ok) { window.location.reload(); return; }
    return resposta.json().then(function (corpo) { alert(corpo.erro || "Não foi possível concluir a ação."); });
  }).catch(function () { alert("Não consegui falar com o servidor agora."); });
}
(function () {
  var params = new URLSearchParams(window.location.search);
  var status = params.get("status");
  var select = document.getElementById("filtro-status");
  if (status && select) select.value = status;
  filtrarPorStatus(select ? select.value : "");
  var hash = window.location.hash.replace("#", "");
  if (hash) {
    var item = document.querySelector('.item[data-alvo="' + hash + '"]');
    if (item && !item.hidden) selecionarConversa(hash, false);
  }
})();
"""


def render(eventos: list[dict], *, caminho_ui_css=None, contatos: dict[str, ContatoLead] | None = None) -> str:
    por_conversa = agrupar_por_conversa(eventos)
    contatos = contatos or {}
    # S13: "a mais recente" por padrão — a última conversa a aparecer na trilha (ordem de
    # `agrupar_por_conversa`, primeira aparição de cada `conversation_id`). Sem timestamp de
    # ATIVIDADE por conversa na trilha hoje, é o sinal mais simples e honesto disponível.
    conversation_ids = list(por_conversa.keys())
    selecionada_inicial = conversation_ids[-1] if conversation_ids else None

    nav_itens = []
    secoes = []
    for conversation_id, eventos_conversa in por_conversa.items():
        estado = estado_da_conversa(eventos_conversa)
        rotulo = rotulo_de_exibicao(estado)
        primeira_mensagem = next((e for e in eventos_conversa if e.get("evento") == "mensagem_recebida"), None)
        previa = campo(primeira_mensagem, "texto") if primeira_mensagem else buraco("mensagem_recebida")
        classe_selecionado = " selecionado" if conversation_id == selecionada_inicial else ""
        nav_itens.append(f"""<button class="item{classe_selecionado}" data-status="{esc(estado)}" data-alvo="{esc(conversation_id)}" onclick="selecionarConversa('{esc(conversation_id)}')">
          <span class="l1"><span class="nome">{esc(conversation_id)}</span></span>
          <span class="previa">{previa}</span>
          <span class="chip {esc(classe_chip_do_estado(estado))}" style="margin-top:6px">{esc(rotulo)}</span>
        </button>""")
        oculta = conversation_id != selecionada_inicial
        secoes.append(_secao_conversa(conversation_id, eventos_conversa, estado, contatos.get(conversation_id), oculta))

    lista_nav = "\n".join(nav_itens) if nav_itens else f'<div style="padding:14px 16px">{buraco("conversas")}</div>'
    corpo_secoes = "\n".join(secoes) if secoes else buraco("eventos da trilha")
    opcoes_html = "\n".join(f'<option value="{esc(valor)}">{esc(rotulo)}</option>' for valor, rotulo in _OPCOES_FILTRO)

    corpo = f"""
<div class="cabecalho">
  <div>
    <h1>Histórico de atendimentos</h1>
    <p>As conversas já registradas na trilha. A prova do que aconteceu fica no <a href="rastreio.html">Rastreio</a>.</p>
  </div>
  <span class="chip viva">{len(por_conversa)} conversa(s) na trilha</span>
</div>
<div class="duas">
  <nav class="painel" aria-label="Lista de conversas">
    <header><h2>Caixa de entrada</h2>
      <select id="filtro-status" aria-label="Filtrar por status" onchange="filtrarPorStatus(this.value)">
        {opcoes_html}
      </select>
    </header>
    {lista_nav}
  </nav>
  <div style="display:grid;gap:16px">
    {corpo_secoes}
  </div>
</div>
<p class="nota-rodape"><strong>Gerado da trilha real.</strong> Campo que a trilha não gravou aparece como buraco visível.</p>
<script>{_JS}</script>
"""
    return pagina(titulo="Histórico de atendimentos", pagina_ativa="/painel/index.html", corpo=corpo,
                  contagens={"conversas": len(por_conversa)}, caminho_ui_css=caminho_ui_css,
                  css_extra=css_extra_da_tela("index.html"))


def _card_contato_e_motivo(eventos: list[dict], contato: ContatoLead | None) -> str:
    """S12 do roteiro de aceite (#57): motivo do último `handoff` em linguagem simples + contato do
    lead — o que `tela_fila_humana` já mostra hoje, replicado aqui pra não sumir do corretor quando
    a página antiga sair. `contato=None` mostra "não informado" (mesma regra de `tela_fila_humana`,
    C.3 da issue #46: contato pode legitimamente não ter sido coletado, não é buraco da trilha)."""
    handoffs = [e for e in eventos if e.get("evento") == "handoff"]
    if not handoffs:
        return ""
    descricao = descricao_do_motivo(handoffs[-1].get("reason_code"))
    nome = esc(contato.nome) if contato and contato.nome else "não informado"
    whatsapp = esc(contato.whatsapp) if contato and contato.whatsapp else "não informado"
    return f"""<div class="motivo">{esc(descricao)}</div>
      <div class="contato"><b>Nome:</b> {nome}<br><b>WhatsApp:</b> {whatsapp}</div>"""


def _botoes_de_transicao(conversation_id: str, estado: str) -> str:
    status = StatusDaConversa(estado)
    desabilitar_assumir = "" if pode_assumir(status) else "disabled"
    desabilitar_encerrar = "" if pode_encerrar(status) else "disabled"
    cid = esc(conversation_id)
    return f"""<div class="acoes">
        <button class="botao principal" {desabilitar_assumir} onclick="transicaoDeStatus('{cid}', '/api/conversa/assumir')">Assumir</button>
        <button class="botao" {desabilitar_encerrar} onclick="transicaoDeStatus('{cid}', '/api/conversa/encerrar')">Encerrar</button>
      </div>"""


def _secao_conversa(
    conversation_id: str, eventos: list[dict], estado: str, contato: ContatoLead | None, oculta: bool
) -> str:
    balões = []
    for evento in eventos:
        tipo = evento.get("evento")
        if tipo == "mensagem_recebida":
            balões.append(f"""<div class="msg lead"><div class="balao">{campo(evento, "texto")}</div>
              <div class="rodape-msg"><span>{esc(evento.get("instante"))}</span><span>{esc(evento.get("id"))}</span></div></div>""")
        elif tipo == "mensagem_enviada":
            balões.append(f"""<div class="msg agente"><div class="balao">{campo(evento, "texto")}</div>
              <div class="rodape-msg"><span>{esc(evento.get("instante"))}</span><span>{esc(evento.get("id"))}</span></div></div>""")
    atributo_hidden = " hidden" if oculta else ""
    # Cabeçalho isolado (nome/status/motivo/contato/botões) — ponto de extensão da #86 (atendimento
    # contínuo): um PR futuro acrescenta o rodapé de resposta do corretor aqui, sem reescrever a
    # tela (nenhuma regra nova, só HTML/JS de apresentação).
    return f"""<section class="painel conversa" id="{esc(conversation_id)}" data-status="{esc(estado)}"{atributo_hidden}>
      <header><h2>{esc(conversation_id)}</h2><span class="aux">{esc(rotulo_de_exibicao(estado))}</span></header>
      {_card_contato_e_motivo(eventos, contato)}
      {_botoes_de_transicao(conversation_id, estado)}
      <div class="fluxo">{"".join(balões) if balões else buraco("mensagens")}</div>
    </section>"""
