FROM python:3.11-slim

WORKDIR /app
COPY src ./src

ENV PYTHONPATH=/app/src
ENV SERVIDOR_PORT=8080

EXPOSE 8080
CMD ["python", "-m", "interfaces.servidor"]
