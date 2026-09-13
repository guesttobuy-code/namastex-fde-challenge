"""`ServicoDeConhecimento` (issue #43, F13): caso de uso para listar/ler/salvar fichas de objeção
de preço. A invariante do marcador mora só em `dominio.ficha_objecao.FichaDeObjecao.publicar` —
este serviço nunca reimplementa a regra, só orquestra domínio + porta (mesma disciplina de
`ServicoDeTrilha`, #7): pedir `status="publicado"` sem passar pela validação não é caminho que
exista aqui.
"""

from __future__ import annotations

from collections.abc import Iterable

from dominio.ficha_objecao import FichaDeObjecao

from .portas.repositorio_conhecimento import RepositorioDeConhecimento


class ServicoDeConhecimento:
    def __init__(self, repositorio: RepositorioDeConhecimento) -> None:
        self._repositorio = repositorio

    def listar_objecoes(self) -> list[dict]:
        return self._repositorio.listar_objecoes()

    def obter_objecao(self, id: str) -> dict | None:
        return self._repositorio.obter_objecao(id)

    def salvar_objecao(self, dados: dict, ids_dos_planos: Iterable[str] = ()) -> dict:
        """`dados["status"] == "publicado"` passa pela invariante do marcador antes de persistir;
        qualquer outro status (rascunho) persiste como veio, sem validar o texto — publicar recusa
        calado, salvar rascunho não. `ids_dos_planos` (achado B2 da auditoria do PR #45): quem
        chama (a borda HTTP) lê a `/planos` e passa os ids aqui — este serviço só repassa para o
        domínio montar o vocabulário de marcadores por plano, nunca fala com rede."""
        ficha = FichaDeObjecao.de_dict(dados)
        if dados.get("status") == "publicado":
            ficha = ficha.publicar(ids_dos_planos)
        persistido = ficha.para_dict()
        self._repositorio.salvar_objecao(ficha.id, persistido)
        return persistido
