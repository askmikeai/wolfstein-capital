#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_PATH = resolve(ROOT, '.env');
const BLOG_PATH = resolve(ROOT, 'content/blog-post.txt');
const AUDIO_PATH = resolve(ROOT, 'assets/audio/wolfstein-capital-thesis.mp3');
const VIDEO_PATH = resolve(ROOT, 'assets/video/wolfstein-capital-thesis.mp4');
const RUNWAY_TASK_PATH = resolve(ROOT, 'assets/video/wolfstein-capital-thesis.runway-task.json');

function parseEnv(source) {
  const env = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function loadConfig() {
  const fileEnv = parseEnv(await readFile(ENV_PATH, 'utf8'));
  return { ...fileEnv, ...process.env };
}

async function ensureParent(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function writeBinary(filePath, response) {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Request failed ${response.status}: ${body.slice(0, 500)}`);
  }
  await ensureParent(filePath);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);
  return buffer.length;
}

async function generateAudio(env, script) {
  const apiKey = env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is missing from .env');

  const voiceId = env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`);
  url.searchParams.set('output_format', 'mp3_44100_128');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: script,
      model_id: env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.48,
        similarity_boost: 0.78,
        style: 0.18,
        use_speaker_boost: true,
      },
    }),
  });

  const bytes = await writeBinary(AUDIO_PATH, response);
  console.log(`Audio written: ${AUDIO_PATH} (${bytes} bytes)`);
}

async function createRunwayTask(env, prompt) {
  const apiKey = env.RUNWAY_API_KEY || env.RUNWAYML_API_SECRET;
  if (!apiKey) throw new Error('RUNWAY_API_KEY is missing from .env');

  const response = await fetch('https://api.dev.runwayml.com/v1/text_to_video', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': '2024-11-06',
    },
    body: JSON.stringify({
      model: env.RUNWAY_MODEL || 'gen4.5',
      promptText: prompt,
      ratio: '1280:720',
      duration: Number(env.RUNWAY_DURATION || 10),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Runway task creation failed ${response.status}: ${body.slice(0, 1000)}`);
  }

  return response.json();
}

async function retrieveRunwayTask(env, taskId) {
  const apiKey = env.RUNWAY_API_KEY || env.RUNWAYML_API_SECRET;
  const response = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Runway-Version': '2024-11-06',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Runway task lookup failed ${response.status}: ${body.slice(0, 1000)}`);
  }

  return response.json();
}

async function generateVideo(env) {
  const prompt = [
    'Cinematic investment brand film for Wolfstein Capital, an angel investment group backing pre-seed founders.',
    'Opening scene: early morning city skyline, then close details of founders sketching product ideas, laptops, prototypes, pitch notes, and warm investor conversations.',
    'Mood: refined, optimistic, serious, premium finance brand, navy and gold color accents, realistic live-action, smooth slow camera movement, no readable text, no logos.',
  ].join(' ');

  const task = await createRunwayTask(env, prompt);
  await ensureParent(RUNWAY_TASK_PATH);
  await writeFile(RUNWAY_TASK_PATH, `${JSON.stringify(task, null, 2)}\n`);
  console.log(`Runway task created: ${task.id}`);

  let latest = task;
  for (let attempt = 1; attempt <= 72; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000));
    latest = await retrieveRunwayTask(env, task.id);
    console.log(`Runway status: ${latest.status}`);

    if (latest.status === 'SUCCEEDED') break;
    if (latest.status === 'FAILED' || latest.status === 'CANCELED') {
      throw new Error(`Runway task ended with ${latest.status}: ${JSON.stringify(latest)}`);
    }
  }

  await writeFile(RUNWAY_TASK_PATH, `${JSON.stringify(latest, null, 2)}\n`);
  if (latest.status !== 'SUCCEEDED' || !latest.output?.[0]) {
    throw new Error(`Runway task did not finish in time. Last status: ${latest.status}`);
  }

  const response = await fetch(latest.output[0]);
  const bytes = await writeBinary(VIDEO_PATH, response);
  console.log(`Video written: ${VIDEO_PATH} (${bytes} bytes)`);
}

async function main() {
  const env = await loadConfig();
  const script = (await readFile(BLOG_PATH, 'utf8')).trim();
  const mode = process.argv[2] || 'all';

  if (mode === 'audio' || mode === 'all') {
    await generateAudio(env, script);
  }

  if (mode === 'video' || mode === 'all') {
    await generateVideo(env);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
