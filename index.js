/**
 * Autonomous Discord Music Bot 24/7
 * index.js
 * 
 * Features:
 * - Auto join a fixed voice channel
 * - Play doubletake.mp4 continuously in loop
 * - Auto reconnect if disconnected
 * - Debug logging via .env DEBUG=true
 */

require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const VOICE_CHANNEL_ID = process.env.VOICE_CHANNEL_ID;
const AUDIO_FILE = path.join(__dirname, 'doubletake.mp4');
const DEBUG = String(process.env.DEBUG || 'false').toLowerCase() === 'true';

if (!TOKEN || !VOICE_CHANNEL_ID) {
  console.error('Missing DISCORD_BOT_TOKEN or VOICE_CHANNEL_ID in .env!');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

const player = createAudioPlayer({
  behaviors: { noSubscriber: NoSubscriberBehavior.Play }
});

function log(...args) {
  if (DEBUG) console.log('[DEBUG]', ...args);
}

async function ensureFileExists() {
  if (!fs.existsSync(AUDIO_FILE)) {
    console.error(`Audio file not found: ${AUDIO_FILE}`);
    return false;
  }
  return true;
}

// Spawn ffmpeg to decode mp4 to PCM
function createFFmpegStream() {
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
  proc.on('error', (err) => console.error('ffmpeg spawn error:', err));
  proc.stderr.on('data', (d) => log('ffmpeg:', d.toString().trim()));
  return proc;
}

// Loop playback continuously
async function playLoop() {
  if (!await ensureFileExists()) return;

  while (true) {
    try {
      const ff = createFFmpegStream();
      const resource = createAudioResource(ff.stdout, { inputType: 'raw' });
      player.play(resource);
      log('Playback started.');

      await new Promise((resolve) => {
        const onState = (oldState, newState) => {
          log('player state', oldState.status, '->', newState.status);
          if (newState.status === AudioPlayerStatus.Idle) {
            player.removeListener('stateChange', onState);
            try { ff.kill('SIGKILL'); } catch (e) {}
            resolve();
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

// Join voice channel and start playback
async function joinAndPlay(channel) {
  let connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: false
  });

  connection.subscribe(player);

  if (!playLoop._started) {
    playLoop._started = true;
    playLoop().catch(err => console.error('playLoop crashed:', err));
  }

  connection.on('stateChange', async (oldState, newState) => {
    log('connection state', oldState.status, '->', newState.status);
    if (newState.status === VoiceConnectionStatus.Disconnected) {
      console.warn('Voice disconnected, attempting to reconnect...');
      try {
        await entersState(connection, VoiceConnectionStatus.Signalling, 5000);
        await entersState(connection, VoiceConnectionStatus.Connecting, 5000);
      } catch {
        try { connection.destroy(); } catch(e){}
        const fresh = joinVoiceChannel({
          channelId: channel.id,
          guildId: channel.guild.id,
          adapterCreator: channel.guild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: false
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
      console.error('VOICE_CHANNEL_ID not found or inaccessible.');
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
  setTimeout(() => process.exit(0), 1000);
});
