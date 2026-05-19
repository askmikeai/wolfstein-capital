#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_PATH = resolve(ROOT, '.env');
const OUTPUT_PATH = resolve(ROOT, 'assets/video/ai-gpu-service-business.mp4');
const PREDICTION_PATH = resolve(ROOT, 'assets/video/ai-gpu-service-business.replicate-prediction.json');

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

async function replicateRequest(env, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Replicate request failed ${response.status}: ${body.slice(0, 1000)}`);
  }
  return response.json();
}

function getOutputUrl(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.find((item) => typeof item === 'string');
  if (output && typeof output === 'object') {
    return output.video || output.url || output.output;
  }
  return undefined;
}

async function main() {
  const env = { ...parseEnv(await readFile(ENV_PATH, 'utf8')), ...process.env };
  if (!env.REPLICATE_API_TOKEN) throw new Error('REPLICATE_API_TOKEN is missing from .env');

  const model = env.REPLICATE_VIDEO_MODEL || 'minimax/video-01';
  const prompt = [
    'Cinematic realistic 6 second tech documentary video.',
    'A home AI workstation with a powerful GPU tower under a desk, soft navy and gold lighting, close-up of GPU fans, monitors showing abstract AI model graphs and code editor shapes, a founder reviewing a private document search workflow and business dashboard.',
    'Smooth dolly camera, premium startup editorial tone, practical business atmosphere, no readable text, no logos, no captions, no watermark.',
  ].join(' ');

  let prediction = await replicateRequest(
    env,
    `https://api.replicate.com/v1/models/${model}/predictions`,
    {
      method: 'POST',
      body: JSON.stringify({
        input: {
          prompt,
        },
      }),
    },
  );

  console.log(`Replicate prediction created: ${prediction.id}`);

  while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000));
    prediction = await replicateRequest(env, prediction.urls.get, {
      method: 'GET',
      headers: {},
    });
    console.log(`Replicate status: ${prediction.status}`);
  }

  await mkdir(dirname(PREDICTION_PATH), { recursive: true });
  await writeFile(PREDICTION_PATH, `${JSON.stringify(prediction, null, 2)}\n`);

  if (prediction.status !== 'succeeded') {
    throw new Error(`Replicate generation ended with ${prediction.status}: ${prediction.error || 'no error detail'}`);
  }

  const outputUrl = getOutputUrl(prediction.output);
  if (!outputUrl) {
    throw new Error(`Replicate succeeded but returned no video URL: ${JSON.stringify(prediction.output)}`);
  }

  const videoResponse = await fetch(outputUrl);
  if (!videoResponse.ok) {
    throw new Error(`Video download failed ${videoResponse.status}`);
  }
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, Buffer.from(await videoResponse.arrayBuffer()));
  console.log(`Generated video written: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
