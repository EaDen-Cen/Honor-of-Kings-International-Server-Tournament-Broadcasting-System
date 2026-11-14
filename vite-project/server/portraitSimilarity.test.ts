import assert from 'node:assert/strict';
import test from 'node:test';
import { potentialPortraitViews } from './portraitSimilarity.js';

test('portrait pruning keeps exact decision boundaries across masks and evicted views', () => {
  for (const length of [3072, 1989, 192, 19]) {
    const template = Float64Array.from({ length }, (_, i) => Math.sin(i) / Math.sqrt(length));
    const features = (values: Float64Array) => ({
      values,
      blocks: new Float64Array(192),
      residual: 1,
    });
    const views = Array.from({ length: 13 }, (_, j) => ({
      penalty: 0,
      features: features(
        Float64Array.from({ length }, (_, i) => Math.cos(j + i) / Math.sqrt(length)),
      ),
    }));
    for (const [i, { features: frame }] of views.entries()) {
      const exact = template.reduce((sum, v, j) => sum + v * frame.values[j], 0);
      const matches = potentialPortraitViews(features(template), views, exact);
      assert.ok(matches !== undefined && matches & (1 << i), 'keep tied scores');
      const higher = potentialPortraitViews(features(template), views, exact + 1e-5);
      assert.ok(higher !== undefined && !(higher & (1 << i)), 'skip a proven losing pair');
    }
  }
});
