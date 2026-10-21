import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE_LOCALES } from "@imperium/shared";
import { allArticles, articleSource, getArticle, remoteFrom, wikiIndex } from "../src/wiki/articles";
import { diffChunks, diffLines } from "../src/wiki/diff";
import { staleLocale } from "../src/wiki/WikiEditor";
import { anchorId, internalLinks, parseInline, parseMarkdown, safeHref } from "../src/wiki/markdown";
import { searchArticles } from "../src/wiki/search";
import { WIKI_ARTICLES, routeSlug, slugFromPath, wikiPath } from "../src/wiki/slugs";
import { GEN_CARDS, GEN_TABLES, buildCards, buildTable } from "../src/wiki/tables";

const contentDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/wiki/content");

describe("Wiki: rutas", () => {
  it("reconoce la portada y los artículos, con o sin barra final", () => {
    expect(slugFromPath("/wiki")).toBe("inicio");
    expect(slugFromPath("/wiki/")).toBe("inicio");
    expect(slugFromPath("/wiki/economia")).toBe("economia");
    expect(slugFromPath("/wiki/economia/")).toBe("economia");
    expect(slugFromPath("/wiki/no-existe")).toBeNull();
    expect(slugFromPath("/")).toBeNull();
    expect(wikiPath("inicio")).toBe("/wiki/");
    expect(wikiPath("economia")).toBe("/wiki/economia/");
  });
});

describe("Wiki: Markdown", () => {
  it("formatos en línea, teclas, enlaces y escapes", () => {
    expect(parseInline("**a** *b* `c` [[J]] [d](/wiki/leyes) \\*e")).toEqual([
      { t: "strong", c: [{ t: "text", v: "a" }] },
      { t: "text", v: " " },
      { t: "em", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "code", v: "c" },
      { t: "text", v: " " },
      { t: "kbd", v: "J" },
      { t: "text", v: " " },
      { t: "link", href: "/wiki/leyes", c: [{ t: "text", v: "d" }] },
      { t: "text", v: " *e" },
    ]);
  });

  it("bloques: títulos con ancla, listas, tablas, avisos y tablas generadas", () => {
    const blocks = parseMarkdown(
      "# Título\n\nUn párrafo\nen dos líneas.\n\n## Cómo se calcula\n\n- uno\n- dos\n\n1. a\n2. b\n\n| X | Y |\n|---|---|\n| 1 | 2 |\n\n> [!dev] Pronto.\n\n{{tabla:minas}}\n{{fichas:especies}}",
    );
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "h", "ul", "ol", "table", "quote", "gen", "cards"]);
    expect(blocks[2]).toMatchObject({ level: 2, id: "como-se-calcula" });
    expect(blocks[1]).toEqual({ t: "p", c: [{ t: "text", v: "Un párrafo en dos líneas." }] });
    expect(blocks[5]).toMatchObject({ head: [[{ t: "text", v: "X" }], [{ t: "text", v: "Y" }]], rows: [[[{ t: "text", v: "1" }], [{ t: "text", v: "2" }]]] });
    expect(blocks[6]).toMatchObject({ kind: "dev", c: [{ t: "text", v: "Pronto." }] });
    expect(anchorId("La nave del Emperador")).toBe("la-nave-del-emperador");
  });
});

