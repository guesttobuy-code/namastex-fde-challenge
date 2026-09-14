"""Tela Relatório ("CRM simples de leitura", issue #59) — uma linha por conversa: identificador da
conversa, lead (nome, WhatsApp, e-mail), status, data de entrada, pendência, plano cotado e o
histórico completo, com exportação em CSV. `render()`/`gerar_csv()` recebem as LINHAS já montadas
(status como valor string + rótulo prontos) e NUNCA decidem o que é status — só exibem.
`montar_linhas` (único chamador esperado: `interfaces.painel.gerar`) monta essas linhas a partir da
trilha real, consumindo `dominio.status_conversa`/`interfaces.painel.agrupar`/`interfaces.painel.motivos`
(issue #57 PR 2/2, mergeada) — nunca reimplementa a regra de status/motivo aqui (LEI 11).

Nome/WhatsApp/e-mail do lead (issue #59, comentário 5657857383 — decisão do dono, revoga a
abreviação provisória do PR 1/2): "o csv precisa ser completo com todos os campos, sem exceção" —
`nome` aparece por extenso na TELA e no CSV, sempre; WhatsApp vira link `https://wa.me/<dígitos>`
na tela (nova aba) e o valor puro no CSV; e-mail em texto simples nos dois. Contato ausente (a
conversa ainda não tem `ContatoLead`) mostra "não informado" — nunca `buraco()`: mesma disciplina
de `tela_fila_humana._valor_de_contato` (ADR-0005, C.3), porque contato não é um campo da TRILHA
que possa faltar por erro, é um dado que legitimamente ainda não foi coletado.

Histórico (R10): `montar_historico` lê os eventos de UMA conversa e devolve, em ordem, quem
disse o quê. O remetente vem do campo `sender_role` quando o evento já o tiver (issue #86,
"atendimento contínuo", ainda não implementada — valores combinados com a coordenação: `lead`,
`agente`, `ia`, `corretor`, `sistema`); para `mensagem_enviada` SEM `sender_role` (todo evento
gravado até hoje, antes da #86), cai no fallback por `origem_do_texto` (campo que já existe:
`"redator_deterministico:..."` → agente/robô, `"llm:..."` → IA) — nunca inventa um remetente novo.

Sem mock aprovado: ao contrário das outras seis telas, não existe `docs/design/relatorio.html` —
esta tela nasceu depois do desenho original (o próprio dono pediu "deixa isso por último"). Por
isso `pagina()` recebe `css_extra=""` em vez de `layout.css_extra_da_tela(...)`: inventar um mock
que ninguém aprovou violaria a LEI DO NÃO-CHUTE.
"""

from __future__ import annotations

import csv
import io
import re
from typing import Any

from dominio.redator import valor_br
from interfaces.painel.agrupar import agrupar_por_conversa, estado_da_conversa, rotulo_de_exibicao
from interfaces.painel.campos import MARCADOR_RESPOSTA_VAZIA, campo, data_br, eh_resposta_vazia, esc, texto_da_resposta
from interfaces.painel.layout import pagina
from interfaces.painel.motivos import descricao_do_motivo

_COLUNAS_CSV = ("conversation_id", "lead", "whatsapp", "email", "status", "data_entrada", "pendencia", "plano_cotado", "historico")

# Injeção de fórmula em CSV aberto no Excel (R4, condição 4 da coordenação — comentário 5657544152):
# célula que começa com qualquer um destes ganha um `'` na frente.
_CARACTERES_PERIGOSOS_CSV = ("=", "+", "-", "@", "\t", "\r")

_NAO_INFORMADO = "não informado"
_AINDA_NAO_COTADO = "ainda não cotado"
_SEM_PENDENCIA = "—"

_ROTULO_REMETENTE = {"lead": "Lead", "agente": "Robô", "ia": "IA", "corretor": "Corretor", "sistema": "Sistema"}


