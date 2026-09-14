"""Tela Conversas — o chat centralizado (issue #46, PR 2 de 2): a porta de entrada do lead, guiado
e determinístico, SEM LLM (decisão da coordenação — quem avalia não tem chave de LLM). `render()`
só costura a casca compartilhada (`layout.pagina`) com o fragmento estático do chat — nunca decide
fluxo nem regra de negócio por conta própria (LEI 11: quem decide é `aplicacao.servico_conversa`,
por trás das rotas `/api/chat/*` de `interfaces.servidor`; este módulo só monta HTML).

`_corpo.html` é o fragmento (formulário guiado + `<script>` que fala com `/api/planos`,
`/docs/design/paises.json` e `/api/chat/*`) lido do disco, nunca colado aqui — mesma razão de
`interfaces.conhecimento.tela_edicao`: uma cópia divergiria do arquivo real no primeiro ajuste feito
só num dos dois lugares.

Sem `css_extra_da_tela`/mock novo em `docs/design/` (decisão desta frente, documentada no relatório
do PR): o fragmento usa só o `ui.css` compartilhado mais um `<style>` inline pequeno dentro do
próprio `_corpo.html`, para os componentes do chat (balão de mensagem, doca de resposta, cards de
plano) que não têm equivalente nas cinco telas do painel. Dado o prazo da entrega, criar um sétimo
mock estático só para extrair um segundo bloco `<style>` (o padrão que `css_extra_da_tela` espera)
não paga o custo — o resultado visual é o mesmo, só o mecanismo de origem do CSS muda.
"""

from __future__ import annotations

from pathlib import Path

from interfaces.painel.layout import pagina

_CORPO = Path(__file__).resolve().parent / "_corpo.html"


def render(*, caminho_ui_css=None) -> str:
    corpo = _CORPO.read_text(encoding="utf-8")
    return pagina(
        titulo="Conversas",
        pagina_ativa="/",
        corpo=corpo,
        caminho_ui_css=caminho_ui_css,
    )
