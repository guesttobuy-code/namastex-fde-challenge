# Privacidade e mascaramento de PII — decisões e limites (F4, issue #7)

> Este arquivo é dono único das decisões de privacidade do projeto (R7, coordenação em #16 — o
> `README.md` recebe só uma linha de ponteiro pra cá, para evitar 12 frentes escrevendo parágrafo no
> mesmo arquivo). Qualquer decisão nova sobre PII/LGPD entra aqui, não em outro lugar.

## Decisão consciente: não pedimos CPF

A `/quote` não usa CPF em nenhum campo (`quote-service/app/quote_logic.py`) — é minimização de dado
na origem, não só mascaramento na saída. O agente nunca solicita CPF ao lead. Se o lead oferecer o
CPF por conta própria (o dataset mostra que isso acontece em 100% das conversas sintéticas), o valor
é mascarado na fronteira igual a qualquer outra PII — ver abaixo — mas nunca é usado para decidir
nada.

## O que é mascarado, e onde

`src/dominio/redator_pii.py::redigir_texto` cobre CPF (com e sem pontuação), CEP (com hífen e com
espaço), telefone (com e sem `+55`), e-mail, placa no padrão Mercosul e no padrão antigo, e nome
próprio quando informado explicitamente (`nomes_conhecidos`). `aplicacao/servico_trilha.py` é a
**única porta de entrada** para gravar um evento na trilha — nenhum código grava direto no
`RepositorioDeTrilha`, então nenhum caminho de escrita escapa do redator.

## Por que a extração casa pelo FORMATO, não pela palavra "CPF"/"CEP"

O gerador do dataset (`scripts/generate_dataset.py:113`) monta o bloco de PII com
`", ".join(pii_bits).capitalize()`. Como `.capitalize()` só mantém maiúscula a **primeira** letra do
bloco inteiro, qualquer `CPF`/`CEP` que não seja a primeira palavra vira `cpf`/`cep` minúsculo —
medido ao vivo, com exemplos reais de `dataset/sample.jsonl` (`"cep 26703-384, cpf 389.083.863-43"`).

Uma extração que procurasse a palavra `"CPF:"` para achar o valor seguinte quebraria com isso. Por
isso `redigir_texto` nunca âncora em palavra-rótulo: cada padrão casa pelo **formato** do próprio
valor (dígitos e separadores) — `\d{3}\.\d{3}\.\d{3}-\d{2}` acha o CPF esteja ele depois de "CPF",
"cpf" ou de nenhuma palavra. Dígito e pontuação não têm maiúscula/minúscula, então `(?i)` **não** é
o que protege CPF/CEP/telefone — são padrões só de dígito, a flag é redundante ali (provado em
`tests/dominio/test_redator_pii.py::test_padrao_de_cpf_nao_depende_de_case_por_nao_ter_letra`).

Onde `(?i)` É a invariante de verdade: a **placa**, porque o char class do padrão é `[a-z]` e o
dataset sempre gera a placa em maiúsculo (`GGE4X30`) — sem a flag, o padrão não bate
(`test_padrao_de_placa_precisa_de_case_insensitive_porque_tem_letra`). E o **nome próprio**, via
`re.IGNORECASE` explícito no loop de `nomes_conhecidos`. A flag continua em todo padrão por
consistência, mesmo onde é redundante — não custa nada e evita alguém tirá-la "para simplificar" e
quebrar a placa sem perceber.

## Limite conhecido, declarado (não escondido)

A varredura por regex só pega os formatos que conhecemos:

- CPF: com pontuação (`123.456.789-01`) e sem pontuação (`12345678901`, fixture manual).
- Telefone: com `+55` e sem (fixture manual). Não cobre formatos internacionais fora do Brasil.
- CEP: com hífen e com espaço (fixture manual). Não cobre CEP sem separador (`01310100`) — colidiria
  demais com outros números de 8 dígitos e o custo de falso positivo superaria o ganho.
- Placa: padrão Mercosul e padrão antigo (fixture manual).
- Nome próprio: **não usa NER.** Só redige o que o chamador informa explicitamente em
  `nomes_conhecidos` (ex.: o `sender_name` da conversa). Um nome mencionado que não esteja nessa
  lista passa intacto — é o ponto cego mais real desta frente, e fica escrito aqui em vez de
  escondido atrás de "cobre nome próprio".

Onde a varredura pode falhar, o teste de fixture manual (`tests/dominio/test_redator_pii.py`) marca
o limite explicitamente, em vez de fingir cobertura total.

## O que fica de fora desta frente

Banco de dados (JSONL append-only basta — decisão já na issue #7), painel visual (F10), pipeline do
dataset (F8), adaptador de LLM real (F6 usa o redator na fronteira; aqui só existe o dublê espião de
teste, `tests/integracao/test_adaptador_espiao.py`).