describe("Wiki: contenido", () => {
  it("cada artículo existe en español y en inglés, y no sobra ninguno", () => {
    const slugs = WIKI_ARTICLES.map((a) => a.slug).sort();
    for (const locale of BASE_LOCALES) {
      const files = readdirSync(resolve(contentDir, locale))
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -3))
        .sort();
      expect(files).toEqual(slugs);
      for (const slug of slugs) {
        expect(articleSource(locale, slug)).not.toBeNull();
        expect(getArticle(locale, slug)!.title.length).toBeGreaterThan(0);
      }
    }
  });

  it("los enlaces internos llevan a artículos y anclas que existen (en el mismo idioma)", () => {
    for (const locale of BASE_LOCALES) {
      const anchors = new Map<string, Set<string>>();
      for (const a of allArticles(locale)) {
        const ids = new Set<string>();
        for (const b of a.blocks) {
          if (b.t === "h") ids.add(b.id);
          if (b.t === "cards") for (const c of buildCards(b.id, locale) ?? []) ids.add(anchorId(c.title));
        }
        anchors.set(a.slug, ids);
      }
      for (const a of allArticles(locale)) {
        for (const href of internalLinks(a.blocks)) {
          const [path, hash] = href.split("#");
          const target = slugFromPath(path!);
          expect(target, `${locale}/${a.slug}: ${href}`).not.toBeNull();
          if (hash) expect(anchors.get(target!)!.has(hash), `${locale}/${a.slug}: ${href}`).toBe(true);
        }
      }
    }
  });

  it("las tablas y fichas generadas existen y salen completas en los dos idiomas", () => {
    const used = new Set<string>();
    for (const locale of BASE_LOCALES) {
      for (const a of allArticles(locale)) {
        for (const b of a.blocks) {
          if (b.t !== "gen" && b.t !== "cards") continue;
          used.add(`${b.t}:${b.id}`);
          const text = JSON.stringify(b.t === "gen" ? buildTable(b.id, locale) : buildCards(b.id, locale));
          expect(text, `${locale}/${a.slug}: ${b.id}`).not.toBe("null");
          expect(text).not.toMatch(/undefined|NaN|\{[a-z]+\}|wiki\./);
        }
      }
    }
    // Ninguna tabla definida se queda sin usar.
    for (const id of Object.keys(GEN_TABLES)) expect(used.has(`gen:${id}`), id).toBe(true);
    for (const id of Object.keys(GEN_CARDS)) expect(used.has(`cards:${id}`), id).toBe(true);
  });

  it("el ejemplo de economía usa las reglas reales", () => {
    const table = buildTable("ejemplo", "es")!;
    const row = (label: string) => table.rows.find((r) => r[0] === label)![1];
    // Riqueza efectiva 2 + 1/2 de metal y 1 + 2/2 de volátiles; (2 + 6 × 2 minas) por punto.
    expect(row("Metal extraído")).toBe("35/h");
    expect(row("Volátiles extraídos")).toBe("28/h");
    expect(row("Cristal extraído")).toBe("3,5/h");
  });
});

describe("Wiki: buscador", () => {
  it("encuentra sin tildes y prioriza el título", () => {
    const hits = searchArticles(allArticles("es"), "economia");
    expect(hits[0]!.slug).toBe("economia");
    expect(searchArticles(allArticles("es"), "refinería aleaciones").some((h) => h.slug === "economia")).toBe(true);
  });

  it("busca también en las tablas y fichas generadas", () => {
    expect(searchArticles(allArticles("es"), "Casta Cercenada").map((h) => h.slug)).toContain("especies");
    expect(searchArticles(allArticles("en"), "Severed Caste").map((h) => h.slug)).toContain("especies");
  });

  it("sin coincidencias, nada; consultas de una letra, nada", () => {
    expect(searchArticles(allArticles("es"), "zzqxw")).toEqual([]);
    expect(searchArticles(allArticles("es"), "a")).toEqual([]);
  });
});

describe("Wiki editable: seguridad del Markdown", () => {
  it("los enlaces con esquemas peligrosos se quedan en texto", () => {
    for (const href of ["javascript:alert%281%29", "JaVaScRiPt:alert%281%29", "data:text/html,<script>x</script>", "vbscript:x", "//malvada.example", "/\\malvada.example", "relativo"]) {
      expect(safeHref(href)).toBeNull();
      expect(parseInline(`[pulsa](${href})`)).toEqual([{ t: "text", v: "pulsa" }]);
    }
    for (const href of ["/wiki/leyes", "#ancla", "https://aeonarch.de", "http://x.es/a?b=c", "mailto:a@b.es"]) expect(safeHref(href)).toBe(href);
  });

  it("el HTML del texto es texto (lo escapa React al dibujarlo)", () => {
    const blocks = parseMarkdown('# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script> **<b>x</b>**');
    expect(blocks[0]).toMatchObject({ t: "h", text: "<img src=x onerror=alert(1)>" });
    expect(blocks[1]).toEqual({
      t: "p",
      c: [{ t: "text", v: "<script>alert(1)</script> " }, { t: "strong", c: [{ t: "text", v: "<b>x</b>" }] }],
    });
  });
});

