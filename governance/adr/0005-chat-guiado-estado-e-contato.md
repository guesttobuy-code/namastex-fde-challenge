# ADR-0005 — Estado da conversa em memória, painel regenerado por evento, contato fora do git

- **Status:** proposta
- **Data:** 2026-09-13
- **Issue/PR:** #46

## Contexto

A issue #46 (F14, PR 2 de 2) liga o chat centralizado ao agente real (`aplicacao.servico_conversa`)
por trás do servidor local do ADR-0004. Três decisões de arquitetura ficaram em aberto no corpo da
issue, cada uma com "vira ADR 0005 se houver alternativa real":

1. **Estado entre turnos.** O chat faz uma pergunta por vez; o servidor precisa lembrar o que já
   foi respondido entre uma requisição HTTP e a próxima da mesma conversa. `EstadoDaConversa` é
   imutável (`@dataclass(frozen=True)`) e hoje só existe dentro do processo da CLI, que roda um
   loop único — não há precedente de estado sobrevivendo entre requisições HTTP.
2. **O painel (`interfaces.painel.gerar`) só é gerado em build-time do Docker** (achado B1 do
   PR #45/#43: `RUN python -m interfaces.painel.gerar` no `Dockerfile`, a partir de
   `examples/*.jsonl`). Uma conversa nova feita ao vivo pela tela do chat grava eventos na trilha
   em runtime, mas o painel (Rastreio, Histórico de atendimentos, Fila humana) só reflete o que
   existia no momento do build — a issue exige "captura e trilha de uma conversa completa pela UI
   ... aparecendo no Rastreio" (seção "Pronto quando").
3. **Contato do lead (nome, WhatsApp, e-mail).** A issue exige (seção C) que esses três campos
   nunca apareçam em claro na trilha, no painel estático ou no `git diff`, mas o corretor precisa
   deles de verdade para ligar — e a Fila humana (que hoje é gerada estaticamente a partir só da
   trilha) precisa mostrá-los.

`pyproject.toml` não declara dependência de runtime nenhuma (ADR-0004): as três decisões abaixo
mantêm essa linha — nenhuma pede banco, fila ou serviço novo.

## Decisão

**1. Estado entre turnos: dicionário em memória do processo do servidor**, chave
`conversation_id`, valor `EstadoDaConversa`. Módulo `src/interfaces/servidor.py`. **Perdido ao
reiniciar o processo** — limite aceito e declarado (decisão da coordenação, 13/09/2026): é a opção
mais simples que atende o "Pronto quando" da issue (uma conversa completa numa sessão do
navegador), e o prazo da entrega não comporta avaliar Redis/arquivo de sessão/cookie assinado só
para isto.

**2. O servidor regenera o painel a cada evento novo gravado na trilha**, chamando
`interfaces.painel.gerar.gerar_paineis()` de novo depois de cada `conduzir_conversa` (não substitui
a geração em build-time do `Dockerfile`, que continua servindo o clone limpo com as trilhas de
exemplo). O painel continua sendo view derivada e estática em disco — só passa a ser recalculada
com mais frequência, sem virar rota dinâmica nem introduzir cache.

**3. O contato do lead mora fora do git**, num par porta+adaptador novo
(`aplicacao.portas.repositorio_contato.RepositorioDeContato` /
`infra.repositorio_contato_json.RepositorioDeContatoJSON`), um arquivo por lead em
`contato/leads/<conversation_id>.json`, mesmo molde de `RepositorioDeConhecimento`/
`RepositorioDeTrilha` (LEI DO EXEMPLO). `contato/` entra no `.gitignore` e ganha volume próprio no
`docker-compose.yml` (mesma razão do volume de `conhecimento/`: sem ele, o dado morre dentro do
container). `gerar_paineis()` ganha um parâmetro opcional `repositorio_contato` — só
`tela_fila_humana.render()` o usa, para juntar nome/WhatsApp ao card sem o dado nunca passar pelos
eventos da trilha nem pelo `RepositorioDeTrilha`.

## Consequências

- **Melhora:** o Rastreio, o Histórico de atendimentos e a Fila humana passam a refletir conversas
  reais feitas pela tela, não só as trilhas de exemplo do build. O contato do lead nunca aparece em
  `git diff`, `git log` nem em nenhum artefato versionado.
- **Piora / custo aceito:** conversa em andamento não sobrevive a um restart do servidor (usuário
  precisaria recomeçar); regenerar o painel inteiro a cada evento é `O(eventos totais)`, não
  incremental — aceitável para o volume de uma demo/desafio, não para produção real.
  **Guard/teste que cobra:** `tests/infra/test_repositorio_contato_json.py::test_git_check_ignore`
  roda `git check-ignore contato/leads/<id>.json` de verdade; `tests/interfaces/test_servidor.py`
  prova que uma conversa nova aparece no painel regenerado sem reiniciar o processo.
- **Passa a ser PROIBIDO:** qualquer código novo escrever nome/WhatsApp/e-mail num `EventoTrilha`
  ou em `contexto_coletado` — o único caminho de escrita é `ServicoDeContato`.

## Alternativas descartadas

- **Redis ou sessão em arquivo para o estado entre turnos** — dependência nova de infraestrutura
  sem necessidade real no prazo do desafio; o `pyproject.toml` fica zero-dependência (ADR-0004).
- **Cookie assinado carregando o estado no cliente** — exporia `EstadoDaConversa` (incluindo
  possivelmente PII coletada) no navegador do lead; rejeitado por privacidade, não por custo.
- **Fila humana virar rota dinâmica própria** (`GET /fila-humana` renderizando ao vivo, sem
  regenerar o painel inteiro) — mais preciso, mas quebra o padrão "painel = arquivo estático
  gerado" que as outras 5 telas do painel já seguem (LEI 11: um dono só da forma como o painel
  existe). Descartado em favor de regenerar tudo junto.
- **Contato do lead dentro de `conhecimento/`** (reaproveitando o volume/diretório já existente do
  ADR-0004) — `conhecimento/` é dado de PRODUTO (fichas de objeção, não sensível); contato é PII.
  Dois donos diferentes (LEI 11 das 12 Leis do Desenvolvimento) não podem morar na mesma pasta só
  porque os dois "são JSON num volume".

<!-- Regras: numeração contígua (cobrada por adr-sequence); nunca edite um ADR aceito — escreva outro que o substitui. -->
