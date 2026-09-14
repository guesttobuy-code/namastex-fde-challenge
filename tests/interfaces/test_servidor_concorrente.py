"""Vermelho-antes da issue #110: `wsgiref.simple_server` de thread única trava TODOS os pedidos
quando uma conexão fica aberta e ociosa, ou durante uma resposta lenta — e, ao virar concorrente
(`ThreadingMixIn`), escrita sem proteção no painel/trilha/estado pode corromper o que duas
requisições tocam ao mesmo tempo. Os 4 testes aqui cobrem o roteiro de aceite S1-S4 publicado na
issue: `test_servidor.py` chama o `app` WSGI direto (sem socket) — aqui o que muda É o transporte
(S1/S2) e a concorrência real de threads (S3/S4), por isso os testes abrem um socket de verdade ou
disparam chamadas concorrentes com `ThreadPoolExecutor`."""

from __future__ import annotations

import json
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPConnection
from pathlib import Path
from wsgiref.simple_server import WSGIServer, make_server

import pytest

from aplicacao.servico_conhecimento import ServicoDeConhecimento
from aplicacao.servico_configuracao_comercial import ServicoDeConfiguracaoComercial
from aplicacao.servico_contato import ServicoDeContato
from dominio.preco_cotado import PrecoCotado
from dominio.resultado_cotacao import ResultadoDaCotacao
from infra.cliente_quote import FakePortalDeCotacao
from infra.repositorio_configuracao_comercial_json import RepositorioDeConfiguracaoComercialMemoria
from infra.repositorio_conhecimento_json import RepositorioDeConhecimentoMemoria
from infra.repositorio_contato_json import RepositorioDeContatoMemoria
from interfaces.painel.gerar import gerar_paineis

from tests.interfaces.test_servidor import _chamar, _com_planos_completo


def _server_class():
    """Usa `ServidorHTTPConcorrente` quando já existir (pós-conserto) — antes do conserto este
    nome não existe em `interfaces.servidor` e o teste roda contra o `WSGIServer` padrão de hoje,
    de thread única, reproduzindo o travamento de verdade (S1/S2 ficam vermelhos)."""
    import interfaces.servidor as servidor_modulo

    return getattr(servidor_modulo, "ServidorHTTPConcorrente", WSGIServer)


def _app_de_teste(*, tmp_path, buscar_planos=lambda: None, portal_de_cotacao=None):
    from interfaces.servidor import criar_app

    painel_dir = tmp_path / "painel-saida"
    trilha_dir = tmp_path / "trilha"
    servico = ServicoDeConhecimento(RepositorioDeConhecimentoMemoria())
    servico_configuracao = ServicoDeConfiguracaoComercial(RepositorioDeConfiguracaoComercialMemoria())
    repositorio_contato = RepositorioDeContatoMemoria()
    servico_contato = ServicoDeContato(repositorio_contato)
    app = criar_app(
        servico=servico,
        painel_dir=painel_dir,
        servico_configuracao=servico_configuracao,
        buscar_planos=buscar_planos,
        servico_contato=servico_contato,
        trilha_dir=trilha_dir,
        repositorio_contato=repositorio_contato,
        portal_de_cotacao=portal_de_cotacao,
    )
    return app, painel_dir, trilha_dir


@pytest.fixture
def servidor_real(tmp_path):
    app, painel_dir, trilha_dir = _app_de_teste(tmp_path=tmp_path)
    servidor = make_server("127.0.0.1", 0, app, server_class=_server_class())
    thread = threading.Thread(target=servidor.serve_forever, daemon=True)
    thread.start()
    porta = servidor.server_address[1]
    try:
        yield porta, painel_dir, trilha_dir
    finally:
        servidor.shutdown()
        thread.join(timeout=5)


def test_uma_conexao_ociosa_nao_trava_outra_rota(servidor_real):
    """S1: um socket TCP aberto sem mandar nada não pode travar `GET /api/objecoes` de outra
    conexão — hoje (thread única) trava até o `timeout` do teste."""
    porta, _, _ = servidor_real
    ocioso = socket.create_connection(("127.0.0.1", porta), timeout=5)
    try:
        inicio = time.monotonic()
        conexao = HTTPConnection("127.0.0.1", porta, timeout=5)
        conexao.request("GET", "/api/objecoes")
        resposta = conexao.getresponse()
        corpo = resposta.read()
        duracao = time.monotonic() - inicio
        conexao.close()
        assert resposta.status == 200, corpo
        assert duracao < 2.0, f"levou {duracao:.1f}s — a conexão ociosa travou o pedido"
    finally:
        ocioso.close()


class _PortalDeCotacaoLento:
    """Dublê de `PortalDeCotacao` que demora — simula a IA/`/quote` real levando segundos pra
    responder (S2 da issue mediu 9.8-23.6s ao vivo), sem precisar de rede nem chave."""

    def __init__(self, resultado, espera_segundos):
        self._resultado = resultado
        self._espera_segundos = espera_segundos

    def cotar(self, payload, conversation_id, on_tentativa=None):
        del payload, conversation_id, on_tentativa
        time.sleep(self._espera_segundos)
        return self._resultado


