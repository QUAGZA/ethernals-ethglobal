FROM python:3.12-slim
RUN pip install --no-cache-dir "pytest==8.*" && useradd --create-home runner
USER runner
WORKDIR /work
