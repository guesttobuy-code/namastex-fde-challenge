"""Fixture ruim: dominio importando infra. Prova que o import-linter morde."""

from infra import cliente_http  # noqa: F401 -- import proposital, é a violação que a fixture prova
