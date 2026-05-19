#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE_VIDEO = resolve(ROOT, 'assets/video/ai-gpu-service-business.mp4');
const AUDIO = resolve(ROOT, 'assets/audio/ai-gpu-service-business.mp3');
const OUTPUT = resolve(ROOT, 'assets/video/ai-gpu-service-business-full.mp4');
const TMP = '/private/tmp/wolfstein-ai-gpu-video';
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';
const DURATION = '97.88';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

function drawLabel(text, start, end) {
  return [
    `drawtext=fontfile=${FONT}`,
    `text='${text}'`,
    'x=(w-text_w)/2',
    'y=h-106',
    'fontsize=42',
    'fontcolor=white',
    'box=1',
    'boxcolor=0x0a1628cc',
    'boxborderw=18',
    `enable='between(t,${start},${end})'`,
  ].join(':');
}

await mkdir(TMP, { recursive: true });

run('ffmpeg', [
  '-y',
  '-i',
  SOURCE_VIDEO,
  '-an',
  '-vf',
  'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30,format=yuv420p',
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '20',
  `${TMP}/forward.mp4`,
]);

run('ffmpeg', [
  '-y',
  '-i',
  `${TMP}/forward.mp4`,
  '-vf',
  'reverse',
  '-an',
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '20',
  `${TMP}/reverse.mp4`,
]);

const list = Array.from({ length: 20 }, (_, index) => {
  const clip = index % 2 === 0 ? `${TMP}/forward.mp4` : `${TMP}/reverse.mp4`;
  return `file '${clip}'`;
}).join('\n');
await writeFile(`${TMP}/concat.txt`, `${list}\n`);

const filters = [
  `[0:v]trim=duration=${DURATION},setpts=PTS-STARTPTS,eq=contrast=1.05:saturation=1.08,` +
    'drawbox=x=0:y=0:w=iw:h=92:color=0a1628@0.72:t=fill,' +
    'drawtext=fontfile=/System/Library/Fonts/Supplemental/Times New Roman.ttf:text=\'WOLFSTEIN CAPITAL\':x=48:y=30:fontsize=30:fontcolor=0xc9a84c,' +
    drawLabel('HOME GPU TO AI SERVICES', 0, 13) + ',' +
    drawLabel('PASSIVE RENTAL IS THE WEAK MODEL', 13, 27) + ',' +
    drawLabel('RTX 4090 IS THE ROI SWEET SPOT', 27, 41) + ',' +
    drawLabel('RTX 5090 ADDS SPEED, NOT DEMAND', 41, 55) + ',' +
    drawLabel('WORKSTATION CARDS NEED CLIENTS FIRST', 55, 70) + ',' +
    drawLabel('SELL SERVICES, NOT GPU HOURS', 70, 85) + ',' +
    drawLabel('THE OUTCOME IS THE PRODUCT', 85, 98) +
    '[v]',
  '[1:a]apad,atrim=duration=97.88[a]',
].join(';');

run('ffmpeg', [
  '-y',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  `${TMP}/concat.txt`,
  '-i',
  AUDIO,
  '-filter_complex',
  filters,
  '-map',
  '[v]',
  '-map',
  '[a]',
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '21',
  '-c:a',
  'aac',
  '-b:a',
  '192k',
  '-movflags',
  '+faststart',
  '-shortest',
  OUTPUT,
]);

console.log(`Composed full-length video: ${OUTPUT}`);
