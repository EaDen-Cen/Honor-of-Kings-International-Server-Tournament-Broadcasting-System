import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { liveCaptureKeys, liveCaptureRects, pixelRect } from '../src/shared/gameCapture.js';
const directory = process.argv[2];
if (!directory) throw Error('Provide an output directory for synthetic replay fixtures');
await mkdir(directory, { recursive: true });
const frames = [];
for (let i = 0; i < 22; i++) {
  const expected = {
    blueKills: i >= 6 ? 1 : 0,
    redKills: 0,
    blueGold: 3000 + i * 100,
    redGold: 2900 + i * 100,
    blueTowers: 0,
    redTowers: 0,
    gameTimeSeconds: 60 + i,
  };
  const stage = i < 5 ? 'normal' : i < 12 ? 'occluded' : 'recovered';
  const labels = liveCaptureKeys
    .map((key) => {
      const r = pixelRect(liveCaptureRects[key], 1920, 1080);
      const value =
        key === 'gameTimeSeconds'
          ? `01:${String(i).padStart(2, '0')}`
          : key.endsWith('Gold')
            ? (expected[key] / 1000).toFixed(1) + 'k'
            : String(expected[key]);
      return `<text x="${r.left + r.width / 2}" y="${r.top + r.height * 0.76}" text-anchor="middle" fill="white" font-family="Arial" font-size="${key === 'gameTimeSeconds' ? 20 : 25}">${value}</text>`;
    })
    .join('');
  const r = pixelRect(liveCaptureRects.gameTimeSeconds, 1920, 1080);
  const obstruction =
    stage === 'occluded'
      ? `<rect x="${r.left}" y="0" width="${r.width}" height="${r.height + 2}" fill="#53606f"/><text x="${r.left + 2}" y="17" fill="white" font-size="11">CONTROL</text>`
      : '';
  const image = await sharp(
    Buffer.from(
      `<svg width="1920" height="100"><rect width="1920" height="100" fill="#152637"/>${labels}${obstruction}</svg>`,
    ),
  )
    .png()
    .toBuffer();
  const file = `frame-${String(i).padStart(3, '0')}.png`;
  await writeFile(resolve(directory, file), image);
  frames.push({ file, atMs: i * 1000, stage, expected });
}
await writeFile(
  resolve(directory, 'manifest.json'),
  JSON.stringify(
    {
      kind: 'synthetic',
      note: 'Constructed digits and a clock obstruction, not Wujie or real-match footage.',
      frames,
    },
    null,
    2,
  ),
);
console.log(resolve(directory, 'manifest.json'));
