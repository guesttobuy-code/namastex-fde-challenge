"""Tela Regras e política (escopo #13, regra 3) — nada aqui é redigitado. Os planos vêm de um
`GET /planos` ao vivo no serviço de cotação (buraco se o serviço não estiver de pé); o vocabulário
de handoff vem do Enum `MotivoHandoff` do domínio; a política de retry (3s/3 tentativas/10s) vem de
`src/infra/cliente_quote.py`, que ainda não existe neste repo (PR #35, frente `agente`, aberto e não
mergeado) — até lá, buraco visível. Nunca copiar essas constantes de uma branch não mergeada: seria
a cópia sem dono que a regra 3 do escopo proíbe, só que com prazo de validade.
"""

from __future__ import annotations

from dominio.decisao import MotivoHandoff
from infra.planos_http import buscar_planos

from interfaces.painel.campos import buraco, esc
from interfaces.painel.layout import css_extra_da_tela, pagina


def render(*, base_url_quote_service: str | None = None, caminho_ui_css=None) -> str:
    planos = buscar_planos(base_url_quote_service)

    corpo = f"""
<div class="cabecalho">
  <div>
    <h1>Regras e política</h1>
    <p>O que o agente sabe, e de onde esse conhecimento vem. Nada aqui é recalculado localmente:
       esta tela lê a tabela do serviço de cotação e o Enum do domínio.</p>
  </div>
  <span class="chip neutra mono">fonte: GET /planos + dominio.decisao</span>
</div>
{_secao_planos(planos)}
{_secao_motivos_handoff()}
{_secao_retry()}
<p class="nota-rodape"><strong>Gerado da trilha real.</strong> Esta tela não guarda número em memória —
  cada valor é lido do código ou do serviço no momento da geração.</p>
"""
    return pagina(titulo="Regras e política", pagina_ativa="regras.html", corpo=corpo, caminho_ui_css=caminho_ui_css,
                  css_extra=css_extra_da_tela("regras.html"))


def _secao_planos(planos: dict | None) -> str:
    if planos is None:
        return f'<section class="painel" style="margin-bottom:18px"><div style="padding:14px 16px">{buraco("GET /planos — quote-service indisponível na geração")}</div></section>'

    cartoes = []
    for plano in planos.get("planos", []):
        coberturas = "".join(f"<li>{esc(c)}</li>" for c in plano.get("coberturas", []))
        cartoes.append(f"""<div class="plano"><h3>{esc(plano.get("nome"))}</h3>
          <div class="preco">{esc(planos.get("moeda", ""))} {esc(plano.get("base_mensal"))}</div>
          <div style="color:var(--texto-mais-fraco);font-size:12px">franquia {esc(plano.get("franquia"))}</div>
          <ul>{coberturas}</ul></div>""")

    regras = planos.get("regras", {})
    linhas_idade = _linhas_do_fator("Idade do condutor", regras.get("faixa_etaria", []), "idade_min", "idade_max")
    linhas_veiculo = _linhas_do_fator("Idade do veículo", regras.get("idade_veiculo", []), "anos_min", "anos_max")
    regiao = regras.get("regiao_cep", {})

    return f"""<section style="margin-bottom:18px">
      <div class="cartoes">{"".join(cartoes)}</div>
    </section>
    <section class="painel" style="margin-bottom:18px">
      <header><h2>O que muda o preço</h2><span class="aux">GET /planos</span></header>
      <table>
        <thead><tr><th>Fator</th><th>Faixa</th><th class="num">Multiplicador</th></tr></thead>
        <tbody>{linhas_idade}{linhas_veiculo}
          <tr><td>Região (CEP)</td><td class="mono">prefixos de risco</td><td class="num">{esc(regiao.get("multiplicador"))}</td></tr>
        </tbody>
      </table>
    </section>"""


def _linhas_do_fator(nome_fator: str, faixas: list[dict], chave_min: str, chave_max: str) -> str:
    linhas = []
    for indice, faixa in enumerate(faixas):
        rotulo = esc(nome_fator) if indice == 0 else ""
        if faixa.get("recusar"):
            valor = f'<span class="chip falha">recusa — {esc(faixa.get("motivo"))}</span>'
        else:
            valor = esc(faixa.get("multiplicador"))
        linhas.append(
            f'<tr><td>{rotulo}</td><td class="mono">{esc(faixa.get(chave_min))}–{esc(faixa.get(chave_max))}</td>'
            f'<td class="num">{valor}</td></tr>'
        )
    return "".join(linhas)


def _secao_motivos_handoff() -> str:
    motivos = list(MotivoHandoff)
    linhas = "".join(f'<div class="regra"><code>{esc(m.value)}</code></div>' for m in motivos)
    return f"""<section class="painel" style="margin-bottom:18px">
      <header><h2>Motivos de handoff</h2><span class="aux">dominio.decisao.MotivoHandoff — {len(motivos)} implementado(s)</span></header>
      <div style="padding:14px 16px"><div class="regras">{linhas}</div>
        <p style="color:var(--texto-fraco);font-size:12.5px;margin:10px 0 0">
          O vocabulário fechado do domínio hoje tem {len(motivos)} motivo(s). Um desenho anterior chegou a prever
          mais categorias (pedido explícito do lead, exceção comercial, dado ambíguo); elas dependem de capacidade
          que o agente ainda não tem e não estão implementadas — esta tela mostra o Enum real, não a intenção.</p>
      </div>
    </section>"""


def _secao_retry() -> str:
    try:
        import infra.cliente_quote  # noqa: F401 — só para checar se já existe (PR #35)
    except ImportError:
        return f"""<section class="painel"><header><h2>Política de tentativas</h2><span class="aux">src/infra/cliente_quote.py</span></header>
          <div style="padding:14px 16px">{buraco("src/infra/cliente_quote.py — ainda não existe (PR #35 em aberto)")}</div>
        </section>"""
    return f"""<section class="painel"><header><h2>Política de tentativas</h2><span class="aux">src/infra/cliente_quote.py</span></header>
      <div style="padding:14px 16px">{buraco("leitura das constantes de retry ainda não implementada nesta tela")}</div>
    </section>"""
