FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl git bash zsh ca-certificates \
    nodejs npm python3 python3-pip build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m agent
USER agent

RUN npm install -g @anthropic-ai/claude-code || true
RUN npm install -g @openai/codex || true
RUN npm install -g @google/gemini-cli || true

WORKDIR /workspace
