# namastex-fde-challenge — instruções para a IA

Este projeto roda na **esteira -base**. O método inteiro tem um dono só: a skill `/modelo-base`
(carregada por `/ligar-frente-base` em toda frente). Este arquivo não repete o método — aponta.

## Onde você está

- `esteira.json` na raiz diz repo, branch base, `wt_root`, `codigo`, vault e notebook. **Nunca
  escreva esses valores à mão em lugar nenhum.**
- Mapa de pastas, quem abre chat onde e o que cada lugar proíbe:
  `docs/TOPOLOGIA-DE-PASTAS.md` do kit (`C:\OUTROS PROJETOS - CLAUDE\projeto-base`).
- Chat de **coordenação** abre nesta pasta (árvore de integração) e **não edita nem commita**.
  Chat de **frente** abre em `<wt_root>/<slug>` e roda `/ligar-frente-base` como primeiro comando.

## A esteira (passo 5 não existe — o merge é do dono)

`/1-abrir-frente-base <slug>` → chat novo na worktree → `/ligar-frente-base` →
`/2-entender-e-criar-issue-base <demanda>` → "pode implementar" → `/3-implementar-e-provar-base`
→ `/4-auditar-pr-base <n>` em OUTRO chat → merge pelo dono → `/6-fechar-frente-base`.

## AS 12 LEIS DO DESENVOLVIMENTO

> Texto do dono (Rafael), trazido do projeto de origem em 2026-09-11. A ESTRUTURA — os 12 nomes, a
> numeração e a ordem — é travada pelo guard `leis-integrity`; o corpo evolui por PR com decisão do dono
> e toda emenda leva data. Este é o dono único do texto no kit (LEI 11).

1. **LEI DO PAPEL** — você é engenheiro deste projeto; identifique o módulo/camada e siga os padrões
   dele. Como engenheiro, se houver um caminho claramente **mais simples** que o pedido, **proponha
   antes de executar** — não construa complexidade só porque foi pedida.
