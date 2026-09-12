# Changelog

Todo PR vencido que muda código deixa uma entrada aqui, citando a issue/PR (`#N`) — é assim que cada PR
fica mapeado e documentado (cobrado pelo guard `changelog-update`). Formato: Keep a Changelog.
Categorias: Adicionado · Alterado · Corrigido · Removido · Segurança.

## [Unreleased]

### Adicionado
- Esteira de produção instalada pelo kit: CLAUDE.md com as 12 leis, governança (ADR com reserva de número, matriz de impacto, contrato de veredito, documentos obrigatórios), 63 scripts de guards em `scripts/esteira/`, pre-commit ligado, `esteira.json` (stack python, 7 áreas, pastas privadas declaradas proibidas) e `package.json` com os comandos da esteira (#3)
- Planejamento do projeto em `docs/`: proposta de design auditada externamente e plano da primeira frente; parecer da auditoria externa arquivado em `ai-logs/codex/` (#3)
- Pasta `_local/` ignorada pelo git, para chaves, sondas e rascunhos, com o critério escrito em `_local/LEIA-ME.md` (#3)

### Alterado
- `.gitignore`: ignora `_local/`, `_PRIVADO/` e `*.token`; e abre duas exceções conscientes, porque as regras herdadas engoliriam entregáveis do desafio — `.env.example` (documenta variáveis sem segredo) e `examples/*.log` (o log da execução completa) (#3)
- `scripts/esteira/guards/companion-red-green.mjs`: os testes do diff passam a ser roteados **por extensão** — `.py` vai para o `pytest`, o resto vai para o `node --test` —, em vez de mandar tudo para o pytest só porque o projeto é Python. Antes, o teste Node que a própria esteira traz (`tests/esteira.test.mjs`) era entregue ao pytest, que coletava zero testes e saía 4; o guard traduzia isso como "pytest não instalado" e mandava instalar uma ferramenta que não faltava. Teste que não é `.py` no mesmo diff continua rodando: os dois resultados contam (#3)
- `scripts/esteira/lib/varredura.mjs`: o varredor passa a pular `.venv`, `venv`, `.uv`, `__pycache__` e `site-packages`, como já pulava `node_modules`. Sem isso, o `file-loc-ceiling` media bibliotecas de terceiros do Python e reprovava o commit por arquivos que não são nossos e que o `.gitignore` já exclui (#3)
- `CLAUDE.md` e as duas bibliotecas copiadas do kit (`scripts/esteira/lib/esteira.mjs` e `Esteira.ps1`): removida a menção a outro projeto, já que este repositório é público. No lugar da checagem por nome, ficou a equivalente estrutural — o caminho tem de terminar no slug deste projeto —, com o motivo escrito no próprio arquivo (#3)
