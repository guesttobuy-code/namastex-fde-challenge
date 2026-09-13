"""Esquema da ficha de objeção de preço (issue #43, F13). O dono escreve `resposta_orientada` em
português livre, mas nenhum número pode aparecer solto no texto: todo valor vem de um marcador
`{{...}}`, resolvido por uma frente futura (fora de escopo da #43 — LLM lendo a base de
conhecimento). Publicar recusa dígito fora de marcador ou marcador fora do vocabulário conhecido —
o equivalente, aqui, à LEI 2 do CLAUDE.md (dado real ausente nunca se fabrica): um preço digitado à
mão nunca foi confirmado pela `/quote`, então nunca pode sair como texto fixo.

Vocabulário de marcadores desta entrega: os campos que já existem em `dominio.preco_cotado.PrecoCotado`
(a única fonte de valor monetário do domínio) mais `carencia_dias`. Resolver o marcador em número de
verdade é responsabilidade de outra frente; aqui só se valida a FORMA.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import datetime, timezone

MARCADORES_CONHECIDOS = frozenset(
    {
        "premio_mensal",
        "franquia",
        "plano_nome",
        "carencia_dias",
        "parcela_proporcional",
    }
)

_MARCADOR_RE = re.compile(r"\{\{(\w+)\}\}")
_DIGITO_RE = re.compile(r"\d")

_TENTATIVAS_MIN = 1
_TENTATIVAS_MAX = 5


class MarcadorInvalido(ValueError):
    """Dígito fora de `{{...}}`, ou marcador fora de `MARCADORES_CONHECIDOS`."""


def validar_resposta_orientada(texto: str) -> None:
    """Recusa (`MarcadorInvalido`) se houver dígito fora de marcador ou marcador desconhecido.
    Não resolve o marcador — só valida a forma."""
    sem_marcadores = _MARCADOR_RE.sub("", texto)
    if _DIGITO_RE.search(sem_marcadores):
        raise MarcadorInvalido(f"dígito fora de marcador em: {texto!r}")
    for nome in _MARCADOR_RE.findall(texto):
        if nome not in MARCADORES_CONHECIDOS:
            raise MarcadorInvalido(f"marcador desconhecido: {{{{{nome}}}}}")


@dataclass(frozen=True)
class FichaDeObjecao:
    id: str
    nome: str
    frases_do_lead: tuple[str, ...]
    resposta_orientada: str
    argumentos_permitidos: tuple[str, ...]
    tentativas_antes_do_corretor: int
    status: str = "rascunho"
    versao: int = 1
    atualizado_em: str = ""

    @classmethod
    def de_dict(cls, dados: dict) -> "FichaDeObjecao":
        """Constrói a partir do formato solto (JSON/HTTP) — sem validar a invariante do marcador;
        quem quer a validação chama `.publicar()` depois."""
        return cls(
            id=dados["id"],
            nome=dados.get("nome", ""),
            frases_do_lead=tuple(dados.get("frases_do_lead", ())),
            resposta_orientada=dados.get("resposta_orientada", ""),
            argumentos_permitidos=tuple(dados.get("argumentos_permitidos", ())),
            tentativas_antes_do_corretor=int(dados.get("tentativas_antes_do_corretor", 1)),
            status=dados.get("status", "rascunho"),
            versao=int(dados.get("versao", 1)),
            atualizado_em=dados.get("atualizado_em", ""),
        )

    def para_dict(self) -> dict:
        return {
            "id": self.id,
            "nome": self.nome,
            "frases_do_lead": list(self.frases_do_lead),
            "resposta_orientada": self.resposta_orientada,
            "argumentos_permitidos": list(self.argumentos_permitidos),
            "tentativas_antes_do_corretor": self.tentativas_antes_do_corretor,
            "status": self.status,
            "versao": self.versao,
            "atualizado_em": self.atualizado_em,
        }

    def publicar(self) -> "FichaDeObjecao":
        """Recusa (sem mutar `self`) quando a resposta orientada tem número fora de marcador ou
        `tentativas_antes_do_corretor` fora de 1..5. Publicação bem-sucedida: nova ficha
        `status="publicado"`, `versao` incrementada, `atualizado_em` no momento da chamada."""
        validar_resposta_orientada(self.resposta_orientada)
        if not (_TENTATIVAS_MIN <= self.tentativas_antes_do_corretor <= _TENTATIVAS_MAX):
            raise ValueError(
                f"tentativas_antes_do_corretor deve estar entre {_TENTATIVAS_MIN} e "
                f"{_TENTATIVAS_MAX}, recebeu {self.tentativas_antes_do_corretor}"
            )
        return replace(
            self,
            status="publicado",
            versao=self.versao + 1,
            atualizado_em=datetime.now(timezone.utc).isoformat(),
        )
