#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_PATH = resolve(ROOT, '.env');

const POSTS = {
  thesis: {
    source: 'content/blog-post.txt',
    audio: 'assets/audio/wolfstein-capital-thesis.mp3',
    video: 'assets/video/wolfstein-capital-thesis.mp4',
    task: 'assets/video/wolfstein-capital-thesis.runway-task.json',
    prompt: [
      'Cinematic investment brand film for Wolfstein Capital, an angel investment group backing pre-seed founders.',
      'Opening scene: early morning city skyline, then close details of founders sketching product ideas, laptops, prototypes, pitch notes, and warm investor conversations.',
      'Mood: refined, optimistic, serious, premium finance brand, navy and gold color accents, realistic live-action, smooth slow camera movement, no readable text, no logos.',
    ].join(' '),
  },
  'ai-gpu': {
    source: 'content/ai-gpu-service-business-narration.txt',
    audio: 'assets/audio/ai-gpu-service-business.mp3',
    video: 'assets/video/ai-gpu-service-business.mp4',
    task: 'assets/video/ai-gpu-service-business.runway-task.json',
    prompt: [
      'Cinematic editorial technology video about a home GPU workstation becoming an AI services business.',
      'A quiet desktop workstation with a powerful graphics card, glowing monitors showing abstract model graphs, code editor windows, private document search interfaces, and a founder reviewing client workflows.',
      'Mood: realistic, premium technology documentary, navy and gold accents, smooth slow camera movement, practical business tone, no readable text, no brand logos.',
    ].join(' '),
  },
};

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

async function generateAudio(env, post, script) {
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

  const audioPath = resolve(ROOT, post.audio);
  const bytes = await writeBinary(audioPath, response);
  console.log(`Audio written: ${audioPath} (${bytes} bytes)`);
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

async function generateVideo(env, post) {
  const taskPath = resolve(ROOT, post.task);
  const videoPath = resolve(ROOT, post.video);
  const task = await createRunwayTask(env, post.prompt);
  await ensureParent(taskPath);
  await writeFile(taskPath, `${JSON.stringify(task, null, 2)}\n`);
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

  await writeFile(taskPath, `${JSON.stringify(latest, null, 2)}\n`);
  if (latest.status !== 'SUCCEEDED' || !latest.output?.[0]) {
    throw new Error(`Runway task did not finish in time. Last status: ${latest.status}`);
  }

  const response = await fetch(latest.output[0]);
  const bytes = await writeBinary(videoPath, response);
  console.log(`Video written: ${videoPath} (${bytes} bytes)`);
}

async function main() {
  const env = await loadConfig();
  const maybePost = process.argv[2] || 'thesis';
  const postKey = POSTS[maybePost] ? maybePost : 'thesis';
  const mode = POSTS[maybePost] ? process.argv[3] || 'all' : process.argv[2] || 'all';
  const post = POSTS[postKey];
  const script = (await readFile(resolve(ROOT, post.source), 'utf8')).trim();

  if (mode === 'audio' || mode === 'all') {
    await generateAudio(env, post, script);
  }

  if (mode === 'video' || mode === 'all') {
    await generateVideo(env, post);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
