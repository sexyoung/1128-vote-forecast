#!/bin/bash
if (echo > /dev/tcp/host.docker.internal/5432) 2>/dev/null; then
  printf '\033[32m[devcontainer] postgres OK (host.docker.internal:5432)\033[0m\n'
else
  printf '\n\033[1;31m[devcontainer] ⚠️  postgres 連不到 host.docker.internal:5432\033[0m\n'
  printf '\033[33m  請在 Mac 終端執行：\033[0m\n'
  printf '\033[36m  docker compose up -d postgres\033[0m\n\n'
fi

printf '\n\033[33m[devcontainer] 想讓同網段手機看 dev server？在 Mac 終端跑：\033[0m\n'
printf '\033[36m  ssh -L 192.168.0.24:5173:localhost:5173 localhost\033[0m\n'
printf '\033[33m  然後手機開 \033[36mhttp://192.168.0.24:5173\033[0m\n\n'
