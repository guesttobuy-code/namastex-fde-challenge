"""Porta `PortalDeRespostaOrientada` (issue #58, frente `ia-responde`): pede ao LLM um texto de
resposta ao lead, orientado pela base de conhecimento, escrito com marcadores `{{...}}` — NUNCA
resolvido aqui, nunca com número solto (a garantia de forma é de `dominio.ficha_objecao`).

Porta separada de `aplicacao.portas.portal_de_linguagem.PortalDeLinguagem` (F6/#9): aquela EXTRAI
campos do texto do lead (texto -> campos); esta GERA um texto a partir de contexto estruturado
(contexto -> texto). Formas de entrada/saída diferentes, portas diferentes — mas o adaptador real
desta porta reaproveita o MESMO cliente HTTP de `infra.adaptador_de_linguagem` (LEI 11: um só
ponto de chamada ao OpenRouter, não dois clientes HTTP)."""

from __future__ import annotations

from typing import Protocol


class PortalDeRespostaOrientada(Protocol):
    def responder(self, contexto: dict) -> str | None:
        """`contexto` é um dict serializável — ficha da cotação (valores da `/quote`), fichas de
        objeção PUBLICADAS relevantes e a configuração comercial. NUNCA contém nome, WhatsApp ou
        e-mail do lead (mesma garantia de privacidade de `aplicacao.servico_contato` — quem monta
        o contexto, `aplicacao.servico_resposta_orientada`, nunca lê esses campos do estado).

        Devolve o texto BRUTO com marcadores `{{...}}`, ainda não resolvido: quem chama valida
        (`dominio.ficha_objecao.validar_resposta_orientada`) e preenche
        (`dominio.ficha_objecao.preencher_marcadores`). Devolve `None` quando a porta não
        conseguiu gerar nada (rede, timeout, esquema fora do esperado) — mesmo padrão de
        `dominio.resultado_cotacao.ResultadoDaCotacao` para falha (um valor, nunca uma exceção
        cruzando de `infra` para `aplicacao`); quem chama trata como tentativa reprovada, mesmo
        caminho de `dominio.ficha_objecao.MarcadorInvalido` (retentativa, depois fallback)."""
        ...

    @property
    def origem_do_texto(self) -> str:
        """Rótulo de proveniência para a trilha (`origem_do_texto`), mesmo padrão de
        `PortalDeLinguagem.origem_do_texto`. Formato: `"llm_resposta:<modelo>@<versao_prompt>"`."""
        ...
