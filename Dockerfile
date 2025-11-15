FROM node:18-slim

# Install ffmpeg (system package) and other useful packages
RUN apt-get update && apt-get install -y ffmpeg ca-certificates --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files and install deps
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy app files
COPY . .

# Create a non-root user to run the bot (recommended in Pterodactyl)
RUN useradd -m botuser && chown -R botuser:botuser /usr/src/app
USER botuser

# Expose nothing (this is a background worker). Keep container running with node index.js
CMD ["node", "index.js"]
