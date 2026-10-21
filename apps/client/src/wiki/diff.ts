/** Diferencias por líneas entre dos textos (historial del editor de la Wiki), sin dependencias. */

export interface DiffLine {
  t: "same" | "add" | "del";
  text: string;
}

/** Tope de líneas distintas (tras quitar el principio y el final comunes) para la tabla LCS: n × m celdas. */
const MAX_CELLS = 4_000_000;

/** Líneas de `a` a `b`: iguales, quitadas (`del`) y añadidas (`add`), en orden. */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split("\n");
  const y = b.split("\n");
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX--;
    endY--;
  }
  const head: DiffLine[] = x.slice(0, start).map((text) => ({ t: "same", text }));
  const tail: DiffLine[] = x.slice(endX).map((text) => ({ t: "same", text }));
  const xs = x.slice(start, endX);
  const ys = y.slice(start, endY);
  const n = xs.length;
  const m = ys.length;
  // Demasiado distinto para la tabla: todo lo de en medio, quitado y añadido.
  if (n * m > MAX_CELLS) {
    return [...head, ...xs.map((text): DiffLine => ({ t: "del", text })), ...ys.map((text): DiffLine => ({ t: "add", text })), ...tail];
  }
  // Subsecuencia común más larga, desde el final.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = xs[i] === ys[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (xs[i] === ys[j]) {
      mid.push({ t: "same", text: xs[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) mid.push({ t: "del", text: xs[i++]! });
    else mid.push({ t: "add", text: ys[j++]! });
  }
  while (i < n) mid.push({ t: "del", text: xs[i++]! });
  while (j < m) mid.push({ t: "add", text: ys[j++]! });
  return [...head, ...mid, ...tail];
}

/** Trozo para mostrar: líneas cambiadas con `context` líneas iguales alrededor, o un salto (`gap`, cuántas se omiten). */
export type DiffChunk = DiffLine | { t: "gap"; count: number };

export function diffChunks(lines: DiffLine[], context = 2): DiffChunk[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, n) => {
    if (l.t === "same") return;
    for (let k = Math.max(0, n - context); k <= Math.min(lines.length - 1, n + context); k++) keep[k] = true;
  });
  const out: DiffChunk[] = [];
  let skipped = 0;
  lines.forEach((l, n) => {
    if (keep[n]) {
      if (skipped) out.push({ t: "gap", count: skipped });
      skipped = 0;
      out.push(l);
    } else skipped++;
  });
  if (skipped && out.length) out.push({ t: "gap", count: skipped });
  return out;
}
