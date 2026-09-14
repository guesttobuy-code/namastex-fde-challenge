# ADR-0006 — Status conversa 5 estados

- **Status:** aceita
- **Data:** 2026-09-14
- **Issue/PR:** #57, PR 2 de 2

## Contexto

Antes desta frente, "que status tem essa conversa?" tinha DOIS donos calados: `interfaces.painel.
agrupar.estado_da_conversa()` inferia um rótulo de apresentação (`"cotada"`, `"handoff"`,
`"recusada"`, `"cotando"`, `"coletando dados"`, `"em andamento"`) a partir da última `decisao`/
`handoff` da trilha, sem nenhum vocabulário do domínio por trás — e a página "Fila humana"
existia só para mostrar conversas com `handoff`, sem status nenhum, só motivo. O dono pediu 5
status oficiais (Com o agente, Cotada, Aguardando corretor, Em atendimento humano, Encerrada),
botões "Assumir"/"Encerrar" na conversa, filtro por status na tela de chat, cada troca virando
evento na trilha, e o fim da página "Fila humana" como destino próprio (vira atalho de filtro).

Duas restrições vieram no meio do caminho: a issue #58 (frente `ia-responde`) mexe no mesmo caso
de uso (`aplicacao.servico_conversa.conduzir_conversa`) e precisava mergear primeiro; e ela
introduz um SEGUNDO fluxo que produz handoff (`aplicacao.servico_resposta_orientada.
processar_mensagem_livre`, a IA respondendo objeção de preço) que não passa por
`conduzir_conversa` nenhuma.

## Decisão

`StatusDaConversa` (Enum de 5 valores) e a tabela de transições nascem em `dominio.status_conversa`
— dono único (LEI 11), puro, sem I/O. `proxima_transicao_automatica(decisao, resultado)` decide o
status a cada turno automático; `status_atual_da_conversa(eventos)` reconstrói o status de uma
trilha SEM `status_alterado` (trilhas antigas) usando a MESMA tabela — nunca uma segunda regra em
`agrupar.py`. Regra genérica (condição 3 do veredito da coordenação): `TipoDecisao.ENCAMINHAR` de
QUALQUER `MotivoHandoff` — presente ou futuro — vira `AGUARDANDO_CORRETOR`, sem caso especial por
motivo; isso fez o novo `RESPOSTA_ORIENTADA_INDISPONIVEL` (issue #58) funcionar automaticamente,
sem tocar `dominio.status_conversa`.

`MudancaDeStatus` (8º evento da trilha) guarda `de`/`para`/`origem` (`"automatico"` | `"manual"`),
sem identidade de pessoa (decisão já registrada no PLANO do PR 1 da #57). `aplicacao.
servico_status_conversa.registrar_mudanca_de_status(trilha, conversation_id, novo_status, *,
origem)` é o único lugar que grava esse evento — usado pelo turno automático
(`servico_conversa.registrar_status_do_turno`, chamado por uma linha no fim de `conduzir_conversa`),
pela resposta orientada (`servico_resposta_orientada.processar_mensagem_livre`, que não passa por
`conduzir_conversa` e por isso não constrói uma `Decisao` — recebe o `StatusDaConversa` já
decidido) e pelas transições manuais (`assumir`/`encerrar`, os botões).

A tela "Fila humana" (`tela_fila_humana.py`) NÃO foi removida nesta versão: seu catálogo de "todo
motivo com descrição" não tem equivalente em `tela_conversas` (que só mostra o motivo DA conversa
aberta). O item de menu passou a apontar para o Histórico já filtrado (`?status=
aguardando_corretor`) — a página antiga fica órfã de link direto no menu, mas continua existindo e
testada, evitando apagar uma capacidade sem substituto.

## Consequências

**Melhora:** um dono só decide "que status tem essa conversa", em qualquer dos dois fluxos que
produzem handoff hoje (e qualquer um que vier depois, desde que passe por `registrar_mudanca_de_
status`); reconstrução de trilha antiga usa a mesma tabela do turno ao vivo, nunca diverge.
**Fica mais caro:** todo novo fluxo que decide um `TipoDecisao`/handoff fora de `conduzir_conversa`
precisa lembrar de chamar `registrar_mudanca_de_status` explicitamente — não há injeção automática
(coberto por revisão/CONTRACT, não por guard automático ainda). **Obrigatório:** qualquer novo
`MotivoHandoff` que resulte em `ENCAMINHAR` já cai em `AGUARDANDO_CORRETOR` sem código novo — só
`interfaces.painel.motivos.DESCRICAO_MOTIVO` precisa da entrada de texto (cobrado por
`tests/interfaces/painel/test_motivos.py::test_todo_motivohandoff_tem_descricao_registrada`).
**Ponto de extensão para a issue #86** (atendimento contínuo): o cabeçalho da conversa selecionada
em `tela_conversas` fica isolado de propósito, pronto para um rodapé de resposta do corretor, sem
reescrever a tela.

## Alternativas descartadas

- **Guardar `de` como parâmetro de quem chama `registrar_mudanca_de_status`** — descartada: dois
  lugares (quem chama e a própria trilha) poderiam divergir sobre "qual era o status anterior"; a
  função sempre lê da trilha.
- **`assumir`/`encerrar` recebendo `RepositorioDeTrilha` direto (texto literal do PLANO original)**
  — descartada em favor de `ServicoDeTrilha` (o mesmo tipo que `conduzir_conversa`/
  `processar_mensagem_livre` já usavam), pra ter UM gravador só (`registrar_mudanca_de_status`)
  chamado pelos três fluxos, em vez de dois tipos de acesso à trilha para o mesmo evento.
- **Contar "tentativas antes do corretor" (item 6 da #58) por ficha específica** — descartada: o
  LLM recebe todas as fichas publicadas juntas e escreve texto livre, o código nunca sabe com
  certeza qual ficha embasou a resposta; a contagem usa o MENOR limite entre as fichas do contexto
  (leitura conservadora), documentado como limite conhecido no código.
- **Remover `tela_fila_humana.py` nesta versão** — descartada: o catálogo de referência de todos
  os motivos não tem substituto ainda; remover apagaria essa capacidade sem repor.
