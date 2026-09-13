# ADR-0004 — Base de conhecimento em JSON versionado + servidor local mínimo

- **Status:** aceita
- **Data:** 2026-09-13
- **Issue/PR:** #43

## Contexto

O dono decidiu (briefing #41, ratificado na análise de impacto e no "pode implementar" da #43)
que quem avalia este desafio precisa baixar o repositório, rodar **um comando só**
(`docker compose up --build`) e usar o sistema no navegador — sem banco, sem serviço externo, sem
chave obrigatória. A base de conhecimento (as fichas de objeção de preço que o corretor usa para
responder ao lead) precisa ser editável pela tela e **ficar salva no repositório**, em formato
legível, para quem revisa ver a mudança no `git diff`.

Faltavam duas decisões técnicas para isso existir:
1. onde e como a base de conhecimento é armazenada;
2. como o sistema expõe uma tela viva no navegador, já que hoje só existe geração estática
   offline (`interfaces.painel.gerar`) e uma CLI de terminal (`interfaces.cli`) — nenhum dos dois
   é um servidor HTTP. O `pyproject.toml` deste projeto não tem grupo de dependência de runtime.

## Decisão

**Armazenamento:** um arquivo JSON por ficha em `conhecimento/objecoes/<id>.json`, escrito e lido
pelo par porta+adaptador `RepositorioDeConhecimento`/`RepositorioDeConhecimentoJSON`
(`src/aplicacao/portas/repositorio_conhecimento.py`, `src/infra/repositorio_conhecimento_json.py`)
— o mesmo molde já usado pela trilha (`RepositorioDeTrilha`/`RepositorioDeTrilhaJSONL`, ADR
implícito da issue #7). `conhecimento/` é montado como volume no `docker-compose.yml`, então
editar e publicar uma ficha pela tela gera uma mudança visível no `git diff` da máquina de quem
testa — sem esse volume, a edição morreria dentro do container.

**Servidor:** biblioteca padrão do Python (`wsgiref.simple_server` + uma função WSGI escrita à
mão em `src/interfaces/servidor.py`), **sem framework nem dependência nova**. Coerente com a linha
já registrada em ADR-0002 e ADR-0003: os dois preferiram stdlib (`urllib.request`) a um SDK/client
de terceiro sempre que o problema cabia nela. Aqui o escopo do servidor é pequeno (3 rotas de API
+ 2 estáticos) e não justifica a dependência (Flask/FastAPI) que o `quote-service` da Namastex usa
— aquele é código deles, não nosso, e não é precedente que valha para uma decisão nossa.

O servidor **nunca decide nada**: só traduz HTTP para uma chamada de
`aplicacao.servico_conhecimento.ServicoDeConhecimento`, que por sua vez delega a invariante do
marcador para `dominio.ficha_objecao.FichaDeObjecao.publicar` — a mesma disciplina de
`interfaces.cli` (que só chama `aplicacao.servico_conversa`, nunca reimplementa política).

**Invariante da ficha** (issue #43): publicar recusa dígito fora de um marcador `{{...}}` ou
marcador fora de um vocabulário fechado (`dominio.ficha_objecao.MARCADORES_CONHECIDOS`, hoje
ancorado nos campos que já existem em `dominio.preco_cotado.PrecoCotado` — `premio_mensal`,
`franquia`, `plano_nome` — mais `carencia_dias` e `parcela_proporcional`). Resolver o marcador em
número de verdade fica para a frente que ligar a base de conhecimento ao LLM (fora do escopo desta
issue, por texto dela mesma).

**Fora desta entrega:** a "Configuração comercial" (`encaminhar_lead_fora_do_padrao`) depende do
tipo `ConfiguracaoComercial`, que é da frente da #42 (ainda OPEN, sem PR). Não é criada aqui uma
segunda definição do tipo (LEI 11) — entra em PR seguinte, depois do merge da #42.

## Consequências

- **Melhora:** zero dependência de runtime nova — `pyproject.toml` continua só com o grupo `dev`;
  a imagem Docker do serviço não baixa nenhum pacote Python além do próprio projeto. "Sem chave,
  tudo funciona" continua verdadeiro (nenhuma rota exige `.env`).
- **Fica mais caro:** o roteamento HTTP é escrito à mão (sem middleware, sem validação de schema
  automática) — aceitável no tamanho atual (3 rotas de API); cresceria mal além disso.
- **Obrigatório:** todo `id` de ficha que vira nome de arquivo passa por `_validar_id`
  (`src/infra/repositorio_conhecimento_json.py`) — forma de slug fechada, para nenhuma requisição
  conseguir escapar de `conhecimento/objecoes/` (path traversal). O mesmo vale para o estático do
  painel (`_servir_painel`, `src/interfaces/servidor.py`) — caminho resolvido e conferido contra a
  raiz antes de ler o arquivo.
- **Proibido:** o servidor importar `dominio` para decidir algo (só `aplicacao` decide); reescrever
  a validação do marcador fora de `dominio.ficha_objecao` (dono único da regra).
- **Guard que cobra:** `tests/arquitetura/test_fronteiras.py` (`infra` não importa `interfaces`,
  `dominio` não importa nada de fora) roda sobre os módulos novos sem exceção. A invariante do
  marcador tem teste dedicado em `tests/dominio/test_ficha_objecao.py`, replicado na borda HTTP em
  `tests/interfaces/test_servidor.py`.

## Alternativas descartadas

- **SQLite ou banco externo** — descartado pelo dono na #41: "não precisa, e banco custa tempo"
  seguindo a mesma decisão já tomada para a trilha (issue #7); além disso um banco não aparece no
  `git diff`, e a prova exigida pela #43 é justamente ver a edição no diff.
- **Framework web (Flask/FastAPI)** — resolveria roteamento e validação de schema de graça, mas
  adiciona dependência de runtime para 3 rotas, contrariando a linha de ADR-0002/0003. Reavaliar
  se o número de rotas crescer o bastante para o roteamento manual doer mais que a dependência.
- **Editar os JSON à mão, sem tela** — mais simples de implementar, mas falha o critério do
  desafio ("quem testa usa o sistema no navegador", README:23/119) e o dono já descartou essa via.
- **Vocabulário de marcadores aberto (qualquer `{{...}}` aceito)** — mais simples, mas permitiria
  publicar um marcador que a frente do LLM nunca saberia resolver, e o erro só apareceria em
  produção, silencioso. Fechar o vocabulário agora custa uma constante e um teste.
