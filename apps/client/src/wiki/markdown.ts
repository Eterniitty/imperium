/**
 * Markdown mínimo para los artículos de la Wiki (sin dependencias). Admite:
 * - `#`, `##`, `###` títulos (con ancla); el primer `#` es el título del artículo.
 * - Párrafos, listas `-` y `1.`, tablas `| a | b |` con fila separadora `|---|`.
 * - Citas `>`; `> [!dev] …` es un aviso «En desarrollo» y `> [!nota] …` una nota.
 * - `{{tabla:<id>}}` en su propia línea: tabla generada con los datos del juego (tables.ts),
 *   y `{{fichas:<id>}}`, fichas generadas (especies y facciones).
 * - En línea (`\\` escapa el carácter siguiente): `**negrita**`, `*cursiva*`, `` `código` ``, `[[tecla]]` y `[texto](enlace)`.
 *
 * Seguridad (los administradores editan el texto desde la Wiki): no hay HTML.
 * Todo se dibuja como nodos de texto de React, que escapa `<`, `>` y `&`, y los
 * enlaces solo admiten rutas propias (`/…`, `#…`), `http(s):` y `mailto:`; uno
 * con otro esquema (`javascript:`, `data:`…) queda como texto (`safeHref`).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "kbd"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; id: string; c: Inline[]; text: string }
  | { t: "p"; c: Inline[] }
  | { t: "ul" | "ol"; items: Inline[][] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "quote"; kind: "quote" | "dev" | "note"; c: Inline[] }
  | { t: "gen"; id: string }
  | { t: "cards"; id: string }
  /** `::: centro` … `:::` (también derecha y justificado): los bloques de dentro con esa alineación. */
  | { t: "align"; align: "center" | "right" | "justify"; blocks: Block[] }
  /** `::: verso` … `:::`: cada línea se respeta (poemas, canciones, cartas). */
  | { t: "verse"; lines: Inline[][] }
  /** `---`: separador de escena. */
  | { t: "hr" };

/** Nombres de los bloques `:::` (en los dos idiomas). */
const ALIGNS: Record<string, "center" | "right" | "justify" | "verse"> = {
  centro: "center",
  center: "center",
  derecha: "right",
  right: "right",
  justificado: "justify",
  justify: "justify",
  verso: "verse",
  verse: "verse",
};

