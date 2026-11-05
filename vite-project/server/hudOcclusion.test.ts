import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { recognizeLiveHudCrops } from './gameDataRecognition.js';
import { liveCaptureKeys, liveCaptureRects, pixelRect } from '../src/shared/gameCapture.js';
import { fuseHud } from './aiFusion.js';
import { AiRecognitionService } from './aiRecognition.js';

test('one blank/covered field rejects confident OCR and AI while other fields remain candidates; uncovering recovers', async () => {
  const images = await Promise.all(liveCaptureKeys.map(async key => {
    const { width, height } = pixelRect(liveCaptureRects[key], 1920, 1080);
    const svg = Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="black"/><rect x="4" y="4" width="8" height="12" fill="white"/></svg>`);
    return 'data:image/png;base64,' + (await sharp(svg).png().toBuffer()).toString('base64');
  }));
  const { width, height } = pixelRect(liveCaptureRects.blueKills, 1920, 1080);
  const blank = 'data:image/png;base64,' + (await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer()).toString('base64');
  const provider = { recognizeNumbers: async (input: unknown) => ({ texts: (input as string[]).map(() => '7'), confidences: (input as string[]).map(() => .99), elapsedMs: 1 }) };
  const covered = await recognizeLiveHudCrops([blank, ...images.slice(1)], provider, liveCaptureRects);
  assert.equal(covered.candidates[0].value, null, 'blank crop must veto a hallucinated OCR value');
  assert.equal(covered.candidates[1].value, 7);
  const ai = new AiRecognitionService();
  const aiImages: unknown[] = [];
  ai.value = (image) => { aiImages.push(image); return { text: '8', confidence: .99 }; };
  assert.equal(fuseHud([blank, ...images.slice(1)], covered.candidates, 'game', ai)[0].value, null);
  assert.ok(!aiImages.includes(blank), 'blank crops must not trigger paid fallback');
  const recovered = await recognizeLiveHudCrops(images, provider, liveCaptureRects);
  assert.equal(recovered.candidates[0].value, 7);
});
