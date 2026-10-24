/**
 * Parcelas de los mundos de Aeon (Era II): malla geodésica de un icosaedro
 * subdividido. Cada vértice de la malla es el centro de una parcela (hexágonos y
 * 12 pentágonos). Con frecuencia f hay 10·f² + 2 parcelas: f = 4 → 162 (lunas),
 * f = 6 → 362 (planetas medianos), f = 8 → 642 (Origen).
 *
 * Determinista e igual en el servidor y en el cliente de Unreal (port en
 * aeonarch-ue/Core con vectores al bit). Regla 3: solo + - * / y sqrt.
 *
 * El índice de una parcela es su identidad: el orden de construcción es fijo
 * (12 vértices del icosaedro, luego los puntos de las aristas y luego los del
 * interior de las caras) y no debe cambiar con partidas en marcha.
 */

export type Vec3 = readonly [number, number, number];

export interface ParcelGrid {
  frequency: number;
  /** Centro de cada parcela, vector unitario. */
  centers: Vec3[];
  /** Vecinas de cada parcela, por índice ascendente (5 en los pentágonos, 6 en el resto). */
  neighbors: number[][];
}

const PHI = (1 + Math.sqrt(5)) / 2;

/** Vértices del icosaedro (sin normalizar) en orden fijo. */
const ICO_VERTICES: Vec3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];

/** Caras del icosaedro en orden fijo. */
const ICO_FACES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

function normalize(x: number, y: number, z: number): Vec3 {
  const len = Math.sqrt(x * x + y * y + z * z);
  return [x / len, y / len, z / len];
}

/** Aristas del icosaedro: pares (a, b) con a < b, ordenados. */
function icoEdges(): Array<[number, number]> {
  const seen = new Set<number>();
  const edges: Array<[number, number]> = [];
  for (const [a, b, c] of ICO_FACES) {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const lo = Math.min(u, v);
      const hi = Math.max(u, v);
      const key = lo * 16 + hi;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push([lo, hi]);
      }
    }
  }
  edges.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return edges;
}

/** Construye la malla de parcelas de frecuencia `f` (entero ≥ 1). */
export function buildParcelGrid(f: number): ParcelGrid {
  if (!Number.isInteger(f) || f < 1) throw new Error("buildParcelGrid: frecuencia entera ≥ 1");
  const centers: Vec3[] = ICO_VERTICES.map(([x, y, z]) => normalize(x, y, z));

  // Puntos de las aristas: (b - a) · k / f a partir de a, para k = 1 … f−1.
  const edges = icoEdges();
  const edgeIndex = new Map<number, number>(); // clave lo*16+hi → índice del primer punto (k = 1, desde lo)
  for (const [a, b] of edges) {
    edgeIndex.set(a * 16 + b, centers.length);
    const [ax, ay, az] = ICO_VERTICES[a]!;
    const [bx, by, bz] = ICO_VERTICES[b]!;
    for (let k = 1; k < f; k++) {
      centers.push(normalize(ax + ((bx - ax) * k) / f, ay + ((by - ay) * k) / f, az + ((bz - az) * k) / f));
    }
  }

  // Índice del punto de la arista (u, v) a `k` pasos desde u.
  const onEdge = (u: number, v: number, k: number): number => {
    if (k === 0) return u;
    if (k === f) return v;
    const lo = Math.min(u, v);
    const hi = Math.max(u, v);
    const start = edgeIndex.get(lo * 16 + hi)!;
    return u === lo ? start + k - 1 : start + (f - k) - 1;
  };

  // Puntos del interior de cada cara y triángulos pequeños para las vecindades.
  const neighborSets: Array<Set<number>> = [];
  const link = (u: number, v: number) => {
    (neighborSets[u] ??= new Set()).add(v);
    (neighborSets[v] ??= new Set()).add(u);
  };
  for (const [a, b, c] of ICO_FACES) {
    // Punto (i, j) de la cara: i pasos hacia b, j pasos hacia c (i + j ≤ f).
    const local = new Map<number, number>();
    const at = (i: number, j: number): number => {
      if (i === 0) return onEdge(a, c, j);
      if (j === 0) return onEdge(a, b, i);
      if (i + j === f) return onEdge(b, c, j);
      const key = i * (f + 1) + j;
      let index = local.get(key);
      if (index === undefined) {
        const w = f - i - j;
        const [ax, ay, az] = ICO_VERTICES[a]!;
        const [bx, by, bz] = ICO_VERTICES[b]!;
        const [cx, cy, cz] = ICO_VERTICES[c]!;
        index = centers.length;
        centers.push(normalize((ax * w + bx * i + cx * j) / f, (ay * w + by * i + cy * j) / f, (az * w + bz * i + cz * j) / f));
        local.set(key, index);
      }
      return index;
    };
    // Primero los puntos interiores, en orden fijo (i creciente, luego j).
    for (let i = 1; i < f; i++) for (let j = 1; i + j < f; j++) at(i, j);
    // Triángulos de la subdivisión.
    for (let i = 0; i < f; i++) {
      for (let j = 0; i + j < f; j++) {
        const p = at(i, j);
        const q = at(i + 1, j);
        const r = at(i, j + 1);
        link(p, q);
        link(q, r);
        link(r, p);
        if (i + j + 2 <= f) {
          const s = at(i + 1, j + 1);
          link(q, s);
          link(s, r);
        }
      }
    }
  }

  const neighbors = centers.map((_, i) => [...(neighborSets[i] ?? [])].sort((p, q) => p - q));
  return { frequency: f, centers, neighbors };
}

/**
 * Parcela que contiene la dirección (x, y, z) unitaria: la de centro más cercano
 * (mayor producto escalar; en empate, la de índice menor).
 */
export function parcelAt(grid: ParcelGrid, x: number, y: number, z: number): number {
  let best = 0;
  let bestDot = -2;
  for (let i = 0; i < grid.centers.length; i++) {
    const [cx, cy, cz] = grid.centers[i]!;
    const d = cx * x + cy * y + cz * z;
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  }
  return best;
}