def test_resposta_lenta_nao_trava_outra_rota(tmp_path):
    """S2: uma requisição lenta (dublê da `/quote` que demora 1.5s) numa conversa não pode travar
    `GET /painel/regras.html` de outra conexão enquanto isso — hoje (thread única) trava."""
    resultado = ResultadoDaCotacao.sucesso(PrecoCotado(
        quote_attempt_id="qa_lento", conversation_id="conv-lenta", plano_id="completo",
        plano_nome="Completo", premio_mensal=241.38, franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"), moeda="BRL",
    ))
    portal_lento = _PortalDeCotacaoLento(resultado, espera_segundos=1.5)
    app, painel_dir, _ = _app_de_teste(tmp_path=tmp_path, buscar_planos=_com_planos_completo, portal_de_cotacao=portal_lento)
    painel_dir.mkdir(parents=True, exist_ok=True)
    (painel_dir / "regras.html").write_text("<html>regras</html>", encoding="utf-8")

    servidor = make_server("127.0.0.1", 0, app, server_class=_server_class())
    thread_servidor = threading.Thread(target=servidor.serve_forever, daemon=True)
    thread_servidor.start()
    porta = servidor.server_address[1]

    def _pedido_lento():
        conexao = HTTPConnection("127.0.0.1", porta, timeout=10)
        conexao.request(
            "POST",
            "/api/chat/cotar",
            body=json.dumps({
                "conversation_id": "conv-lenta", "idade": 35, "veiculo_ano": 2019,
                "cep": "01310-100", "plano_id": "completo", "data_inicio": "2026-10-01",
            }),
            headers={"Content-Type": "application/json"},
        )
        conexao.getresponse().read()
        conexao.close()

    try:
        thread_lenta = threading.Thread(target=_pedido_lento, daemon=True)
        thread_lenta.start()
        time.sleep(0.3)  # dá tempo do pedido lento já estar "em voo" no servidor

        inicio = time.monotonic()
        conexao = HTTPConnection("127.0.0.1", porta, timeout=5)
        conexao.request("GET", "/painel/regras.html")
        resposta = conexao.getresponse()
        corpo = resposta.read()
        duracao = time.monotonic() - inicio
        conexao.close()
        thread_lenta.join(timeout=10)

        assert resposta.status == 200, corpo
        assert duracao < 1.0, f"levou {duracao:.1f}s — o pedido lento travou o painel"
    finally:
        servidor.shutdown()
        thread_servidor.join(timeout=5)


def test_duas_chamadas_a_gerar_paineis_ao_mesmo_tempo_nao_deixam_html_pela_metade(tmp_path, monkeypatch):
    """S3: duas gerações concorrentes de painel não podem deixar um HTML lido pela metade — a
    escrita real é forçada em dois pedaços, com uma pausa no meio, pra abrir a janela da corrida
    de propósito (sem essa pausa a escrita de um HTML pequeno é rápida demais pra corrida acontecer
    de forma confiável)."""
    trilha_dir = tmp_path / "trilha"
    trilha_dir.mkdir()
    (trilha_dir / "trilha_c1.jsonl").write_text(
        json.dumps({"conversation_id": "c1", "evento": "mensagem_enviada", "texto": "oi"}) + "\n",
        encoding="utf-8",
    )
    painel_dir = tmp_path / "painel-saida"

    escrita_original = Path.write_text

    def _write_text_em_pedacos(self, conteudo, *args, **kwargs):
        if not self.name.startswith("index.html"):
            return escrita_original(self, conteudo, *args, **kwargs)
        encoding = kwargs.get("encoding") or (args[0] if args else "utf-8")
        meio = len(conteudo) // 2
        with open(self, "w", encoding=encoding) as arquivo:
            arquivo.write(conteudo[:meio])
            arquivo.flush()
            time.sleep(0.1)
            arquivo.write(conteudo[meio:])
        return len(conteudo)

    monkeypatch.setattr(Path, "write_text", _write_text_em_pedacos)

    leituras_pela_metade = []
    parar = threading.Event()

    def _ler_sem_parar():
        caminho = painel_dir / "index.html"
        while not parar.is_set():
            try:
                if caminho.exists():
                    conteudo = caminho.read_text(encoding="utf-8")
                    if conteudo and not conteudo.rstrip().endswith("</html>"):
                        leituras_pela_metade.append(conteudo)
            except (FileNotFoundError, PermissionError):
                pass  # janela do `os.replace` no Windows — não é o torn-read que este teste mede

    leitor = threading.Thread(target=_ler_sem_parar)
    leitor.start()
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futuros = [executor.submit(gerar_paineis, trilha_dir, painel_dir) for _ in range(2)]
            for futuro in futuros:
                futuro.result()
    finally:
        parar.set()
        leitor.join(timeout=5)

    assert leituras_pela_metade == [], f"{len(leituras_pela_metade)} leitura(s) pegaram o HTML pela metade"


