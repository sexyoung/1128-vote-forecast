#!/bin/bash
set -x

npm install

npm install -g @openai/codex

curl -fsSL https://claude.ai/install.sh | bash

# Powerlevel10k
git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ~/powerlevel10k
echo 'source ~/powerlevel10k/powerlevel10k.zsh-theme' >> ~/.zshrc
cp .devcontainer/p10k.zsh ~/.p10k.zsh
echo '[[ -f ~/.p10k.zsh ]] && source ~/.p10k.zsh' >> ~/.zshrc