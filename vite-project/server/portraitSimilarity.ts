import { readFileSync } from 'node:fs';
import type { PortraitView } from './portraitTemplatePack.js';

type Features = PortraitView['features'];
const projectionSize = 192;
const maxChannels = 32 * 32 * 3;
const maxViews = 16;
const stride = maxChannels + projectionSize + 4;

function loadKernel() {
  try {
    const module = new WebAssembly.Module(
      readFileSync(new URL('./portraitSimilarity.wasm', import.meta.url)),
    );
    const { memory, potentialMatches } = new WebAssembly.Instance(module).exports;
    return {
      data: new Float64Array((memory as WebAssembly.Memory).buffer),
      matches: potentialMatches as (
        length: number,
        views: number,
        strideBytes: number,
        cutoff: number,
      ) => number,
    };
  } catch {
    return undefined;
  }
}
const kernel = loadKernel();
let loadedViews: readonly PortraitView[] | undefined;

function writeFeatures(data: Float64Array, index: number, f: Features, length: number) {
  const offset = index * stride;
  data.set(f.values, offset);
  data.fill(0, offset + f.values.length, offset + length);
  data.set(f.blocks, offset + length);
  data[offset + length + projectionSize] = f.residual;
}

/** A set bit means that the original serial dot product must decide this frame view. */
export function potentialPortraitViews(
  template: Features,
  views: readonly PortraitView[],
  cutoff: number,
) {
  const length = Math.ceil(template.values.length / 4) * 4;
  if (
    !kernel ||
    length === 0 ||
    length > maxChannels ||
    !views.length ||
    views.length > maxViews ||
    template.blocks.length !== projectionSize
  )
    return undefined;
  if (views !== loadedViews) {
    if (
      views.some(
        ({ features }) =>
          features.values.length !== template.values.length ||
          features.blocks.length !== projectionSize,
      )
    )
      return undefined;
    for (const [index, { features }] of views.entries())
      writeFeatures(kernel.data, index + 1, features, length);
    loadedViews = views;
  }
  writeFeatures(kernel.data, 0, template, length);
  // Norms are <= 1. Float64 rounding for either dot product is below 1e-12.
  return kernel.matches(length, views.length, stride * 8, cutoff - 1e-7);
}
