# syntax=docker/dockerfile:1

# Base image with common development tools
FROM ubuntu:22.04

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install essential packages
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    vim \
    nano \
    htop \
    unzip \
    sudo \
    ca-certificates \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Configure git credential caching (1 hour timeout)
RUN git config --global credential.helper 'cache --timeout=3600'

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install ttyd for web terminal
RUN curl -L -o /usr/local/bin/ttyd \
    https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 \
    && chmod +x /usr/local/bin/ttyd

# Web terminal port
EXPOSE 7681

# Create workspace directory
RUN mkdir -p /workspace
WORKDIR /workspace

# Copy loop application
COPY package.json bun.lockb /app/
WORKDIR /app
RUN bun install --frozen-lockfile
COPY src /app/src
COPY tsconfig.json /app/

# Build the compiled binary
RUN bun run build:linux

# Add loop binary to PATH
RUN cp /app/dist/loop-linux-x64/loop /usr/local/bin/loop \
    && chmod +x /usr/local/bin/loop

# Copy helper scripts
COPY docker/terminal.sh /usr/local/bin/terminal.sh
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/terminal.sh /usr/local/bin/entrypoint.sh

# Set workspace as default directory
WORKDIR /workspace

# Set entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
