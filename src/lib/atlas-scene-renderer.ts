import {
  projectAtlas,
  separateLabels,
  type AtlasView,
  type SpaceId,
} from './atlas-geometry';
const svgNS = 'http://www.w3.org/2000/svg';

export function drawAtlasScenes(
  root: HTMLElement,
  view: AtlasView,
  turn: number,
) {
  for (const scene of root.querySelectorAll<HTMLElement>(
    '[data-atlas-scene]',
  )) {
    if (scene.hidden) continue;
    const width = scene.clientWidth,
      height = scene.clientHeight;
    if (!width || !height) continue;
    const geometry = projectAtlas(
      scene.dataset.atlasScene as SpaceId,
      view,
      turn,
      width,
      height,
    );
    const svg = scene.querySelector<SVGSVGElement>('svg')!;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const faces = document.createDocumentFragment();
    for (const face of geometry.faces) {
      const node = document.createElementNS(svgNS, 'polygon');
      node.setAttribute('points', face.points);
      node.setAttribute('class', `atlas-face ${face.kind}`);
      if (
        scene.dataset.atlasScene === 'all' &&
        face.kind.startsWith('floor floor-')
      )
        node.dataset.roomOpen = face.kind.split('floor-')[1];
      faces.append(node);
    }
    scene.querySelector('[data-scene-faces]')!.replaceChildren(faces);
    scene.classList.add('is-projected');
    const labels = [
      ...scene.querySelectorAll<HTMLElement>('[data-scene-point]'),
    ];
    const positions = separateLabels(
      labels.map((label) => ({
        key: label.dataset.scenePoint!,
        x: geometry.anchors[label.dataset.scenePoint!][0],
        y: geometry.anchors[label.dataset.scenePoint!][1],
        width: label.offsetWidth,
        height: label.offsetHeight,
      })),
      width,
      height,
    );
    const leaders = document.createDocumentFragment();
    for (const item of positions) {
      const label = labels.find((el) => el.dataset.scenePoint === item.key)!;
      label.style.left = `${item.x}px`;
      label.style.top = `${item.y}px`;
      const tooltip = label.querySelector<HTMLElement>(
        '.atlas-facility-tooltip',
      );
      if (tooltip) {
        const half = 101;
        const center = Math.max(half + 8, Math.min(width - half - 8, item.x));
        tooltip.style.left = `calc(50% + ${center - item.x}px)`;
        tooltip.style.bottom = item.y < 150 ? 'auto' : '100%';
        tooltip.style.top = item.y < 150 ? '100%' : 'auto';
      }
      const [x, y] = geometry.anchors[item.key];
      if (Math.hypot(x - item.x, y - item.y) > 8) {
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', String(x));
        line.setAttribute('y1', String(y));
        line.setAttribute('x2', String(item.x));
        line.setAttribute('y2', String(item.y));
        line.setAttribute('class', 'atlas-leader');
        leaders.append(line);
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', String(x));
        dot.setAttribute('cy', String(y));
        dot.setAttribute('r', '3');
        dot.setAttribute('class', 'atlas-anchor');
        leaders.append(dot);
      }
    }
    scene.querySelector('[data-scene-leaders]')!.replaceChildren(leaders);
  }
}
