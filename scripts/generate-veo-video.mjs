#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ENV_PATH = resolve(ROOT, '.env');
const OUTPUT_PATH = resolve(ROOT, 'assets/video/ai-gpu-service-business.mp4');
const GENAI_MODULE_PATH =
  process.env.GENAI_MODULE_PATH ||
  '/private/tmp/wolfstein-veo/node_modules/@google/genai/dist/node/index.mjs';

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

async function main() {
  const env = { ...parseEnv(await readFile(ENV_PATH, 'utf8')), ...process.env };
  const apiKey = env.GOOGLE_AI_API_KEY || env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY or GEMINI_API_KEY is missing from .env');
  if (!existsSync(GENAI_MODULE_PATH)) {
    throw new Error(`@google/genai was not found at ${GENAI_MODULE_PATH}`);
  }

  const { GoogleGenAI } = await import(`file://${GENAI_MODULE_PATH}`);
  const ai = new GoogleGenAI({ apiKey });

  const prompt = [
    'A polished cinematic technology explainer video for an article called "Can a Home GPU Become an AI Services Business?"',
    'Show a realistic home AI workstation with a powerful GPU tower, quiet desk lighting, abstract model training visualizations on monitors, a founder reviewing private document search and code assistant workflows, and a small business client dashboard.',
    'Visual style: premium tech documentary, realistic live action, slow dolly and macro shots, navy and gold accents, crisp modern lighting, practical business tone.',
    'Avoid readable text, brand logos, distorted hands, cartoon style, low quality, chaotic camera movement.',
  ].join(' ');

  let operation = await ai.models.generateVideos({
    model: env.VEO_MODEL || 'veo-3.1-generate-preview',
    prompt,
    config: {
      aspectRatio: '16:9',
      negativePrompt: 'cartoon, drawing, low quality, readable text, logos, watermark-like text, distorted hands',
    },
  });

  while (!operation.done) {
    console.log('Waiting for Veo video generation to complete...');
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10000));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  if (operation.error) {
    throw new Error(`Veo generation failed: ${JSON.stringify(operation.error)}`);
  }

  const generatedVideo = operation.response?.generatedVideos?.[0];
  if (!generatedVideo?.video) {
    throw new Error(`Veo generation returned no video: ${JSON.stringify(operation)}`);
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await ai.files.download({
    file: generatedVideo.video,
    downloadPath: OUTPUT_PATH,
  });
  console.log(`Veo video written: ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