describe("Wiki editable: versiones publicadas, índice y rutas", () => {
  const pub = (slug: string, locale: "es" | "en", body: string, revisionId = 1, at = 1000) => ({ slug, locale, body, revisionId, at });

  it("la versión publicada es la última revisión; sin ella, el repositorio (y las tablas siguen funcionando)", () => {
    const remote = remoteFrom({ pages: [], published: [pub("leyes", "es", "# Leyes nuevas\n\n{{tabla:minas}}")], admin: false });
    const a = getArticle("es", "leyes", remote)!;
    expect(a.title).toBe("Leyes nuevas");
    expect(a.blocks[1]).toEqual({ t: "gen", id: "minas" });
    expect(buildTable("minas", "es")).not.toBeNull();
    // El otro idioma sigue con el repositorio; sin API, todo como antes.
    expect(getArticle("en", "leyes", remote)!.title).toBe(getArticle("en", "leyes")!.title);
    expect(getArticle("es", "leyes")!.title).not.toBe("Leyes nuevas");
  });

  it("artículos nuevos tras los del repositorio en su grupo; los ocultos solo para administradores", () => {
    const remote = remoteFrom({
      pages: [
        { slug: "rutas", group: "start", hidden: false, custom: true, position: 1 },
        { slug: "lore", group: "people", hidden: true, custom: false, position: 0 },
        { slug: "leyes", group: "war", hidden: false, custom: false, position: 0 },
      ],
      published: [pub("rutas", "es", "# Rutas")],
      admin: true,
    });
    const slugs = wikiIndex(remote).map((e) => e.slug);
    expect(slugs.slice(0, 3)).toEqual(["inicio", "primeros-pasos", "rutas"]);
    expect(slugs).not.toContain("lore");
    expect(slugs.indexOf("leyes")).toBe(slugs.indexOf("guerra") - 1);
    expect(wikiIndex(remote, true).map((e) => e.slug)).toContain("lore");
    // Sin texto en inglés, el español.
    expect(getArticle("en", "rutas", remote)!.title).toBe("Rutas");
    expect(allArticles("es", remote).map((a) => a.slug)).toContain("rutas");
  });

  it("rutas de los artículos nuevos: /wiki/?p=<slug>", () => {
    expect(wikiPath("rutas-comerciales")).toBe("/wiki/?p=rutas-comerciales");
    expect(routeSlug("/wiki/", "?p=rutas-comerciales")).toBe("rutas-comerciales");
    expect(routeSlug("/wiki/", "?p=../x")).toBeNull();
    expect(routeSlug("/wiki/rutas-comerciales/")).toBe("rutas-comerciales");
    expect(routeSlug("/wiki/")).toBe("inicio");
    expect(routeSlug("/otra")).toBeNull();
    expect(slugFromPath("/wiki/rutas-comerciales")).toBeNull();
  });

  it("aviso de idioma desactualizado", () => {
    const r = (es: number, en: number) =>
      remoteFrom({ pages: [], published: [...(es ? [pub("leyes", "es", "a", 1, es)] : []), ...(en ? [pub("leyes", "en", "b", 2, en)] : [])], admin: true });
    expect(staleLocale(r(0, 0), "leyes")).toBeNull();
    expect(staleLocale(r(2000, 0), "leyes")).toEqual({ stale: "en", fresh: "es" });
    expect(staleLocale(r(2000, 3000), "leyes")).toEqual({ stale: "es", fresh: "en" });
  });
});

describe("Wiki editable: diferencias", () => {
  it("líneas iguales, quitadas y añadidas, con contexto", () => {
    const d = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne");
    expect(d).toEqual([
      { t: "same", text: "a" },
      { t: "del", text: "b" },
      { t: "add", text: "B" },
      { t: "same", text: "c" },
      { t: "same", text: "d" },
      { t: "add", text: "e" },
    ]);
    expect(diffChunks(diffLines("x", "x"))).toEqual([]);
    const long = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const chunks = diffChunks(diffLines(long.join("\n"), [...long.slice(0, 10), "nuevo", ...long.slice(10)].join("\n")), 1);
    expect(chunks).toEqual([{ t: "gap", count: 9 }, { t: "same", text: "l9" }, { t: "add", text: "nuevo" }, { t: "same", text: "l10" }, { t: "gap", count: 9 }]);
  });
});
