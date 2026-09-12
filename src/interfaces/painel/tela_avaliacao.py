"""Tela Avaliação (prioridade 6, escopo #13) — `eval/casos.jsonl` não existe neste repositório
(fica com a F8, issue #11). A ESPECIFICACAO.md §3 é explícita: campo/arquivo ausente na trilha vira
buraco visível na tela, nunca número inventado — aqui o buraco é a tela inteira, com o motivo.
"""

from __future__ import annotations

from pathlib import Path

from interfaces.painel.campos import buraco
from interfaces.painel.layout import css_extra_da_tela, pagina

_CAMINHO_CASOS = Path("eval") / "casos.jsonl"


def render(*, caminho_casos: Path | None = None, caminho_ui_css=None) -> str:
    caminho = caminho_casos or _CAMINHO_CASOS
    existe = Path(caminho).exists()

    corpo = f"""
<div class="cabecalho">
  <div>
    <h1>Avaliação</h1>
    <p>O agente rodando contra conversas derivadas do histórico, com régua versionada.</p>
  </div>
  <span class="chip alerta">sem régua</span>
</div>
<section class="painel">
  <header><h2>{"eval/casos.jsonl" if existe else "eval/casos.jsonl não encontrado"}</h2></header>
  <div style="padding:16px">
    {buraco("eval/casos.jsonl — o conjunto de avaliação é responsabilidade da frente F8 (issue #11) e ainda não existe neste repositório")}
    <p class="nota-rodape" style="margin-top:14px">
      A ESPECIFICACAO.md (§1) descreve o formato esperado (<code>caso_id</code>, <code>entrada</code>,
      <code>decisao_esperada</code>, <code>origem</code>, <code>estado</code>) e o mapa tela→frente dona
      (§4) atribui este arquivo à F8. Esta tela não inventa dado nem régua — mostra o buraco.</p>
  </div>
</section>
"""
    return pagina(titulo="Avaliação", pagina_ativa="avaliacao.html", corpo=corpo, caminho_ui_css=caminho_ui_css,
                  css_extra=css_extra_da_tela("avaliacao.html"))
