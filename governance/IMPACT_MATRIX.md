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
|  |  |  |  |  |

## Regras

- **Erro se concentra nas BORDAS.** A refatoração mudou o dono do arquivo — o dono novo passou a
  testar? A migration mudou a coluna — quem lê passou a tratar o novo shape? Onde a informação
  atravessa uma borda, é onde ela cai. Esta matriz existe para nomear as bordas.
- **Dois lugares que decidem o mesmo valor = dois donos (LEI 11).** Ache-os no passo 2 e deixe um.
- Atualize esta matriz **no mesmo PR** que cria uma dependência nova. Matriz velha é pior que
  nenhuma: ela afirma que não há vizinho.
