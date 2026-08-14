FROM node:22-bookworm-slim

RUN apt-get update   && apt-get install -y --no-install-recommends git   && rm -rf /var/lib/apt/lists/*

RUN npm install -g opencode-ai@1.18.18

RUN if getent group 1000 >/dev/null; then groupmod --new-name agent "$(getent group 1000 | cut -d: -f1)"; else groupadd --gid 1000 agent; fi   && if id -u 1000 >/dev/null 2>&1; then usermod --login agent --home /home/agent --move-home --shell /bin/sh "$(getent passwd 1000 | cut -d: -f1)"; else useradd --uid 1000 --gid 1000 --create-home --shell /bin/sh agent; fi

WORKDIR /workspace
USER agent
