"""Porta `PortalDeLinguagem` (issue #9, F6 — uma das seis portas previstas): entender o texto
livre do lead e devolver campos extraídos, intenção e ambiguidades — sem NUNCA decidir preço,
recusa ou handoff (isso continua sendo só de `dominio.politica`).

Declara a forma; os dois adaptadores (determinístico, padrão e usado nos testes; e OpenRouter, o
LLM real) vivem em `infra/adaptador_de_linguagem.py`, no mesmo padrão de `infra/cliente_quote.py` —
`aplicacao` só conhece esta interface, nunca importa `infra` (I-2, CONTRACT de `aplicacao`).

O `texto_mascarado` que chega aqui já passou por `dominio.redator_pii.redigir_texto` — CEP e outras
PII nunca atravessam esta porta. O CEP é extraído localmente do texto bruto, ANTES do mascaramento,
em outro ponto do fluxo (`dominio.redator_pii.extrair_cep`), e só volta a se juntar aos demais
campos depois que o adaptador já respondeu (ver `aplicacao.servico_conversa`).
"""

from __future__ import annotations

from typing import Protocol

from dominio.estado_conversa import EstadoDaConversa
from dominio.saida_de_linguagem import SaidaDeLinguagem


class PortalDeLinguagem(Protocol):
    def extrair(self, texto_mascarado: str, estado_atual: EstadoDaConversa) -> SaidaDeLinguagem:
        """`estado_atual` dá contexto (o que já se sabe do lead) sem forçar o adaptador a
        redescobrir o que já foi coletado — mas o adaptador NUNCA decide o que fazer com o
        estado; só devolve o que conseguiu extrair desta mensagem."""
        ...

    @property
    def origem_do_texto(self) -> str:
        """Rótulo de proveniência para `dominio.eventos_trilha.MensagemEnviada.origem_do_texto`,
        usado quando o texto mostrado ao lead vem deste adaptador (ex.: um
        `SaidaDeLinguagem.pedido_de_esclarecimento`) — nunca quando o texto é de preço/recusa/
        handoff, que são sempre do redator determinístico ou da `/quote` (#9: "o LLM nunca
        escreve" essas três coisas). Formato: `"llm:<modelo>@<versao_prompt>"` para o adaptador
        real; `"extrator_deterministico:v1"` para o determinístico."""
        ...
