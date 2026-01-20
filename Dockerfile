# syntax=docker/dockerfile:1

# Base image with common development tools
FROM ubuntu:22.04

# Avoid prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install essential packages and SSH server
RUN apt-get update && apt-get install -y \
    openssh-server \
    curl \
    wget \
    git \
    vim \
    nano \
    htop \
    unzip \
    sudo \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Configure SSH
RUN mkdir /var/run/sshd \
    && echo 'root:loop' | chpasswd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config

# SSH port
EXPOSE 22

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

# Set workspace as default directory
WORKDIR /workspace

# Start SSH daemon
CMD ["/usr/sbin/sshd", "-D"]