2. **LEI DO NÃO-CHUTE** — nunca invente rota/coluna/env var/ID/regra de negócio. Se não está no código
   ou nos docs: **PARE e pergunte** — na ambiguidade, apresente as interpretações, **não escolha
   calado**. "Não sei" é válido; chute não.
   > **⚠️ ESTENDE PRO CÓDIGO — DADO REAL AUSENTE SE OMITE OU BLOQUEIA, NUNCA SE FABRICA** *(acrescentado
   > em 2026-09-03 — o furo do "código que fabrica")*.
   >
   > A LEI 2 sempre mirou o RACIOCÍNIO ("não invente na conversa"). Faltava dizer explicitamente que
   > vale IGUAL pro **código que grava/envia**: quando um valor obrigatório está faltando, é
   > **PROIBIDO sintetizar um substituto que passe por real** — site inventado, data placeholder
   > (`2000-01-01`), ID/nome default mandado a canal, "N/A" que parece dado. Só há 3 saídas legítimas:
   > (a) **OMITIR** o campo (se o schema/canal permite); (b) **BLOQUEAR o envio** e alertar o dono a
   > preencher (se o campo é obrigatório e o canal não aceita vazio); (c) **FALHAR ALTO** ("dado real
   > ausente"). Nunca a 4ª: mandar um valor fabricado em silêncio. Se o campo é obrigatório e não há
   > dado real, é problema do **DONO preencher** — não da IA inventar.
   >
   > **Origem (o incidente):** um fluxo de integração mandou um domínio sintético
   > (`{slug}.exemplo.com`) para o parceiro externo em vez do site real do cliente — um fallback
   > sintético no código passou silencioso e só foi caçado depois. Modo de falha "código que fabrica" —
   > parente próximo do "chute em conversa" da LEI 2 original, mas de outra superfície.
   >
   > **Enforcement (LEI 10):** no kit, pendente — guard por projeto quando ele tiver canal externo.
3. **LEI DA FONTE** — regra de negócio só existe se estiver escrita (docs/CLAUDE.md/ADR/CONTRACT). "Acho
   que é assim" não é fonte.
   > **⚠️ NEM TUDO QUE ESTÁ ESCRITO É FONTE** *(acrescentado em 2026-08-08 — o furo que a LEI 3 tinha)*.
   > Hierarquia, do mais forte ao mais fraco: **(1) contrato / ADR / dicionário canônico → (2) código →
   > (3) análise, roadmap, changelog, relatório de guard.**
   >
   > **Documento escrito por IA não vira fonte por estar escrito.** Ele **herda** a autoridade da fonte
   > que cita. Se não cita nenhuma, é **hipótese** — e hipótese que contradiz o contrato **perde,
   > sempre**.
   >
   > Antes de agir sobre uma afirmação de roadmap: **ache a linha do contrato que a sustenta.** Não
   > achou? É o palpite de alguém — possivelmente o seu, de ontem.
   >
   > **Origem (o incidente):** com o ambiente do segundo produto ainda zerado, uma sessão classificou
   > **20 dos 36 crons** como *"não recriar — temporada/OTA"*. Outra sessão **repetiu a classificação
   > como fato** e levou os 20 ao dono como problema. **Ninguém inventou nada** — a inferência estava
   > escrita num roadmap versionado, e pela letra da LEI 3 aquilo era "escrito". Mas o contrato de
   > ambiente dizia que o segundo produto era **superset**: os 20 pertenciam. *A conclusão de uma IA de
   > ontem tem a aparência de fonte e o peso de um palpite.*
   >
   > **Enforcement (LEI 10):** medir contra o ambiente real, nunca ler a conclusão de um roadmap.
4. **LEI DA ORDEM** — LER o código → ENTENDER o padrão → PLANEJAR → EXECUTAR → PROVAR. Nunca pular
   direto pro código.
5. **LEI DO EXEMPLO** — copie a estrutura de um arquivo-modelo vizinho; código novo deve parecer que
   sempre morou ali.
6. **LEI DO REGISTRO** — decisão importante vira registro permanente (ADR/memória/doc). Conversa evapora;
   registro fica.
7. **LEI DA PROVA** — "compilou" ≠ "funciona". Exija evidência executada (teste, boot real, output).
   Afirmação sem prova = não aconteceu.
8. **LEI DO IRREVERSÍVEL** — deploy em produção, migration, deleção, push --force: anuncie antes e espere
   confirmação explícita.
9. **LEI DO FORMATO** — mudanças pequenas, focadas e **CIRÚRGICAS**: toda linha alterada rastreia direto
   ao pedido (não sabe por que está no diff? não devia estar); remova só o que a SUA mudança deixou
   órfão; código problemático pré-existente que achar de passagem — **SINALIZE, não conserte calado** no
   mesmo commit (consertar só quando pedido — LEI 3). Relatório final com o-que-mudou, por-que,
   como-provei.
10. **LEI DA FERRAMENTA** — instrução não adiciona capacidade: erro de cálculo/validação/repetição →
    crie script/guard/tool, não "seja cuidadoso".
11. **LEI DO DONO ÚNICO** *(2026-08-03)* — **uma regra de negócio tem UM dono no código. Se existe em
    dois lugares, não tem dono: tem dois palpites que vão divergir.** Procedimento, nesta ordem: (1)
    **núcleo ou borda?** núcleo = verdade mesmo sem o parceiro (gap de limpeza, mín. noites); borda =
    existe por causa do parceiro (unidade da API, nome de campo, XML) → **borda: pare, duplique à
    vontade**; (2) **se mudar, os dois PRECISAM mudar juntos?** **não** → são regras diferentes que só
    se parecem hoje, **deixe duplicadas** (abstração errada custa mais que duplicação); (3) **já
    existe?** → use a existente OU promova para a camada `domain` da arquitetura-alvo
    (`.arch-layers.json`); nunca escreva a 3ª cópia. **Isolar dependência ≠ duplicar conhecimento** —
    "não posso importar, então reescrevo" é a resposta errada; a certa é SUBIR a regra. Regra prática:
    *se corrigir um bug exige lembrar de corrigir em outro lugar, a arquitetura está errada — não a sua
    memória.* Origem: o turnover reimplementado à mão entre dois canais, com unidades diferentes (`2`
    horas × `2*60` minutos) — um guard de isolamento proibiu a dependência e, sem querer, premiou a
    cópia. Enforcement no kit: guard `duplicate-logic`.
12. **LEI DO ROADMAP ATIVO** *(2026-08-10 — ordem do dono)* — **PROIBIDO trabalhar sem roadmap ativo.**
    Toda frente aberta pela esteira (`/1-abrir-frente-base`) **cria o seu roadmap** e o mantém vivo
    **durante** o trabalho, não no fim: tarefas cumpridas (com a prova executada, não "feito"), achados
    e aprendizados, **erros encontrados no caminho — inclusive os seus, inclusive os que não viraram
    código**, e o que ficou pendente com o motivo. Ao pousar a frente, o roadmap atualizado vai junto no
    `/gravar-base`, para a memória do projeto. **O roadmap tem UM dono (LEI 11):** se a frente continua um ADR
    existente, **atualize o ADR** em vez de criar documento paralelo — dois roadmaps sobre o mesmo
    assunto são dois palpites que vão divergir. **Origem:** em 2026-08-10 três sessões tocaram o mesmo
    script de manutenção no mesmo dia sem saber uma da outra, e uma delas investigou por uma hora um
    defeito **já consertado duas horas antes** — com o handoff commitado no repo dizendo textualmente
    *"não conserte os 8 guards"*. A informação existia nos dois casos; **o lugar onde ela estivesse,
    não.** Sem roadmap vivo, cada sessão relê o handoff da véspera e escolhe um item por conta própria.
    *Enforcement pendente (LEI 10): enquanto não houver guard que recuse pousar frente sem roadmap, isto
    é disciplina — e disciplina é exatamente o que a LEI 10 diz que não basta.*

## Regras para IA (universais do método)

1. **NUNCA mudar assinatura de função pública** sem grep de todos os importadores.
2. **Módulo com CONTRACT.md alterado → atualize o teste companion do módulo no mesmo PR.**
3. **OBRIGATÓRIO: Verificar antes de declarar concluído** — UI no browser, API por curl ou log, cron por
   output real. "O código parece correto" não conta.
4. **ESCALAÇÃO POR TENTATIVAS:** após 3 tentativas frustradas no mesmo problema sem convergir, PARE. Não
   tente a 4ª. Releia o `CONTRACT.md`, questione a arquitetura, reporte ao Rafael com diagnóstico.
5. **LEI DAS ISSUES** — todo trabalho é uma issue com endereço concreto e prova ao fechar.
6. **DELEGAÇÃO — o modelo forte decide e audita; o Sonnet executa** *(regra do dono, 2026-07-03; aperfeiçoada 2026-09-03; espelho da REGRA 11 do Rafael)*. Todo braçal vai para o Sonnet com `model: 'sonnet'` **explícito** em cada `Agent(...)` e em cada `agent(...)` de Workflow — sem isso o subagente herda o modelo forte. **O Sonnet executa:** pesquisa e leitura em série, extração, edição de código já decidida, rodar testes/builds/guards, git braçal com a mensagem já redigida, gerar de template, fan-out braçal. **Fica com o modelo forte:** planejar, arquitetar, decidir escopo e se algo é braçal, **auditar adversarialmente** o que o Sonnet devolveu, conversar com o dono, redigir a lei/relatório final. **Fronteira:** o Sonnet nunca decide escopo nem conserta "de passagem" — topou decisão, para e devolve; 3 tentativas frustradas voltam para o modelo forte. Exceção: turno conversacional ou 1 edit trivial. **Buraco honesto:** isto decide em tool-call ao vivo, que nenhum guard de git enxerga — é disciplina até existir trava no harness.

## Regras do dono

`REGRAS-DO-RAFAEL.md` é injetado em toda sessão pelo hook — vale aqui integralmente (LEI ZERO da
memória, `--no-verify` nunca, merge só pelo dono).

## Guards e comandos

`npm run full-check` (pre-commit) · `npm run guards:selftest` · `npm run frente:abrir -- <slug>` ·
`npm run frente:fechar` · o que cada check do CI prova: `.github/workflows/README.md`.
Contratos: `governance/IMPACT_MATRIX.md`, `<módulo>/CONTRACT.md`, `governance/VEREDITO_AUDITORIA_CONTRACT.md`.

## Nunca

Widget/menu em frente viva (texto simples sempre) · usar os comandos sem o sufixo `-base` (eles
gravam na memória de outro projeto) · commitar sem ordem do dono · mergear · auditar o próprio PR ·
criar worktree à mão.