def test_dois_pedidos_da_mesma_conversa_ao_mesmo_tempo_nao_corrompem_trilha(tmp_path, monkeypatch):
    """S4: N chamadas concorrentes de `/api/chat/cotar` para a MESMA `conversation_id` continuam
    gravando 1 linha JSON válida por evento, sem mistura nem perda — a janela da corrida é aberta
    de propósito com uma pausa dentro de `conduzir_conversa` (o miolo que fica entre ler e gravar o
    estado/trilha), senão N chamadas em memória terminam rápido demais pra corrida acontecer de
    forma confiável."""
    portal = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(PrecoCotado(
        quote_attempt_id="qa_s4", conversation_id="c-s4-medida", plano_id="completo",
        plano_nome="Completo", premio_mensal=241.38, franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"), moeda="BRL",
    ))])
    corpo = {
        "conversation_id": "c-s4-medida", "idade": 35, "veiculo_ano": 2019,
        "cep": "01310-100", "plano_id": "completo", "data_inicio": "2026-10-01",
    }
    app, _, trilha_dir = _app_de_teste(tmp_path=tmp_path, buscar_planos=_com_planos_completo, portal_de_cotacao=portal)
    quantidade_de_pedidos = 8
    # linha de base: as MESMAS N chamadas, em SÉRIE (sem monkeypatch nenhum) — só a 1ª grava
    # `status_alterado` (idempotência de `conduzir_conversa`, issue #95), então "N x eventos de 1
    # chamada" não é o número certo; a base real é rodar as N chamadas de verdade.
    for _ in range(quantidade_de_pedidos):
        status, _, resposta = _chamar(app, "POST", "/api/chat/cotar", corpo)
        assert status == "200 OK", resposta
    eventos_esperados = len((trilha_dir / "trilha_c-s4-medida.jsonl").read_text(encoding="utf-8").splitlines())
    assert eventos_esperados > 0

    import interfaces.servidor as servidor_modulo
    from infra.trilha_jsonl import RepositorioDeTrilhaJSONL

    original = servidor_modulo.conduzir_conversa

    def _conduzir_devagar(*args, **kwargs):
        time.sleep(0.02)
        return original(*args, **kwargs)

    monkeypatch.setattr(servidor_modulo, "conduzir_conversa", _conduzir_devagar)

    def _registrar_em_pedacos(self, evento):
        """Escreve a linha em 2 pedaços com uma pausa no meio — abre a janela da corrida de
        propósito (uma escrita pequena e única é rápida demais pra interleaving acontecer de forma
        confiável só com o `sleep` acima)."""
        self._caminho.parent.mkdir(parents=True, exist_ok=True)
        linha = json.dumps(evento, ensure_ascii=False) + "\n"
        meio = len(linha) // 2
        with self._caminho.open("a", encoding="utf-8") as arquivo:
            arquivo.write(linha[:meio])
            arquivo.flush()
            time.sleep(0.01)
            arquivo.write(linha[meio:])

    monkeypatch.setattr(RepositorioDeTrilhaJSONL, "registrar", _registrar_em_pedacos)

    portal_concorrente = FakePortalDeCotacao(roteiro=[ResultadoDaCotacao.sucesso(PrecoCotado(
        quote_attempt_id="qa_s4c", conversation_id="c-s4-concorrente", plano_id="completo",
        plano_nome="Completo", premio_mensal=241.38, franquia=3000.0,
        coberturas=("colisao", "roubo", "furto"), moeda="BRL",
    ))])
    app2, _, trilha_dir2 = _app_de_teste(
        tmp_path=tmp_path / "concorrente", buscar_planos=_com_planos_completo, portal_de_cotacao=portal_concorrente
    )
    corpo_concorrente = {**corpo, "conversation_id": "c-s4-concorrente"}
    with ThreadPoolExecutor(max_workers=quantidade_de_pedidos) as executor:
        futuros = [
            executor.submit(_chamar, app2, "POST", "/api/chat/cotar", corpo_concorrente)
            for _ in range(quantidade_de_pedidos)
        ]
        resultados = [futuro.result() for futuro in futuros]

    for status, _, resposta in resultados:
        assert status == "200 OK", resposta

    caminho_trilha = trilha_dir2 / "trilha_c-s4-concorrente.jsonl"
    linhas = caminho_trilha.read_text(encoding="utf-8").splitlines()
    for linha in linhas:
        json.loads(linha)  # levanta ValueError se alguma linha ficou truncada/misturada

    assert len(linhas) == eventos_esperados, (
        f"{quantidade_de_pedidos} chamadas em série gravaram {eventos_esperados} linhas; "
        f"as mesmas {quantidade_de_pedidos} concorrentes gravaram {len(linhas)} — perdeu ou duplicou evento"
    )
