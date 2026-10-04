// Original decorative geometry for the website, independent of exhibition content.
export const sketchBands = 22;
const steps = 72;
type Point = [number, number, number];
export interface SketchPose {
  shape: number;
  yaw: number;
  pitch: number;
}
export const restingPose: SketchPose = { shape: 0, yaw: 0.3, pitch: 0.65 };

const forms = [0, 1, 2].map((shape) =>
  Array.from({ length: sketchBands }, (_, band) =>
    Array.from({ length: steps + 1 }, (_, step): Point => {
      const t = (step / steps) * Math.PI * 2;
      const u = (band / sketchBands) * Math.PI * 2;
      if (shape === 1)
        return [
          (step / steps - 0.5) * 330,
          72 * Math.sin(t + u * 0.5) + 38 * Math.cos(u),
          65 * Math.sin(u) + 30 * Math.cos(t),
        ];
      const radius =
        122 + 43 * Math.cos(u) + (shape === 2 ? 34 * Math.cos(t * 5) : 0);
      return [
        radius * Math.cos(t),
        radius * Math.sin(t),
        43 * Math.sin(u) + (shape === 2 ? 24 * Math.sin(t * 5) : 0),
      ];
    }),
  ),
);

export function sketchPaths({ shape, yaw, pitch }: SketchPose): string[] {
  const value = Math.max(0, Math.min(2, shape));
  const a = Math.floor(value),
    b = Math.min(2, a + 1),
    mix = value - a;
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cx = Math.cos(pitch),
    sx = Math.sin(pitch);
  return forms[a].map((band, bandIndex) =>
    band
      .map((point, index) => {
        const other = forms[b][bandIndex][index];
        const x = point[0] + (other[0] - point[0]) * mix;
        const y = point[1] + (other[1] - point[1]) * mix;
        const z = point[2] + (other[2] - point[2]) * mix;
        const rx = x * cy + z * sy,
          rz = z * cy - x * sy;
        const ry = y * cx - rz * sx,
          depth = y * sx + rz * cx;
        const perspective = 650 / (650 + depth);
        return `${index ? 'L' : 'M'}${(300 + rx * perspective).toFixed(1)},${(220 + ry * perspective).toFixed(1)}`;
      })
      .join(' '),
  );
}
