"""Esquema da ficha de objeção de preço (issue #43, F13). O dono escreve `resposta_orientada` em
português livre, mas nenhum número pode aparecer solto no texto: todo valor vem de um marcador
`{{...}}`, resolvido por uma frente futura (fora de escopo da #43 — LLM lendo a base de
conhecimento). Publicar recusa dígito fora de marcador ou marcador fora do vocabulário conhecido —
o equivalente, aqui, à LEI 2 do CLAUDE.md (dado real ausente nunca se fabrica): um preço digitado à
mão nunca foi confirmado pela `/quote`, então nunca pode sair como texto fixo. Mensagens de erro são
frase para o DONO, não texto técnico (achado B/R4 da auditoria do PR #45) — quem lê não é programador.

Vocabulário de marcadores (achado B2 da auditoria do PR #45 — a lista era curta demais e escrita à
mão): `MARCADORES_BASE` vem dos campos que já existem em `dominio.preco_cotado.PrecoCotado` (única
fonte de valor monetário do domínio) mais `carencia_dias`/`parcela_proporcional`; um marcador
`franquia_<id do plano>` por plano é acrescentado por `vocabulario_de_marcadores`, a partir dos ids
que a infraestrutura lê da `/planos` e passa como parâmetro — o domínio nunca lê rede, só combina o
formato do nome. Resolver o marcador em número de verdade é responsabilidade de outra frente; aqui
só se valida a FORMA.

Argumentos permitidos (achado R2 — texto livre deixava passar qualquer coisa): lista FECHADA
aprovada pelo dono na #41 — cobertura do plano, franquia de cada plano, carência, comparação entre
planos. Publicar exige pelo menos um argumento dessa lista.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass, replace

MARCADORES_BASE = frozenset(
    {
        "premio_mensal",
        "franquia",
        "plano_nome",
        "coberturas",
        "carencia_dias",
        "parcela_proporcional",
    }
)

ARGUMENTOS_PERMITIDOS_CONHECIDOS = frozenset(
    {
        "coberturas",
        "franquia_por_plano",
        "carencia",
        "comparacao_entre_planos",
    }
)

_MARCADOR_RE = re.compile(r"\{\{(\w+)\}\}")
_DIGITO_RE = re.compile(r"\d")

_TENTATIVAS_MIN = 1
_TENTATIVAS_MAX = 5


class MarcadorInvalido(ValueError):
    """Dígito fora de `{{...}}`, marcador fora do vocabulário conhecido, (issue #58) marcador
    presente no texto sem valor correspondente para preencher, ou (issue #58, veredito da
    auditoria do PR #75) frase proibida — promessa de desconto/ajuste/urgência fora do que a
    ficha e a cotação sustentam."""


def vocabulario_de_marcadores(ids_dos_planos: Iterable[str] = ()) -> frozenset[str]:
    """`MARCADORES_BASE` mais `franquia_<id>` para cada id de plano informado (vindo da `/planos`,
    lida pela infraestrutura — este módulo só combina o nome, nunca fala com rede)."""
    return MARCADORES_BASE | {f"franquia_{pid}" for pid in ids_dos_planos}


def validar_resposta_orientada(texto: str, marcadores_conhecidos: frozenset[str] = MARCADORES_BASE) -> None:
    """Recusa (`MarcadorInvalido`) se houver dígito fora de marcador ou marcador desconhecido.
    Não resolve o marcador — só valida a forma. Mensagem em frase para o dono (achado R4)."""
    sem_marcadores = _MARCADOR_RE.sub("", texto)
    if _DIGITO_RE.search(sem_marcadores):
        raise MarcadorInvalido(
            "Há um número escrito fora de um marcador. Coloque o valor dentro de chaves duplas, "
            "como {{franquia}}."
        )
    for nome in _MARCADOR_RE.findall(texto):
        if nome not in marcadores_conhecidos:
            permitidos = ", ".join(f"{{{{{m}}}}}" for m in sorted(marcadores_conhecidos))
            raise MarcadorInvalido(
                f"O marcador {{{{{nome}}}}} não é reconhecido. Marcadores permitidos: {permitidos}."
            )


# issue #58, veredito da auditoria do PR #75: a resposta gerada pelo LLM prometeu ajustar franquia
# e ofereceu desconto por conta própria (a demonstração do próprio PR publicou uma ficha com "Posso
# ajustar a franquia para {{franquia}}" — o antiexemplo do histórico) e escreveu como se fosse um
# corretor humano. Lista curta, aprovada implicitamente pela mesma disciplina de
# ARGUMENTOS_PERMITIDOS (fechada, cresce só por decisão explícita) — comparada sem acento/caixa.
FRASES_PROIBIDAS = frozenset(
    {
        "desconto",
        "ajustar a franquia",
        "ajusto a franquia",
        "rever o valor",
        "cobrir a oferta",
        "so hoje",
        "sou corretor",
        "sou humano",
    }
)


def _normalizar_para_comparacao(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode("ascii")
    return sem_acento.lower()


def validar_frases_proibidas(texto: str, proibidas: frozenset[str] = FRASES_PROIBIDAS) -> None:
    """Recusa (`MarcadorInvalido`) se o texto contiver uma promessa/frase fora do que a ficha e a
    cotação sustentam — mesmo caminho de retentativa/encaminhamento do dígito solto (issue #58,
    veredito da auditoria do PR #75, bloqueante B4). Comparação sem acento e sem caixa, para não
    deixar passar "Desconto" ou "só hoje" por diferença de grafia."""
    normalizado = _normalizar_para_comparacao(texto)
    for frase in proibidas:
        if frase in normalizado:
            raise MarcadorInvalido(
                f"O texto contém uma promessa não autorizada (\"{frase}\"). Reescreva sem prometer "
                "desconto, ajuste de franquia/valor ou urgência — só o que a ficha e a cotação já "
                "garantem."
            )


def preencher_marcadores(texto: str, valores: dict[str, str]) -> str:
    """Substitui cada `{{marcador}}` pelo valor correspondente em `valores` (issue #58) — quem
    chama já formatou o valor como string (moeda em formato BR, por exemplo); este módulo só
    substitui, nunca formata número. Chama primeiro `validar_resposta_orientada` (responsabilidade
    de quem orquestra, não desta função) para garantir que só marcadores do vocabulário chegam
    aqui. Marcador sem valor correspondente em `valores` é `MarcadorInvalido` — nunca deixa
    `{{...}}` literal escapar para o texto que o lead lê (pior que um número fabricado: um
    placeholder visível, LEI 2)."""

    def _substituir(encontrado: re.Match[str]) -> str:
        nome = encontrado.group(1)
        if nome not in valores:
            raise MarcadorInvalido(f"Não há valor para preencher o marcador {{{{{nome}}}}}.")
        return valores[nome]

    return _MARCADOR_RE.sub(_substituir, texto)


def validar_argumentos_permitidos(argumentos: Iterable[str]) -> None:
    """Recusa (`ValueError`, frase para o dono) lista vazia ou argumento fora dos 4 aprovados."""
    argumentos = tuple(argumentos)
    if not argumentos:
        raise ValueError("Selecione ao menos um argumento permitido para publicar.")
    desconhecidos = sorted(set(argumentos) - ARGUMENTOS_PERMITIDOS_CONHECIDOS)
    if desconhecidos:
        raise ValueError(f"Argumento não permitido: {', '.join(desconhecidos)}.")


@dataclass(frozen=True)
class FichaDeObjecao:
    id: str
    nome: str
    frases_do_lead: tuple[str, ...]
    resposta_orientada: str
    argumentos_permitidos: tuple[str, ...]
    tentativas_antes_do_corretor: int | None = None
    status: str = "rascunho"
    versao: int = 0
    atualizado_em: str = ""

    @classmethod
    def de_dict(cls, dados: dict) -> "FichaDeObjecao":
        """Constrói a partir do formato solto (JSON/HTTP) — sem validar a invariante do marcador;
        quem quer a validação chama `.publicar()` depois. `tentativas_antes_do_corretor` ausente
        vira `None` (campo vazio) — nunca um número fabricado (achado R1)."""
        tentativas = dados.get("tentativas_antes_do_corretor")
        return cls(
            id=dados["id"],
            nome=dados.get("nome", ""),
            frases_do_lead=tuple(dados.get("frases_do_lead", ())),
            resposta_orientada=dados.get("resposta_orientada", ""),
            argumentos_permitidos=tuple(dados.get("argumentos_permitidos", ())),
            tentativas_antes_do_corretor=int(tentativas) if tentativas not in (None, "") else None,
            status=dados.get("status", "rascunho"),
            versao=int(dados.get("versao", 0)),
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

    def publicar(self, instante: str, ids_dos_planos: Iterable[str] = ()) -> "FichaDeObjecao":
        """Recusa (sem mutar `self`, frase para o dono) quando a resposta orientada tem número
        fora de marcador, o marcador não está no vocabulário (`ids_dos_planos` amplia com
        `franquia_<id>` por plano), os argumentos permitidos estão vazios ou fora da lista
        aprovada, ou `tentativas_antes_do_corretor` está vazio/fora de 1..5. Publicação
        bem-sucedida: nova ficha `status="publicado"`, `atualizado_em=instante`, e `versao` = 1 na
        primeira publicação, incrementada a partir daí (achado R3 — a primeira nunca é 2).
        `instante` é obrigatório (#53): o domínio não lê o relógio do sistema — quem chama
        (`aplicacao.servico_conhecimento`) fornece."""
        validar_resposta_orientada(self.resposta_orientada, vocabulario_de_marcadores(ids_dos_planos))
        validar_argumentos_permitidos(self.argumentos_permitidos)
        if self.tentativas_antes_do_corretor is None or not (
            _TENTATIVAS_MIN <= self.tentativas_antes_do_corretor <= _TENTATIVAS_MAX
        ):
            raise ValueError(
                f"Escolha quantas tentativas antes do corretor, de {_TENTATIVAS_MIN} a "
                f"{_TENTATIVAS_MAX}, para publicar."
            )
        return replace(
            self,
            status="publicado",
            versao=self.versao + 1 if self.versao > 0 else 1,
            atualizado_em=instante,
        )
