// Deterministic derivatives of already-approved, content-addressed images.
export const mediaWidths = [480, 960, 1600] as const;
export function responsiveMedia(src: string) {
  if (!/^\/media\/[a-f0-9]{64}\.(webp|jpg|png)$/.test(src)) return '';
  return mediaWidths
    .map((width) => `${src.replace(/\.[^.]+$/, '')}-${width}.webp ${width}w`)
    .join(', ');
}
