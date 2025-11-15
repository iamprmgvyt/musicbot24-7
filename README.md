# Discord Autonomous Music Bot (24/7 loop) — Deploy-ready

**Purpose**: A minimal Node.js Discord bot that automatically:
- joins a fixed voice channel on startup,
- plays `doubletake.mp4` continuously (loop) 24/7,
- does not accept commands (single-purpose).

## Included files
- `package.json`
- `.env.example`
- `index.js`
- `Procfile` (for Render — worker)
- `Dockerfile` (for Pterodactyl / Docker deployments)
- `README.md` (this file)

## Setup (common)
1. Copy `.env.example` to `.env` and set `DISCORD_BOT_TOKEN` and `VOICE_CHANNEL_ID`.
2. Place your `doubletake.mp4` file in the same folder as `index.js`.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the bot:
   ```bash
   npm start
   ```

## Deploy on Render (background worker)
1. Create a new **Background Worker** service on Render (not a Web Service).
2. Connect your repo or upload files.
3. Set the start command to:
   ```
   node index.js
   ```
   (Procfile is provided — Render will detect it for a worker if you set the service type to "Background Worker".)
4. Add environment variables on Render: `DISCORD_BOT_TOKEN`, `VOICE_CHANNEL_ID`.
5. Deploy — Render will run the bot continuously.

## Deploy on Pterodactyl (Docker/container)
1. Create a new server that uses the "Docker" (or an image that supports Node.js) and upload the project files.
2. The provided `Dockerfile` installs `ffmpeg` system package and runs `node index.js`.
   - If your Pterodactyl node requires a specific Docker image, adapt the Dockerfile accordingly.
3. Build the container (or let Pterodactyl build it) and start the server.
4. Set the environment variables in the Pterodactyl panel: `DISCORD_BOT_TOKEN`, `VOICE_CHANNEL_ID`.
5. Upload `doubletake.mp4` into the server's filesystem (same folder as index.js).

## Notes & Troubleshooting
- The bot uses `ffmpeg` to transcode `doubletake.mp4`. The Dockerfile installs ffmpeg system-wide for compatibility.
- Ensure the bot has Connect & Speak permissions in the target voice channel.
- Use a process supervisor (Render/Pterodactyl will handle restarts) or PM2 for local runs.
- This repository intentionally does not include `doubletake.mp4` — you must provide the file.
