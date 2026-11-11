"use strict";

// Generates one real HTML page per writeup (for search indexing + link
// previews), a sitemap.xml, and a 404.html SPA fallback. No dependencies:
// run with `node build.js` from the site root.

const fs = require("fs");
const path = require("path");

const SITE = "https://sinkandsource.com"; // no trailing slash; must match CNAME
const root = __dirname;
const template = fs.readFileSync(path.join(root, "index.html"), "utf8");

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );

// Minimal scalar front-matter reader (title / summary / date / published).
// Swap in js-yaml here if your front matter ever grows beyond simple fields.
function frontMatter(md) {
  const m = md
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.+?)\s*$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return fm;
}

function metaBlock({ title, summary, url }) {
  return (
    "<!-- META:START -->\n" +
    `  <title>${esc(title)}</title>\n` +
    `  <meta name="description" content="${esc(summary)}">\n` +
    `  <link rel="canonical" href="${esc(url)}">\n` +
    `  <meta property="og:type" content="article">\n` +
    `  <meta property="og:title" content="${esc(title)}">\n` +
    `  <meta property="og:description" content="${esc(summary)}">\n` +
    `  <meta property="og:url" content="${esc(url)}">\n` +
    `  <meta property="og:site_name" content="sinkandsource">\n` +
    `  <meta name="twitter:card" content="summary">\n` +
    `  <meta name="twitter:title" content="${esc(title)}">\n` +
    `  <meta name="twitter:description" content="${esc(summary)}">\n` +
    "  <!-- META:END -->"
  );
}

const swapMeta = (block) =>
  template.replace(/<!-- META:START -->[\s\S]*?<!-- META:END -->/, block);

// Collect published writeups.
const posts = [];
for (const file of fs
  .readdirSync(path.join(root, "writeups"))
  .filter((f) => /^\d{3}\.md$/.test(f))
  .sort()) {
  const fm = frontMatter(
    fs.readFileSync(path.join(root, "writeups", file), "utf8")
  );
  if (!fm) {
    console.warn(`Skipping ${file}: no front matter.`);
    continue;
  }
  if (fm.published === "false") continue;
  const id = file.slice(0, 3);
  posts.push({
    id,
    url: `${SITE}/writeup/${id}/`,
    title: fm.title,
    summary: fm.summary,
    date: fm.date,
  });
}

// Per-post stub pages.
for (const p of posts) {
  const dir = path.join(root, "writeup", p.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "index.html"),
    swapMeta(
      metaBlock({
        title: `${p.title} - sinkandsource`,
        summary: p.summary,
        url: p.url,
      })
    )
  );
}

// SPA fallback for client-only routes (#about, #topic/x, #tag/x, bad paths).
fs.writeFileSync(path.join(root, "404.html"), template);

// Sitemap.
fs.writeFileSync(
  path.join(root, "sitemap.xml"),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${SITE}/</loc></url>\n` +
    posts
      .map(
        (p) => `  <url><loc>${p.url}</loc><lastmod>${p.date}</lastmod></url>`
      )
      .join("\n") +
    "\n</urlset>\n"
);

console.log(`Generated ${posts.length} writeup page(s), sitemap.xml, 404.html.`);
