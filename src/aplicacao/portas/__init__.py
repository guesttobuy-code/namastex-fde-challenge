"""Pacote de portas da aplicação — um arquivo por porta (decisão R3 em #16).

Vazio de propósito: nenhum re-export aqui. Um `__init__.py` que reexporta a superfície pública é o
arquivo que toda porta nova precisaria editar — com várias frentes declarando porta em paralelo
(`repositorio_de_trilha.py` aqui, `portal_de_cotacao.py` na F3/#6), é o mesmo risco de colisão que a
R1 (#16) já apontou para `src/dominio/__init__.py`. Import sempre pelo módulo concreto:
`from aplicacao.portas.repositorio_de_trilha import RepositorioDeTrilha`.
"""
