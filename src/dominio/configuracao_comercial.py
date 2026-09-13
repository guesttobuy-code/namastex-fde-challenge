"""Configuração comercial — decisão da seguradora, nunca da IA (issue #42, decisão do dono em #41).

`politica.decidir` recebe isto como parâmetro; o domínio nunca lê arquivo nem rede para descobrir
o valor. Quem carrega o valor real de `conhecimento/` é a infraestrutura (F13, #43) — esta frente
só define o tipo e o consome.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ConfiguracaoComercial:
    """`encaminhar_lead_fora_do_padrao`: quando a `/quote` recusa por regra de aceitação (422),
    encaminhar o lead para um corretor (`True`, padrão — decisão do dono em #41) ou só encerrar
    com educação (`False`, comportamento anterior a esta issue)."""

    encaminhar_lead_fora_do_padrao: bool = True
