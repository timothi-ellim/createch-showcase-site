import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectAtlas,
  markerPositions,
  sceneRooms,
  separateLabels,
  type SpaceId,
} from '../../src/lib/atlas-geometry.ts';
import { proposedPlacements } from '../../src/lib/exhibition-map.ts';

test('every proposed installation has a model anchor and camera changes never alter source geometry', () => {
  const before = JSON.stringify({ markerPositions, sceneRooms });
  for (const placement of proposedPlacements)
    assert.ok(markerPositions[placement.marker], placement.marker);
  for (const space of ['all', 'gallery', 'ws09', 'ws10'] as SpaceId[]) {
    const plan = projectAtlas(space, '2d', 0, 320, 400);
    for (let turn = 0; turn < 4; turn++) {
      const model = projectAtlas(space, '3d', turn, 320, 400);
      assert.notDeepEqual(model.faces, plan.faces);
      assert.ok(model.faces.length > plan.faces.length);
      for (const face of model.faces) {
        for (const point of face.points.split(' ')) {
          const [x, y] = point.split(',').map(Number);
          assert.ok(Number.isFinite(x) && Number.isFinite(y));
          assert.ok(x >= 0 && x <= 320 && y >= 0 && y <= 400);
        }
      }
    }
    assert.deepEqual(
      projectAtlas(space, '3d', 4, 320, 400),
      projectAtlas(space, '3d', 0, 320, 400),
    );
  }
  assert.equal(JSON.stringify({ markerPositions, sceneRooms }), before);
});

test('overlapping full-size labels separate without moving the original map anchors', () => {
  const labels = Array.from({ length: 6 }, (_, i) => ({
    key: String(i),
    x: 150,
    y: 180,
    width: 48,
    height: 48,
  }));
  const result = separateLabels(labels, 300, 400);
  for (let i = 0; i < result.length; i++) {
    const a = result[i];
    assert.ok(a.x >= 24 && a.x <= 276 && a.y >= 24 && a.y <= 376);
    for (let j = i + 1; j < result.length; j++) {
      const b = result[j];
      assert.ok(Math.abs(a.x - b.x) >= 48 || Math.abs(a.y - b.y) >= 48);
    }
  }
  assert.ok(labels.every((label) => label.x === 150 && label.y === 180));
});

test('a dense row can wrap near its anchors instead of colliding at viewport edges', () => {
  const labels = Array.from({ length: 6 }, (_, i) => ({
    key: String(i),
    x: 70 + i * 25,
    y: 170,
    width: 94,
    height: 78,
  }));
  const result = separateLabels(labels, 286, 440);
  for (let i = 0; i < result.length; i++) {
    const a = result[i];
    assert.ok(a.x >= 55 && a.x <= 231 && a.y >= 47 && a.y <= 393);
    for (const b of result.slice(i + 1))
      assert.ok(Math.abs(a.x - b.x) >= 94 || Math.abs(a.y - b.y) >= 78);
  }
});
