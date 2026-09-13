FROM python:3.11-slim

WORKDIR /app
COPY src ./src
COPY examples ./examples
COPY docs/design ./docs/design

ENV PYTHONPATH=/app/src
ENV SERVIDOR_PORT=8080

# Bloqueante B1 da auditoria do PR #45: sem isto, /painel/ dava 404 num clone limpo (nada gerava
# o painel dentro do container). As trilhas de examples/*.jsonl sao reais e versionadas -- geracao
# em build-time, deterministica, sem tocar o servidor em runtime (o painel estatico continua
# gerado do MESMO jeito que a CLI offline, so que tambem dentro da imagem).
RUN python -m interfaces.painel.gerar examples painel-saida

EXPOSE 8080
CMD ["python", "-m", "interfaces.servidor"]
