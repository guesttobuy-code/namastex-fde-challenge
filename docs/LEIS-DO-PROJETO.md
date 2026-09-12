# Leis deste projeto — valem para todo chat, em toda frente

> **Por que este arquivo existe.** As leis viviam só na memória do chat de coordenação. Um chat de frente,
> aberto numa worktree, **não lê aquela memória** — tem a sua própria. Resultado: regra que o dono deu
> alcançava um chat e não alcançava os outros. Instrução que não mora onde o executor lê **não existe**.
> Aqui é o lugar onde todo mundo lê.
>
> As 12 Leis do desenvolvimento estão no `CLAUDE.md` e continuam valendo. Estas são as **deste projeto**,
> dadas pelo dono, e complementam aquelas.

---

## 1. Push e merge são do dono. Commit é livre.

**Commite quantas vezes quiser** na sua branch — não precisa pedir. O portão é o pre-commit: guard vermelho
não vira commit, e **`--no-verify` é proibido**, sempre.

**Push:** só o da sua própria branch, para abrir o PR. Push na `main`, force-push em branch alheia ou qualquer
outra publicação: **ordem do dono**.

**Merge: nunca é seu.** Em nenhuma forma, nem com CI verde, nem com auditoria aprovada, nem "porque é só docs".
Seu estado terminal é **PR aberto, CI verde, prova colada**.

## 2. Todo achado e todo aprendizado é registrado — na hora

**Achado** é o que você descobre e não estava escrito: bug, pegadinha, dado sujo, limitação de ferramenta,
suposição derrubada por medição. **Aprendizado** é o que muda o jeito de trabalhar daqui para frente.

Registre **no momento em que acontece**, com endereço concreto (`arquivo:linha`, comando, saída colada) e
separando o que você **mediu** do que **inferiu**. Achado que ficou só no chat é achado perdido.

O lugar é a issue: a da sua frente para o que é dela, a issue-diário (`#16`) para o que atravessa frentes.

## 3. Todo erro vira aperfeiçoamento

Nas palavras do dono: *"erros são úteis quando se tornam melhorias e não descaso"*.

Um achado só está encerrado quando percorre os quatro passos:

1. **registrar** com prova;
2. **consertar** o caso concreto;
3. **impedir a CLASSE** — o que impede essa família de erro de voltar? Guard, teste, mudança de desenho,
   regra escrita onde o executor lê;
4. **fechar o laço** — dizer, no registro, qual foi a melhoria; ou declarar em voz alta por que ela não cabe
   agora e onde ficou agendada.

Ao fechar um achado, responda por escrito: **"o que impede isso de voltar?"** Se a resposta for "atenção", a
resposta está errada.

## 4. Tudo o que é nosso mora no repositório

Nada de pasta externa como fonte ou apoio. Achou algo nosso fora do lugar? **Organize dentro** — mover para
`docs/`, `tests/`, `ai-logs/` — nunca criar atalho ou referência para fora.

Exceção declarada: ferramenta de máquina (o kit que originou `scripts/esteira/`, `uv`, Docker, `gh`) pode
viver fora, porque não é entrega. **Tudo o que RODA no projeto está dentro do repositório.**

## 5. Rigor com documentação e registro

O dono é explícito: *"o maior problema que encontro com dev de IA é a falta de detalhes, documentação e
planejamento estratégico"*. Então:

- resumo que perde detalhe não serve — registre com a fonte (`arquivo:linha`, comando, saída);
- requisito explícito nunca some do plano;
- planejamento antes de execução: objetivo, critério de aceite, riscos, o que fica fora;
- toda afirmação separa **medido** de **inferido**;
- erro próprio se confessa na hora, e vira aprendizado registrado.

## 6. Decisão importante vira ADR

Decisão de arquitetura não pode viver só em comentário de issue. ADR nasce por comando
(`npm run adr:nova -- "<slug>"`), que reserva o número — nunca criando o arquivo à mão.

## 7. Pare quando a decisão não é sua

Escopo, critério técnico que afeta outras frentes, mexer em guard, reescrever histórico, qualquer coisa que
cheire a "já que estou aqui": **pare e fale com a coordenação**, com a medição na mão.

Isso não é burocracia — é o que impede uma frente de decidir por todas. E, na prática deste projeto, **as três
vezes em que um chat parou e perguntou, o achado era real**.

## 8. Texto simples, nunca menu ou widget

Enquanto um menu espera resposta, a sessão fica surda para todas as mensagens, inclusive as da coordenação.
Pergunte em texto, diga quais são as alternativas e qual você recomenda, e siga com o que não depende da resposta.

---

## Onde cada coisa é registrada

| O que | Onde |
|---|---|
| Trabalho da sua frente: plano, prova, discussão | a issue da frente |
| O que atravessa frentes: turno, bloqueio, medição que muda o plano | issue-diário **#16** |
| Veredito de auditoria | comentário no PR, citando o sha auditado |
| Achado fora do seu escopo | issue própria, `tipo:achado`, e avise a coordenação |
| Decisão de arquitetura | ADR em `governance/adr/` |
| Mudança de código | linha no `CHANGELOG.md` citando a issue |