/** Ancla de un título: minúsculas, sin tildes, guiones. */
export function anchorId(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Destino de un enlace si es seguro: rutas del propio sitio (`/wiki/…`, `#ancla`)
 * y direcciones `http:`, `https:` o `mailto:`. Null para todo lo demás
 * (`javascript:`, `data:`, `vbscript:`, rutas sin esquema y `//otro-sitio`).
 */
export function safeHref(href: string): string | null {
  if (/^\/(?![/\\])/.test(href) || href.startsWith("#")) return href;
  if (/^(https?:\/\/|mailto:)[^\s]+$/i.test(href)) return href;
  return null;
}

/** Texto plano de un fragmento en línea (para buscar y para las anclas). */
export function plain(c: Inline[]): string {
  return c.map((i) => ("v" in i ? i.v : plain(i.c))).join("");
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if (rest[0] === "\\" && rest.length > 1) {
      text += rest[1];
      i += 2;
      continue;
    }
    if ((m = /^\*\*(.+?)\*\*/.exec(rest))) {
      flush();
      out.push({ t: "strong", c: parseInline(m[1]!) });
    } else if ((m = /^\*([^*\s][^*]*?)\*/.exec(rest))) {
      flush();
      out.push({ t: "em", c: parseInline(m[1]!) });
    } else if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ t: "code", v: m[1]! });
    } else if ((m = /^\[\[([^\]]+)\]\]/.exec(rest))) {
      flush();
      out.push({ t: "kbd", v: m[1]! });
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      flush();
      const href = safeHref(m[2]!);
      // Un enlace con un esquema no permitido se queda en su texto, sin enlace.
      if (href) out.push({ t: "link", href, c: parseInline(m[1]!) });
      else out.push(...parseInline(m[1]!));
    } else {
      text += src[i];
      i++;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => parseInline(c.trim()));

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const ids = new Set<string>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "") {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^:::\s*([a-záéíóú]+)$/i.exec(trimmed)) && ALIGNS[m[1]!.toLowerCase()]) {
      // Bloque con formato hasta el `:::` que lo cierra (o hasta el final).
      const kind = ALIGNS[m[1]!.toLowerCase()]!;
      const inner: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== ":::") inner.push(lines[i++]!);
      i++;
      if (kind === "verse") blocks.push({ t: "verse", lines: inner.map((l) => parseInline(l.trim())) });
      else blocks.push({ t: "align", align: kind, blocks: parseMarkdown(inner.join("\n")) });
      continue;
    }
    if (/^(-{3,}|\*\s\*\s\*)$/.test(trimmed)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(trimmed))) {
      const c = parseInline(m[2]!);
      const text = plain(c);
      let id = anchorId(text) || "s";
      for (let n = 2; ids.has(id); n++) id = `${anchorId(text)}-${n}`;
      ids.add(id);
      blocks.push({ t: "h", level: m[1]!.length as 1 | 2 | 3, id, c, text });
      i++;
    } else if ((m = /^\{\{(tabla|fichas):([a-z0-9-]+)\}\}$/.exec(trimmed))) {
      blocks.push({ t: m[1] === "tabla" ? "gen" : "cards", id: m[2]! });
      i++;
    } else if (trimmed.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(lines[i++]!);
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      const [head, ...rest] = body;
      blocks.push({ t: "table", head: head ? cells(head) : [], rows: rest.map(cells) });
    } else if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\./.test(trimmed);
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i]!;
        const lt = l.trim();
        if (ordered ? /^\d+\.\s+/.test(lt) : /^[-*]\s+/.test(lt)) items.push(lt.replace(/^([-*]|\d+\.)\s+/, ""));
        else if (lt !== "" && /^\s+/.test(l) && items.length > 0) items[items.length - 1] += " " + lt;
        else break;
        i++;
      }
      blocks.push({ t: ordered ? "ol" : "ul", items: items.map(parseInline) });
    } else if (trimmed.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) parts.push(lines[i++]!.trim().replace(/^>\s?/, ""));
      let text = parts.join(" ").trim();
      let kind: "quote" | "dev" | "note" = "quote";
      if (text.startsWith("[!dev]")) kind = "dev";
      else if (text.startsWith("[!nota]")) kind = "note";
      if (kind !== "quote") text = text.replace(/^\[![a-z]+\]\s*/, "");
      blocks.push({ t: "quote", kind, c: parseInline(text) });
    } else {
      const parts: string[] = [];
      while (i < lines.length) {
        const lt = lines[i]!.trim();
        if (lt === "" || /^(#{1,3}\s|[-*]\s|\d+\.\s|>|\||\{\{(tabla|fichas):|:::|-{3,}$)/.test(lt)) break;
        parts.push(lt);
        i++;
      }
      blocks.push({ t: "p", c: parseInline(parts.join(" ")) });
    }
  }
  return blocks;
}

/** Título del artículo: el primer `#`. */
export function articleTitle(blocks: Block[]): string {
  const h = blocks.find((b) => b.t === "h" && b.level === 1);
  return h && h.t === "h" ? h.text : "";
}

/** Enlaces internos (`/wiki/...`) de un artículo, para comprobar que no apuntan a nada inexistente. */
export function internalLinks(blocks: Block[]): string[] {
  const out: string[] = [];
  const walk = (c: Inline[]) => {
    for (const i of c) {
      if (i.t === "link" && i.href.startsWith("/wiki")) out.push(i.href);
      if ("c" in i) walk(i.c);
    }
  };
  for (const b of blocks) {
    if (b.t === "align") out.push(...internalLinks(b.blocks));
    if (b.t === "verse") b.lines.forEach(walk);
    if (b.t === "h" || b.t === "p" || b.t === "quote") walk(b.c);
    else if (b.t === "ul" || b.t === "ol") b.items.forEach(walk);
    else if (b.t === "table") {
      b.head.forEach(walk);
      b.rows.forEach((r) => r.forEach(walk));
    }
  }
  return out;
}

/**
 * Texto plano de todo el artículo (para el buscador). `generated` da el texto
 * de las tablas y fichas generadas, para que también se encuentren.
 */
export function blocksText(blocks: Block[], generated: (b: Extract<Block, { t: "gen" | "cards" }>) => string = () => ""): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.t === "align") parts.push(blocksText(b.blocks, generated));
    if (b.t === "verse") parts.push(...b.lines.map(plain));
    if (b.t === "gen" || b.t === "cards") parts.push(generated(b));
    if (b.t === "h" || b.t === "p" || b.t === "quote") parts.push(plain(b.c));
    else if (b.t === "ul" || b.t === "ol") parts.push(...b.items.map(plain));
    else if (b.t === "table") {
      parts.push(...b.head.map(plain));
      for (const r of b.rows) parts.push(...r.map(plain));
    }
  }
  return parts.join(" \n");
}
