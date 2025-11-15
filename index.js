/**
 * Autonomous Discord Music Bot — index.js
 * Behavior on startup:
 * - Join the voice channel given by VOICE_CHANNEL_ID
 * - Play local file doubletake.mp4 continuously (loop) 24/7
 * - Keep connection alive; attempt to rejoin if disconnected
 *
 * Deploy notes:
 * - Render: use a Background Worker with start command `node index.js` (Procfile included)
 * - Pterodactyl: provided Dockerfile installs ffmpeg and runs the bot in container
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, NoSubscriberBehavior, getVoiceConnection, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const AUDIO_FILE = path.join(__dirname, 'doubletake.mp4');
const DEBUG = String(process.env.DEBUG || 'false').toLowerCase() === 'true';

if (!TOKEN) {
  console.error('Missing DISCORD_BOT_TOKEN in environment. Copy .env.example to .env and set values.');
  process.exit(1);
}
if (!VOICE_CHANNEL_ID) {
  console.error('Missing VOICE_CHANNEL_ID in environment. Copy .env.example to .env and set the channel ID.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

const player = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Play }
});

function log(...args) { if (DEBUG) console.log('[DEBUG]', ...args); }

async function ensureFileExists() {
  if (!fs.existsSync(AUDIO_FILE)) {
    console.error(`Audio file not found: ${AUDIO_FILE}`);
    return false;
  }
  return true;
}

function createFFmpegStream() {
  // spawn ffmpeg to output raw PCM compatible with Discord (s16le 48kHz stereo)
  const args = [
    '-re',
    '-i', AUDIO_FILE,
    '-analyzeduration', '0',
    '-loglevel', 'warning',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1'
  ];
  const proc = spawn(ffmpegPath || 'ffmpeg', args, { windowsHide: true });
  proc.on('error', (err) => {
    console.error('ffmpeg spawn error:', err);
  });
  proc.stderr.on('data', (d) => {
    log('ffmpeg:', d.toString().trim());
  });
  proc.on('exit', (code, signal) => {
    log('ffmpeg exited', code, signal);
  });
  return proc;
}

async function playLoop() {
  if (!await ensureFileExists()) return;

  while (true) {
    try {
      const ff = createFFmpegStream();
      const resource = createAudioResource(ff.stdout, { inputType: 'raw' });
      player.play(resource);
      console.log('Playback started.');

      // wait until player becomes idle (track finished) or error occurs
      await new Promise((resolve) => {
        const onState = (oldState, newState) => {
          log('player state', oldState.status, '->', newState.status);
          if (newState.status === AudioPlayerStatus.Idle) {
            player.removeListener('stateChange', onState);
            try { ff.kill('SIGKILL'); } catch (e) {}
            resolve();
          }
          if (newState.status === AudioPlayerStatus.AutoPaused) {
            // nothing
          }
        };
        player.on('stateChange', onState);
      });

      // small delay to avoid busy-loop
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error('Error in play loop:', err);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function joinAndPlay(channel) {
  const guildId = channel.guild.id;
  let connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });

  connection.on('stateChange', (oldState, newState) => {
    log('connection state', oldState.status, '->', newState.status);
  });

  // try to ensure the connection is ready
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
    console.log('Voice connection ready.');
  } catch (e) {
    console.warn('Voice connection not ready within timeout, continuing. Error:', e.message || e);
  }

  connection.subscribe(player);

  // Start play loop if not already
  if (!playLoop._started) {
    playLoop._started = true;
    playLoop().catch(err => console.error('playLoop crashed:', err));
  }

  // monitor and attempt to recover if disconnected
  connection.on('stateChange', async (oldState, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      console.warn('Voice connection disconnected — attempting to rejoin.');
      try {
        // try to re-enter ready state for a bit
        await entersState(connection, VoiceConnectionStatus.Signalling, 5_000);
        await entersState(connection, VoiceConnectionStatus.Connecting, 5_000);
      } catch {
        // destroy and rejoin fresh
        try { connection.destroy(); } catch (e) {}
        const fresh = joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator
        });
        fresh.subscribe(player);
        connection = fresh;
      }
    }
  });
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const ch = await client.channels.fetch(VOICE_CHANNEL_ID).catch(() => null);
    if (!ch) {
      console.error('VOICE_CHANNEL_ID not found or inaccessible. Ensure the bot is in the guild with that channel.');
      return;
    }
    if (!ch.isVoiceBased && ch.type !== 2) {
      console.error('Provided VOICE_CHANNEL_ID is not a voice channel.');
      return;
    }
    console.log('Found voice channel. Joining...');
    await joinAndPlay(ch);
  } catch (err) {
    console.error('Error in ready handler:', err);
  }
});

client.on('error', console.error);
client.on('shardError', console.error);

process.on('unhandledRejection', (err) => {
  console.error('UnhandledRejection:', err);
});

client.login(TOKEN).catch(err => {
  console.error('Failed to login:', err);
  process.exit(1);
});

// graceful shutdown
process.on('SIGINT', () => {
  console.log('SIGINT received — exiting.');
  try {
    const connections = []; // can't enumerate without guild ids; rely on process exit
    setTimeout(() => process.exit(0), 1000);
  } catch (e) { process.exit(1); }
});
