// Schematic coordinates from the reviewed local plan, not building measurements.
// Both projections share these outlines, openings and installation positions.
// Z values are illustrative model heights, never an access/level-change claim.
export type Point = readonly [number, number];
type XYZ = readonly [number, number, number];
export type AtlasView = '2d' | '3d';
export type SpaceId = 'all' | 'gallery' | 'ws09' | 'ws10';
type Room = {
  id: string;
  outline: Point[];
  walls: [Point, Point][];
  anchor: Point;
};
const edges = (points: Point[]): [Point, Point][] =>
  points.map((point, index) => [point, points[(index + 1) % points.length]]);
const gallery: Point[] = [
  [270, 40],
  [510, 40],
  [510, 210],
  [270, 210],
];
const ws09: Point[] = [
  [290, 375],
  [430, 375],
  [430, 550],
  [345, 550],
  [345, 480],
  [290, 480],
];
const ws10: Point[] = [
  [500, 365],
  [695, 365],
  [695, 550],
  [500, 550],
];
export const sceneRooms: Room[] = [
  {
    id: 'gallery',
    outline: gallery,
    anchor: [390, 122],
    walls: [
      ...edges(gallery).filter((_, i) => i !== 2),
      [
        [510, 210],
        [410, 210],
      ],
      [
        [360, 210],
        [270, 210],
      ],
    ],
  },
  {
    id: 'ws09',
    outline: ws09,
    anchor: [363, 437],
    walls: [
      ...edges(ws09).filter((_, i) => i !== 1),
      [
        [430, 375],
        [430, 405],
      ],
      [
        [430, 445],
        [430, 550],
      ],
    ],
  },
  {
    id: 'ws10',
    outline: ws10,
    anchor: [602, 455],
    walls: [
      ...edges(ws10).filter((_, i) => i !== 3),
      [
        [500, 550],
        [500, 448],
      ],
      [
        [500, 406],
        [500, 365],
      ],
    ],
  },
];
// Union of the lobby and connecting passage avoids overlapping slab faces.
const circulation: Point[] = [
  [100, 555],
  [136, 555],
  [136, 525],
  [191, 525],
  [191, 306],
  [443, 306],
  [443, 405],
  [430, 405],
  [430, 445],
  [500, 445],
  [500, 406],
  [480, 406],
  [480, 268],
  [410, 268],
  [410, 210],
  [360, 210],
  [360, 268],
  [191, 268],
  [191, 218],
  [40, 218],
  [40, 347],
  [45, 347],
  [45, 525],
  [100, 525],
];
export const markerPositions: Record<string, Point> = {
  G1: [304, 130],
  G2: [474, 80],
  G3: [474, 170],
  'W9-1': [323, 422],
  'W9-2': [393, 418],
  'W9-3': [389, 515],
  'W10-1': [527, 415],
  'W10-2': [578, 400],
  'W10-3': [626, 400],
  'W10-4': [675, 415],
  'W10-5': [551, 506],
  'W10-6': [638, 506],
};
const entrances: Record<SpaceId, Point> = {
  all: [118, 551],
  gallery: [385, 233],
  ws09: [458, 425],
  ws10: [476, 427],
};
type Face = { points: XYZ[]; kind: string; depth: number };
export type ProjectedScene = {
  faces: { points: string; kind: string }[];
  anchors: Record<string, Point>;
  scale: number;
};