def render(linhas: list[dict[str, Any]], *, ordenar_por: str = "data_entrada", caminho_ui_css=None) -> str:
    linhas_ordenadas = _ordenar(linhas, ordenar_por)
    corpo_tabela = (
        "\n".join(_linha_html(linha) for linha in linhas_ordenadas)
        if linhas_ordenadas
        else f'<tr><td colspan="6">{esc("Nenhuma conversa registrada ainda.")}</td></tr>'
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
      <thead><tr><th>Lead</th><th>Status</th><th>Data de entrada</th><th>Pendência</th><th>Plano cotado</th><th>Conversa</th></tr></thead>
      <tbody>
{corpo_tabela}
      </tbody>
    </table>
    <a class="botao" href="relatorio.csv" download>Exportar CSV</a>
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
      <td>{_lead_html(linha)}</td>
      <td>{campo(linha, "status_rotulo")}</td>
      <td>{esc(data_br(linha.get("data_entrada")))}</td>
      <td>{esc(linha.get("pendencia") or _SEM_PENDENCIA)}</td>
      <td>{esc(linha.get("plano_cotado") or _AINDA_NAO_COTADO)}</td>
      <td><code>{esc(linha.get("conversation_id"))}</code><br>{_ver_conversa_html(linha.get("historico"))}</td>
    </tr>"""


def _lead_html(linha: dict[str, Any]) -> str:
    nome = linha.get("nome")
    whatsapp = linha.get("whatsapp")
    email = linha.get("email")
    if not nome and not whatsapp and not email:
        return f"<div>{_NAO_INFORMADO}</div>"
    return f"""<div><b>{esc(nome) if nome else _NAO_INFORMADO}</b></div>
      <div>{_whatsapp_html(whatsapp)}</div>
      <div>{esc(email) if email else _NAO_INFORMADO}</div>"""


def _whatsapp_html(whatsapp: str | None) -> str:
    if not whatsapp:
        return _NAO_INFORMADO
    return f'<a href="{esc(_link_whatsapp(whatsapp))}" target="_blank" rel="noopener">{esc(whatsapp)}</a>'


def _link_whatsapp(whatsapp: str) -> str:
    """`https://wa.me/<dígitos com DDI>` — formato que o wa.me exige."""
    return f"https://wa.me/{_apenas_digitos_whatsapp(whatsapp)}"


def _apenas_digitos_whatsapp(whatsapp: str) -> str:
    """Só dígitos, sem `+`/espaço/hífen/parênteses — dono único, usado no link `wa.me` (tela) e na
    coluna `whatsapp` do CSV (achado da auditoria do PR #94, B4: `+55 11 99999-8888` no CSV virava
    `'+55 11 99999-8888` — a neutralização de fórmula corretamente trata `+` como perigoso; só
    dígitos nunca precisa de neutralização, e é a forma que se usa direto num WhatsApp/planilha)."""
    return re.sub(r"\D", "", whatsapp)


def _ver_conversa_html(historico: list[dict[str, Any]] | None) -> str:
    if not historico:
        return _NAO_INFORMADO
    mensagens = "\n".join(_mensagem_html(msg) for msg in historico)
    return f"<details><summary>Ver conversa</summary><div class=\"historico\">{mensagens}</div></details>"


def _mensagem_html(mensagem: dict[str, Any]) -> str:
    remetente = esc(mensagem.get("remetente"))
    texto = texto_da_resposta(mensagem)
    instante = esc(data_br(mensagem.get("instante")) or "")
    return f'<div class="msg-historico"><b>{remetente}:</b> {texto} <span class="aux">{instante}</span></div>'


def montar_historico(eventos_da_conversa: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Lê os eventos de UMA conversa (na ordem em que a trilha gravou) e devolve
    `[{remetente, texto, instante}, ...]` só para `mensagem_recebida`/`mensagem_enviada` — os
    únicos dois tipos de evento que são efetivamente uma fala na conversa."""
    historico = []
    for evento in eventos_da_conversa:
        tipo = evento.get("evento")
        if tipo not in ("mensagem_recebida", "mensagem_enviada"):
            continue
        historico.append({
            "remetente": _remetente_da_mensagem(evento),
            "texto": evento.get("texto"),
            "instante": evento.get("instante"),
        })
    return historico


def _remetente_da_mensagem(evento: dict[str, Any]) -> str:
    sender_role = evento.get("sender_role")
    if sender_role:
        return _ROTULO_REMETENTE.get(sender_role, sender_role)
    if evento.get("evento") == "mensagem_recebida":
        return _ROTULO_REMETENTE["lead"]
    origem = evento.get("origem_do_texto") or ""
    if origem.startswith("llm:"):
        return _ROTULO_REMETENTE["ia"]
    return _ROTULO_REMETENTE["agente"]


def plano_cotado_da_conversa(eventos_da_conversa: list[dict[str, Any]]) -> str:
    """A ÚLTIMA `tentativa_de_cotacao` com sucesso decide — nunca a primeira nem uma escolhida por
    outro critério (uma conversa pode tentar cotar mais de uma vez, ex.: lead troca de plano).
    Campo estruturado só (`plano_nome`/`premio_mensal` de `dominio.eventos_trilha.TentativaDeCotacao`,
    decisão registrada em `dominio/CONTRACT.md`, 2026-09-14) — nunca lê `mensagem_enviada.texto`."""
    sucessos = [
        e for e in eventos_da_conversa
        if e.get("evento") == "tentativa_de_cotacao" and e.get("classificacao") == "sucesso"
    ]
    if not sucessos:
        return _AINDA_NAO_COTADO
    ultima = sucessos[-1]
    if not ultima.get("plano_nome"):
        return "cotado (plano não registrado nesta trilha)"
    return f"{ultima['plano_nome']} — R$ {valor_br(ultima['premio_mensal'])}/mês"


def montar_linhas(eventos: list[dict[str, Any]], *, contatos: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Monta as linhas reais a partir da trilha — único chamador esperado é `interfaces.painel.gerar`.
    Nunca decide status (`agrupar.estado_da_conversa`/`rotulo_de_exibicao`, dono único desde a
    #57) nem motivo (`motivos.descricao_do_motivo`) — só consome (LEI 11)."""
    contatos = contatos or {}
    linhas = []
    for conversation_id, eventos_conversa in agrupar_por_conversa(eventos).items():
        contato = contatos.get(conversation_id)
        status_valor = estado_da_conversa(eventos_conversa)
        handoffs = [e for e in eventos_conversa if e.get("evento") == "handoff"]
        primeiro = eventos_conversa[0] if eventos_conversa else {}
        linhas.append({
            "conversation_id": conversation_id,
            "nome": contato.nome if contato else None,
            "whatsapp": contato.whatsapp if contato else None,
            "email": contato.email if contato else None,
            "status_valor": status_valor,
            "status_rotulo": rotulo_de_exibicao(status_valor),
            "data_entrada": primeiro.get("instante"),
            "pendencia": descricao_do_motivo(handoffs[-1].get("reason_code")) if handoffs else None,
            "plano_cotado": plano_cotado_da_conversa(eventos_conversa),
            "historico": montar_historico(eventos_conversa),
        })
    return linhas


def gerar_csv(linhas: list[dict[str, Any]]) -> bytes:
    """`;` (decimal do pt-BR é `,`) e BOM UTF-8 (Excel pt-BR não detecta UTF-8 puro) — por isso
    bytes, não str: BOM é um artefato de byte, não de texto. Todas as colunas da tela, mais o
    histórico (decisão do dono, comentário 5657857383: "completo com todos os campos, sem
    exceção") — nome sempre por extenso, igual à tela (a abreviação do PR 1/2 foi revogada)."""
    buffer = io.StringIO()
    escritor = csv.writer(buffer, delimiter=";")
    escritor.writerow(_COLUNAS_CSV)
    for linha in linhas:
        escritor.writerow([
            _neutralizar_formula_csv(linha.get("conversation_id") or ""),
            _neutralizar_formula_csv(linha.get("nome") or _NAO_INFORMADO),
            _apenas_digitos_whatsapp(linha["whatsapp"]) if linha.get("whatsapp") else _NAO_INFORMADO,
            _neutralizar_formula_csv(linha.get("email") or _NAO_INFORMADO),
            _neutralizar_formula_csv(linha.get("status_rotulo") or ""),
            _neutralizar_formula_csv(data_br(linha.get("data_entrada")) or ""),
            _neutralizar_formula_csv(linha.get("pendencia") or _SEM_PENDENCIA),
            _neutralizar_formula_csv(linha.get("plano_cotado") or _AINDA_NAO_COTADO),
            _neutralizar_formula_csv(_historico_csv(linha.get("historico"))),
        ])
    return buffer.getvalue().encode("utf-8-sig")


def _historico_csv(historico: list[dict[str, Any]] | None) -> str:
    if not historico:
        return _NAO_INFORMADO
    return " | ".join(f"{msg.get('remetente')}: {_texto_csv(msg)}" for msg in historico)


def _texto_csv(mensagem: dict[str, Any]) -> str:
    """Versão em texto puro de `campos.texto_da_resposta`, pro CSV — mesma checagem
    (`campos.eh_resposta_vazia`, dono único, LEI 11) e o mesmo marcador
    (`campos.MARCADOR_RESPOSTA_VAZIA`), sem o `<span>` do HTML."""
    if eh_resposta_vazia(mensagem):
        return MARCADOR_RESPOSTA_VAZIA
    return mensagem.get("texto") or ""


def _neutralizar_formula_csv(valor: Any) -> str:
    texto = str(valor)
    if texto and texto[0] in _CARACTERES_PERIGOSOS_CSV:
        return f"'{texto}"
    return texto
