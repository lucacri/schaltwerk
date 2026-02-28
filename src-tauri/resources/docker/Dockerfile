FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl git bash zsh ca-certificates \
    nodejs npm python3 python3-pip build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code 2>/dev/null || true
RUN npm install -g @openai/codex 2>/dev/null || true
RUN npm install -g @google/gemini-cli 2>/dev/null || true

WORKDIR /workspace
