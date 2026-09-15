export const motionDuration = {
  instant: 80,
  micro: 140,
  ui: 200,
  reveal: 320,
  editorial: 480,
} as const;
export const motionDistance = { register: 4, small: 8, reveal: 16 } as const;
export const motionEase = {
  direct: [0.2, 0, 0, 1],
  soft: [0.22, 1, 0.36, 1],
  editorial: [0.16, 1, 0.3, 1],
} as const;
export const heroTiming = {
  label: 80,
  where: 140,
  code: 210,
  becomes: 300,
  culture: 370,
  facts: 450,
  intro: 520,
  actions: 580,
  complete: 690,
} as const;