export function projectAtlas(
  space: SpaceId,
  view: AtlasView,
  turn: number,
  width: number,
  height: number,
): ProjectedScene {
  const rooms = sceneRooms.filter(
    (room) => space === 'all' || space === room.id,
  );
  const angle =
    view === '3d' ? ((-28 + (((turn % 4) + 4) % 4) * 90) * Math.PI) / 180 : 0;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const raw = ([x, y, z]: XYZ): Point => [
    x * c - y * s,
    view === '3d' ? (x * s + y * c) * 0.68 - z * 0.85 : y,
  ];
  const faces: Face[] = [];
  const face = (points: XYZ[], kind: string) =>
    faces.push({
      points,
      kind,
      depth:
        points.reduce((n, [x, y, z]) => n + x * s + y * c + z * 0.01, 0) /
        points.length,
    });
  const solid = (outline: Point[], kind: string, base: number, top: number) => {
    if (view === '3d')
      for (const [a, b] of edges(outline))
        face(
          [
            [...a, base],
            [...b, base],
            [...b, top],
            [...a, top],
          ],
          `${kind.split(' ')[0]}-edge`,
        );
    face(
      outline.map((p) => [...p, top]),
      kind,
    );
  };
  if (space === 'all') {
    solid(circulation, 'passage', -6, 0);
    solid(
      [
        [40, 160],
        [180, 160],
        [180, 218],
        [40, 218],
      ],
      'amenity',
      -6,
      0,
    );
    solid(
      [
        [15, 555],
        [720, 555],
        [720, 625],
        [15, 625],
      ],
      'street',
      -11,
      -9,
    );
  }
  for (const room of rooms) {
    solid(room.outline, `floor floor-${room.id}`, -8, 0);
    for (const [a, b] of room.walls) {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        length = Math.hypot(dx, dy),
        thickness = space === 'all' ? 4 : 2.5;
      const offset: Point = [
        (-dy / length) * thickness,
        (dx / length) * thickness,
      ];
      const wall: Point[] = [
        a,
        b,
        [b[0] + offset[0], b[1] + offset[1]],
        [a[0] + offset[0], a[1] + offset[1]],
      ];
      solid(wall, 'wall', 0, view === '3d' ? (space === 'all' ? 27 : 16) : 0);
    }
  }
  // Only rotation changes the camera; every model coordinate stays immutable.
  const points = faces.flatMap((f) => f.points.map(raw));
  const minX = Math.min(...points.map((p) => p[0])),
    maxX = Math.max(...points.map((p) => p[0]));
  const minY = Math.min(...points.map((p) => p[1])),
    maxY = Math.max(...points.map((p) => p[1]));
  const padding = width < 500 ? 38 : 55;
  const scale = Math.min(
    (width - padding * 2) / (maxX - minX),
    (height - padding * 2) / (maxY - minY),
  );
  const project = (point: XYZ): Point => {
    const [x, y] = raw(point);
    return [
      (x - (minX + maxX) / 2) * scale + width / 2,
      (y - (minY + maxY) / 2) * scale + height / 2,
    ];
  };
  const anchors: Record<string, Point> = {};
  for (const room of rooms) anchors[room.id] = project([...room.anchor, 0]);
  for (const [key, point] of Object.entries(markerPositions))
    anchors[key] = project([...point, 0]);
  anchors.lobby = project([115, 280, 0]);
  anchors.cafe = project([115, 440, 0]);
  anchors.toilets = project([110, 183, 0]);
  anchors.street = project([420, 596, -9]);
  anchors.entrance = project([...entrances[space], 0]);
  // A stable depth sort draws back faces before front faces in the 3D cutaway.
  if (view === '3d') faces.sort((a, b) => a.depth - b.depth);
  return {
    faces: faces.map((f) => ({
      kind: f.kind,
      points: f.points
        .map((p) =>
          project(p)
            .map((n) => n.toFixed(2))
            .join(','),
        )
        .join(' '),
    })),
    anchors,
    scale,
  };
}

// Dense mobile views keep full-size targets. Leader lines retain exact model
// anchors when screen labels need a small separation after camera rotation.
export function separateLabels(
  items: { key: string; x: number; y: number; width: number; height: number }[],
  width: number,
  height: number,
) {
  const result = items.map((item) => ({ ...item }));
  for (let pass = 0; pass < 60; pass++) {
    let changed = false;
    for (let i = 0; i < result.length; i++)
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i],
          b = result[j],
          dx = b.x - a.x,
          dy = b.y - a.y;
        const ox = (a.width + b.width) / 2 + 8 - Math.abs(dx),
          oy = (a.height + b.height) / 2 + 8 - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          changed = true;
          if (ox < oy) {
            const shift = (dx >= 0 ? 1 : -1) * (ox / 2 + 0.1);
            a.x -= shift;
            b.x += shift;
          } else {
            const shift = (dy >= 0 ? 1 : -1) * (oy / 2 + 0.1);
            a.y -= shift;
            b.y += shift;
          }
        }
      }
    for (const item of result) {
      item.x = Math.max(
        item.width / 2 + 8,
        Math.min(width - item.width / 2 - 8, item.x),
      );
      item.y = Math.max(
        item.height / 2 + 8,
        Math.min(height - item.height / 2 - 8, item.y),
      );
    }
    if (!changed) break;
  }
  const overlaps = (a: (typeof result)[number], b: (typeof result)[number]) =>
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + 7 &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + 7;
  // A row wider than the viewport can trap pairwise separation against both
  // edges. In that case, choose the nearest free position for each label.
  if (result.some((a, i) => result.slice(i + 1).some((b) => overlaps(a, b)))) {
    const placed: typeof result = [];
    for (const original of items) {
      const minX = original.width / 2 + 8,
        maxX = width - minX;
      const minY = original.height / 2 + 8,
        maxY = height - minY;
      const xs = [Math.max(minX, Math.min(maxX, original.x)), minX, maxX];
      const ys = [Math.max(minY, Math.min(maxY, original.y)), minY, maxY];
      for (const previous of placed) {
        xs.push(
          previous.x - (previous.width + original.width) / 2 - 8,
          previous.x + (previous.width + original.width) / 2 + 8,
        );
        ys.push(
          previous.y - (previous.height + original.height) / 2 - 8,
          previous.y + (previous.height + original.height) / 2 + 8,
        );
      }
      const candidates = xs
        .flatMap((x) => ys.map((y) => ({ ...original, x, y })))
        .filter(
          (candidate) =>
            candidate.x >= minX &&
            candidate.x <= maxX &&
            candidate.y >= minY &&
            candidate.y <= maxY &&
            !placed.some((p) => overlaps(candidate, p)),
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - original.x, a.y - original.y) -
            Math.hypot(b.x - original.x, b.y - original.y),
        );
      placed.push(
        candidates[0] ?? result.find((item) => item.key === original.key)!,
      );
    }
    return placed;
  }
  return result;
}
