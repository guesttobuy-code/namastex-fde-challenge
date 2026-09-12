# CONTRACT — dominio

**Dono:** `src/dominio/` (F2, issue #5) — **Vizinhos:** ver `governance/IMPACT_MATRIX.md`

## O que este módulo é dono de

- O tipo do preço (`PrecoCotado`), a política de decisão (`politica.decidir`) e o vocabulário
  fechado dos motivos de handoff (`MotivoHandoff`). Nenhum outro módulo decide estas três coisas.

## INVARIANTES (o que nunca pode ser falso)

| # | invariante | teste que a cobre | exceção |
|---|---|---|---|
| I-1 | `PrecoCotado` só nasce (`de_resposta_http_200`) de uma resposta com todos os campos de uma cotação bem-sucedida (`plano_id`, `plano_nome`, `premio_mensal`, `franquia`, `coberturas`, `moeda`) | `tests/dominio/test_preco_cotado.py::test_de_resposta_http_200_exige_campos_da_cotacao` | `ValueError` citando o(s) campo(s) ausente(s) |
| I-2 | `Decisao(tipo=ENCAMINHAR)` sempre carrega `reason_code`; nenhum outro tipo aceita `reason_code` | `tests/dominio/test_decisao.py::test_encaminhar_exige_reason_code` e `test_decisao_fora_de_encaminhar_nao_aceita_reason_code` | `ValueError` |
| I-3 | `ResultadoDaCotacao`: `preco` e `motivo` são mutuamente exclusivos — `SUCESSO` exige `preco`/recusa `motivo`; qualquer outro status exige `motivo`/recusa `preco` | `tests/dominio/test_resultado_cotacao.py` | `ValueError` |
| I-4 | `redator.montar_mensagem` só aceita `PrecoCotado` — nenhum outro tipo (dict, str, None) monta texto com valor monetário | `tests/dominio/test_redator.py::test_montar_mensagem_recusa_*` | `TypeError` |

## Entradas e saídas públicas

<!-- R1 (issue #16): src/dominio/__init__.py fica vazio — importe pelo módulo concreto. -->

- `dominio.estado_conversa.EstadoDaConversa` — dataclass, sem função pública além do construtor.
- `dominio.resultado_cotacao.ResultadoDaCotacao` / `StatusCotacao` — `ResultadoDaCotacao.sucesso|recusa_de_negocio|erro_de_payload|indisponivel|timeout(...)` → `ResultadoDaCotacao`.
- `dominio.preco_cotado.PrecoCotado.de_resposta_http_200(quote_attempt_id: str, conversation_id: str, resposta: dict)` → `PrecoCotado`.
- `dominio.decisao.Decisao` / `TipoDecisao` / `MotivoHandoff` (Enum fechado, R5 do #16).
- `dominio.politica.decidir(estado: EstadoDaConversa, resultado: ResultadoDaCotacao | None)` → `Decisao`.
- `dominio.validacao.cep_valido(str) -> bool` · `data_iso_valida(str) -> bool` · `campos_obrigatorios_faltantes(dict) -> frozenset[str]`.
- `dominio.redator.montar_mensagem(preco: PrecoCotado) -> str`.

## O que NÃO é responsabilidade deste módulo

- Chamar a `/quote` (porta `PortalDeCotacao`, camada `aplicacao`, F3).
- Gerar `quote_attempt_id` (atribuído por quem chama a porta, antes da chamada).
- Elegibilidade (faixa etária, idade do veículo, região) — decidida pela `/quote`; `validacao.py`
  cobre só formato.
- Gravar trilha e provar o fluxo ponta-a-ponta "todo valor monetário no texto final bate com uma
  cotação bem-sucedida" — isso é da F4 (`RepositorioDeTrilha`) + interfaces.

## Decisões registradas

- 2026-09-12 — Ajuste 3 do veredito de auditoria do PLANO (#5): a exceção da invariante I-1 é
  `ValueError` (payload inválido), nunca `KeyError`.
- 2026-09-12 — R1/R5 da coordenação (#16): `__init__.py` vazio (sem reexport); `MotivoHandoff` é
  Enum fechado, dono deste módulo; `erro_de_payload`/`timeout` viram `ENCAMINHAR`.
- F4 (#7) acrescenta uma seção própria ao final deste arquivo depois que a F2 mergear (R2, #16) —
  append no fim, nunca editando as seções acima.

---

## Seção da F4 (issue #7) — eventos da trilha e redator de PII

**Dono:** `src/dominio/eventos_trilha.py`, `src/dominio/redator_pii.py`.

- O formato dos 7 eventos da trilha auditável (`mensagem_recebida`, `mensagem_enviada`,
  `tentativa_de_cotacao`, `decisao`, `handoff`, `erro_marcado`, `correcao_registrada`) e a lógica
  pura de mascaramento de PII (`redigir_texto`). Nenhum outro módulo decide esses dois formatos.

| # | invariante | teste que a cobre |
|---|---|---|
| I-5 | `redigir_texto` nunca deixa CPF, CEP, telefone, e-mail ou placa (formatos medidos) sobreviver na saída | `tests/dominio/test_redator_pii.py` |
| I-6 | `(?i)` só é load-bearing em padrão com letra (placa, e-mail, nome via `nomes_conhecidos`) — em CPF/CEP/telefone (só dígito) é redundante, não corretivo | `test_padrao_de_cpf_nao_depende_de_case_por_nao_ter_letra` / `test_padrao_de_placa_precisa_de_case_insensitive_porque_tem_letra` |
| I-7 | `Handoff.reason_code` guarda `str` (o `.value` do `MotivoHandoff` desta camada), nunca importa o Enum | `tests/dominio/test_eventos_trilha.py::test_handoff_guarda_reason_code_como_string_nunca_enum` |

A garantia de que nada escapa do redator (todo campo textual de um evento passa por `redigir_texto`
antes de qualquer escrita) é de `aplicacao.ServicoDeTrilha` — ver `src/aplicacao/CONTRACT.md`, I-1.
