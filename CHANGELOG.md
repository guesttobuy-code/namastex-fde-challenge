# Changelog

Todo PR vencido que muda código deixa uma entrada aqui, citando a issue/PR (`#N`) — é assim que cada PR
fica mapeado e documentado (cobrado pelo guard `changelog-update`). Formato: Keep a Changelog.
Categorias: Adicionado · Alterado · Corrigido · Removido · Segurança.

## [Unreleased]

### Adicionado
- Mock: laço de aperfeiçoamento do agente — no Rastreio, cada resposta do agente pode ser **marcada como erro** e abre a sua **proveniência** (decisão tomada, regra aplicada, de onde veio o texto, que dados usou); a correção registrada vira **caso rotulado** na régua da tela Avaliação, onde reprova se o agente repetir o erro. Conceito inspirado no ciclo de curadoria de um agente já em produção do dono (lacuna vira pendência com status), adaptado ao nosso domínio — nenhum código de terceiros foi trazido (#18)
- Mock de design do console do agente em `docs/design/` — seis telas navegáveis por menu lateral (Conversas, Fila humana, Rastreio, Cotações, Avaliação, Regras e política), HTML estático sem dependência externa, com dados fictícios e a identidade visual derivada da marca do cliente. Serve para decidir o desenho antes de existir código de interface — e define, em particular, quais campos a trilha precisa gravar (requisito da F4, issue #7) (#18)
- Esteira de produção instalada pelo kit: CLAUDE.md com as 12 leis, governança (ADR com reserva de número, matriz de impacto, contrato de veredito, documentos obrigatórios), 63 scripts de guards em `scripts/esteira/`, pre-commit ligado, `esteira.json` (stack python, 7 áreas, pastas privadas declaradas proibidas) e `package.json` com os comandos da esteira (#3)
- Planejamento do projeto em `docs/`: proposta de design auditada externamente e plano da primeira frente; parecer da auditoria externa arquivado em `ai-logs/codex/` (#3)
- Pasta `_local/` ignorada pelo git, para chaves, sondas e rascunhos, com o critério escrito em `_local/LEIA-ME.md` (#3)

### Corrigido
- **Dado pessoal em arquivo versionado (achado da auditoria fria, #17):** o `esteira.json` gravava o nome real do dono dentro de um caminho do campo `pastas_proibidas`, num repositório público. O campo inteiro saiu: era configuração de máquina, não pertence à entrega, e nada neste repositório o lia — a proteção que ele prometia era decorativa (#17)
- **Rastreabilidade dos arquivos vindos do kit (achado da auditoria fria, #17):** comentários nos 63 arquivos de `scripts/esteira/` citam números de issue e ADR do repositório de ORIGEM, que aqui significam outra coisa. Criado `scripts/esteira/README.md` declarando a proveniência, as quatro adaptações locais com o motivo, o limite conhecido dos 8 guards que não medem este diretório, e a regra para quem mexer (#17)

### Alterado
- `.gitignore`: ignora `_local/`, `_PRIVADO/` e `*.token`; e abre duas exceções conscientes, porque as regras herdadas engoliriam entregáveis do desafio — `.env.example` (documenta variáveis sem segredo) e `examples/*.log` (o log da execução completa) (#3)
- `scripts/esteira/guards/companion-red-green.mjs`: os testes do diff passam a ser roteados **por extensão** — `.py` vai para o `pytest`, o resto vai para o `node --test` —, em vez de mandar tudo para o pytest só porque o projeto é Python. Antes, o teste Node que a própria esteira traz (`tests/esteira.test.mjs`) era entregue ao pytest, que coletava zero testes e saía 4; o guard traduzia isso como "pytest não instalado" e mandava instalar uma ferramenta que não faltava. Teste que não é `.py` no mesmo diff continua rodando: os dois resultados contam (#3)
- `scripts/esteira/lib/varredura.mjs`: o varredor passa a pular `.venv`, `venv`, `.uv`, `__pycache__` e `site-packages`, como já pulava `node_modules`. Sem isso, o `file-loc-ceiling` media bibliotecas de terceiros do Python e reprovava o commit por arquivos que não são nossos e que o `.gitignore` já exclui (#3)
- `CLAUDE.md` e as duas bibliotecas copiadas do kit (`scripts/esteira/lib/esteira.mjs` e `Esteira.ps1`): removida a menção a outro projeto, já que este repositório é público. No lugar da checagem por nome, ficou a equivalente estrutural — o caminho tem de terminar no slug deste projeto —, com o motivo escrito no próprio arquivo (#3)
