#!/bin/bash

# Pull latest changes from master
git pull origin master

# Build for Linux
bun build:linux

# Copy the built binary to current directory
cp -a ~/loop/dist/loop-linux-x64/loop .

echo "Update complete!"
