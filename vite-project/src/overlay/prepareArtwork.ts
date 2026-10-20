interface PreparedImage {
  image: HTMLImageElement;
  ready: Promise<void>;
}
const decoded = new Map<string, PreparedImage>();

/** Bound decoded-image memory: two complete lineups plus a small swap window
 * would otherwise keep hundreds of megabytes alive in the OBS browser. */
export function prepareArtwork(source: string): Promise<void> {
  const existing = decoded.get(source);
  if (existing) {
    decoded.delete(source);
    decoded.set(source, existing);
    return existing.ready;
  }
  const image = new Image();
  image.decoding = 'async';
  const ready = new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, 2000);
    function finish() {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      resolve();
    }
    image.onload = () => {
      if (typeof image.decode !== 'function') {
        finish();
        return;
      }
      void image
        .decode()
        .catch(() => {})
        .then(finish);
    };
    image.onerror = finish;
    image.src = source;
  });
  decoded.set(source, { image, ready });
  while (decoded.size > 12) decoded.delete(decoded.keys().next().value!);
  return ready;
}
