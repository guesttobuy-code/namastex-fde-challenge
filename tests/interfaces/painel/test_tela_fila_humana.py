# catraca-reduz-de-proposito: tela_fila_humana.py e este arquivo de teste foram REMOVIDOS (issue
# #57, P14, PR 2 de 2, pre-auditoria do PR #87) -- a pagina "Fila humana" saiu, o item do menu
# aponta pro Historico ja filtrado (S10, interfaces/painel/layout.py). Nenhum caso de teste sumiu:
# test_regra_de_regras_a_lista_exibida_e_exatamente_a_do_enum -> tests/interfaces/painel/
# test_tela_regras.py::test_regra_de_regras_motivos_de_handoff_e_exatamente_o_enum (o catalogo ja
# existia la, so faltava a descricao); test_handoff_da_fixture_aparece_com_motivo_e_contexto,
# test_campo_ausente_no_contexto_coletado_vira_buraco_nao_branco, test_card_com_contato_mostra_
# nome_e_whatsapp, test_card_sem_contato_mostra_nao_informado, test_card_sem_o_parametro_contatos_
# mostra_nao_informado, test_card_de_handoff_que_nao_e_lead_quer_contratar_tambem_mostra_o_contato_
# quando_existe -> tests/interfaces/painel/test_tela_conversas.py (motivo/contato/contexto agora
# mostrados na conversa selecionada, S12); test_todo_motivohandoff_tem_descricao_registrada ->
# tests/interfaces/painel/test_motivos.py (ja migrado num commit anterior deste mesmo PR).
# test_botoes_de_acao_ficam_desabilitados_com_motivo NAO tem equivalente -- testava os botoes
# desabilitados por design (fora do escopo da frente original, F10/#13); esta frente os torna
# FUNCIONAIS de verdade (Assumir/Encerrar chamando a aplicacao), capacidade nova, nao perdida.
# test_sem_handoff_mostra_buraco nao tem equivalente proprio -- o comportamento de campos.buraco()
# ja e coberto exaustivamente por tests/interfaces/painel/test_campos.py.
