# Matriz de impacto — quem depende de quem

**Dono único deste mapa:** este arquivo. O passo 2 (`/2-entender-e-criar-issue-base`, leitura 3) lê
daqui os **vizinhos a testar**; o passo 3 (Prova 2) roda os testes deles; o auditor (ângulo D)
confere. Módulo que não está aqui não tem vizinho declarado — e isso é uma afirmação que o
auditor pode refutar.

**Como preencher:** uma linha por módulo. "Vizinhos" = quem lê o mesmo dado ou chama a mesma
função. "Teste do vizinho" = o comando que fica vermelho se o vizinho regredir. **Crítico** =
mudança aqui exige companion obrigatório na prova (Prova 1) e o olho do dono no merge.

| módulo | caminho | vizinhos (leem o mesmo dado) | teste do vizinho | crítico? |
|---|---|---|---|---|
| _(exemplo)_ `pricing` | `src/pricing/` | `reservas`, `financeiro` | `node --test tests/reservas.test.mjs tests/financeiro.test.mjs` | sim |
| `trilha-e-privacidade` | `src/dominio/eventos_trilha.py`, `src/dominio/redator_pii.py`, `src/aplicacao/servico_trilha.py`, `src/infra/trilha_jsonl.py` | F3 (#6, grava `tentativa_de_cotacao`), F5 (#8, orquestra e grava a maioria dos eventos), F6 (#9, usa o redator na fronteira do LLM), F8 (#11, lê a trilha para `eval/casos.jsonl`) | `.venv/Scripts/python -m pytest tests/dominio tests/aplicacao tests/infra tests/integracao` (`PYTHONPATH=src`) | sim |
| `dominio` | `src/dominio/` | `aplicacao` (F3, #6 — ainda não existe), `infra`/`interfaces` (F4/F5, #7/#8) | `pytest tests/dominio/` + `pytest tests/arquitetura/test_fronteiras.py` | sim |
| `aplicacao.portas.portal_de_cotacao` / `infra.cliente_quote` | `src/aplicacao/portas/portal_de_cotacao.py`, `src/infra/cliente_quote.py` | `dominio.resultado_cotacao`/`dominio.preco_cotado` (consome, não replica — LEI 11); `aplicacao.servico_conversa`/`interfaces.cli` (consomem a porta) | `pytest tests/infra/test_cliente_quote.py tests/aplicacao/ tests/interfaces/ tests/dominio/` + `pytest tests/arquitetura/test_fronteiras.py` | sim |
| `aplicacao.servico_conversa` / `interfaces.cli` | `src/aplicacao/servico_conversa.py`, `src/interfaces/cli.py` | `dominio.politica`/`dominio.redator`/`dominio.validacao` (decide e escreve, nunca reimplementado aqui); `aplicacao.portas.portal_de_cotacao` (só a porta, nunca `infra` direto de `aplicacao`); `aplicacao.servico_trilha`/`dominio.eventos_trilha` (F4/#7 — grava a trilha, nunca chama `RepositorioDeTrilha` direto nem redige PII por conta própria) | `pytest tests/aplicacao/ tests/interfaces/test_cli.py tests/dominio/` + `pytest tests/arquitetura/test_fronteiras.py` | sim |
| `conhecimento` (`RepositorioDeConhecimento`) | `src/dominio/ficha_objecao.py`, `src/aplicacao/portas/repositorio_conhecimento.py`, `src/aplicacao/servico_conhecimento.py`, `src/infra/repositorio_conhecimento_json.py`, `src/interfaces/servidor.py` | F13/#43 (nenhum outro leitor ainda — greenfield); futuro (fora de escopo da #43): frente que liga o chat ao agente real, frente do LLM lendo a base de conhecimento; #42 (`ConfiguracaoComercial`, ainda OPEN — não consumida aqui) | `pytest tests/dominio/test_ficha_objecao.py tests/aplicacao/test_servico_conhecimento.py tests/infra/test_repositorio_conhecimento_json.py tests/interfaces/test_servidor.py` + `pytest tests/arquitetura/test_fronteiras.py` | sim |
|  |  |  |  |  |

## Regras

- **Erro se concentra nas BORDAS.** A refatoração mudou o dono do arquivo — o dono novo passou a
  testar? A migration mudou a coluna — quem lê passou a tratar o novo shape? Onde a informação
  atravessa uma borda, é onde ela cai. Esta matriz existe para nomear as bordas.
- **Dois lugares que decidem o mesmo valor = dois donos (LEI 11).** Ache-os no passo 2 e deixe um.
- Atualize esta matriz **no mesmo PR** que cria uma dependência nova. Matriz velha é pior que
  nenhuma: ela afirma que não há vizinho.
