"use strict";

const WRITEUPS_DIRECTORY = "/writeups/";
const FIRST_WRITEUP_NUMBER = 1;
const WRITEUP_BATCH_SIZE = 10;

const app = document.getElementById("app");
const intro = document.querySelector(".intro");
const searchPanel = document.getElementById("search-panel");
const searchInput = document.getElementById("search-input");
const searchToggle = document.getElementById("search-toggle");

let writeups = [];
let searchTerm = "";
let activeTopic = "";
let activeTag = "";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, function (char) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char];
  });
}

function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function requireString(metadata, field, filename) {
  if (typeof metadata[field] !== "string" || !metadata[field].trim()) {
    throw new Error(filename + ": required field '" + field + "' must be a non-empty string.");
  }
  return metadata[field].trim();
}

function requireStringList(metadata, field, filename) {
  const value = metadata[field];
  if (!Array.isArray(value) || value.length === 0 || value.some(function (item) {
    return typeof item !== "string" || !item.trim();
  })) {
    throw new Error(filename + ": required field '" + field + "' must be a non-empty list of strings.");
  }
  const seen = new Set();
  return value.map(function (item) { return item.trim(); }).filter(function (item) {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function optionalString(metadata, field, filename) {
  if (metadata[field] === undefined || metadata[field] === null || metadata[field] === "") return "";
  if (typeof metadata[field] !== "string") {
    throw new Error(filename + ": optional field '" + field + "' must be a string.");
  }
  return metadata[field].trim();
}

function validIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function stripMarkdown(markdown) {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[>*_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseWriteup(number, rawMarkdown) {
  const filename = String(number).padStart(3, "0") + ".md";
  const normalized = String(rawMarkdown).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const frontmatterMatch = normalized.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!frontmatterMatch) {
    throw new Error(filename + ": missing YAML front matter. Start the file with ---.");
  }

  let metadata;
  try {
    metadata = jsyaml.load(frontmatterMatch[1], { schema: jsyaml.JSON_SCHEMA }) || {};
  } catch (error) {
    throw new Error(filename + ": invalid YAML front matter: " + error.message);
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(filename + ": front matter must be a YAML mapping.");
  }

  const date = requireString(metadata, "date", filename);
  if (!validIsoDate(date)) {
    throw new Error(filename + ": 'date' must use YYYY-MM-DD format.");
  }
  if (metadata.published !== undefined && typeof metadata.published !== "boolean") {
    throw new Error(filename + ": optional field 'published' must be true or false.");
  }

  const body = normalized.slice(frontmatterMatch[0].length).trim();
  if (!body) throw new Error(filename + ": article body is empty.");
  const markdownBase = new URL(WRITEUPS_DIRECTORY, document.baseURI).href;
  const html = marked.parse(body, { gfm: true, breaks: false, baseUrl: markdownBase });

  return {
    id: String(number).padStart(3, "0"),
    slug: String(number).padStart(3, "0"),
    date: date,
    title: requireString(metadata, "title", filename),
    summary: requireString(metadata, "summary", filename),
    topics: requireStringList(metadata, "topics", filename),
    tags: requireStringList(metadata, "tags", filename),
    severity: optionalString(metadata, "severity", filename),
    status: optionalString(metadata, "status", filename),
    affected: optionalString(metadata, "affected", filename),
    identifier: optionalString(metadata, "identifier", filename),
    published: metadata.published !== false,
    contentHtml: DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }),
    contentText: stripMarkdown(body)
  };
}

async function fetchWriteup(number) {
  const filename = String(number).padStart(3, "0") + ".md";
  const url = new URL(WRITEUPS_DIRECTORY + filename, document.baseURI).href;
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error("Could not request " + filename + ".");
  }

  if (response.status === 404) return { missing: true, filename: filename };
  if (!response.ok) {
    throw new Error("Could not load " + filename + " (HTTP " + response.status + ").");
  }
  return {
    missing: false,
    filename: filename,
    post: parseWriteup(number, await response.text())
  };
}

async function fetchWriteups() {
  const loaded = [];
  let start = FIRST_WRITEUP_NUMBER;

  while (true) {
    const numbers = Array.from({ length: WRITEUP_BATCH_SIZE }, function (_, index) {
      return start + index;
    });
    const batch = await Promise.all(numbers.map(fetchWriteup));
    const firstMissing = batch.findIndex(function (result) { return result.missing; });

    if (firstMissing !== -1) {
      const laterFileExists = batch.slice(firstMissing + 1).some(function (result) { return !result.missing; });
      if (laterFileExists) {
        throw new Error("There is a numbering gap: " + batch[firstMissing].filename + " is missing, but a later numbered writeup exists.");
      }
      batch.slice(0, firstMissing).forEach(function (result) {
        if (result.post.published) loaded.push(result.post);
      });
      break;
    }

    batch.forEach(function (result) {
      if (result.post.published) loaded.push(result.post);
    });
    start += WRITEUP_BATCH_SIZE;
  }

  if (loaded.length === 0) {
    throw new Error("No published writeups were found.");
  }

  return loaded.sort(function (a, b) {
    const dateOrder = b.date.localeCompare(a.date);
    return dateOrder || b.id.localeCompare(a.id);
  });
}

function getTopics() {
  const topics = new Map();
  writeups.forEach(function (item) {
    item.topics.forEach(function (label) {
      const key = slugify(label);
      if (!topics.has(key)) topics.set(key, { key: key, label: label, count: 0 });
      topics.get(key).count += 1;
    });
  });
  return Array.from(topics.values()).sort(function (a, b) {
    return a.label.localeCompare(b.label);
  });
}

function sidebarMarkup() {
  const topics = getTopics();
  return `
    <aside class="sidebar" aria-label="About and topics">
      <section class="side-section" id="about-summary">
        <h2 class="side-heading">ABOUT</h2>
        <p class="side-copy">A personal log of security research, vulnerability analysis, and exploitation techniques.</p>
      </section>
      <section class="side-section" aria-labelledby="topics-heading">
        <h2 class="side-heading" id="topics-heading">TOPICS</h2>
        <ul class="topic-list">
          ${topics.map(function (topic) {
            const pressed = activeTopic === topic.key ? "true" : "false";
            return `<li><button class="topic-link" type="button" data-topic="${escapeHtml(topic.key)}" aria-pressed="${pressed}">${escapeHtml(topic.label)}</button><span class="topic-count">(${topic.count})</span></li>`;
          }).join("")}
        </ul>
        <button class="clear-filter ${activeTopic || activeTag ? "is-visible" : ""}" id="clear-filter" type="button">[ clear filter ]</button>
      </section>
    </aside>`;
}

function entryMarkup(item) {
  return `
    <article class="entry">
      <time class="entry-date" datetime="${escapeHtml(item.date)}">${escapeHtml(item.date)}</time>
      <h2 class="entry-title"><a href="/writeup/${escapeHtml(item.slug)}/">${escapeHtml(item.title)}</a></h2>
      <p class="entry-summary">${escapeHtml(item.summary)}</p>
      <div class="entry-tags" aria-label="Tags">
        ${item.tags.map(function (tag) { return `<button class="tag-link" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`; }).join("")}
      </div>
    </article>`;
}

function matchesSearch(item) {
  if (!searchTerm) return true;
  const haystack = [item.title, item.summary, item.date, item.identifier, item.severity, item.status, item.affected, item.tags.join(" "), item.topics.join(" "), item.contentText].join(" ").toLowerCase();
  return haystack.includes(searchTerm.toLowerCase());
}

function matchesTopic(item) {
  return !activeTopic || item.topics.some(function (topic) { return slugify(topic) === activeTopic; });
}

function matchesTag(item) {
  return !activeTag || item.tags.some(function (tag) { return tag.toLowerCase() === activeTag; });
}

function renderHome() {
  document.body.classList.remove("article-page");
  document.title = "sinkandsource - Security writeups";
  intro.hidden = false;
  const filtered = writeups.filter(function (item) {
    return matchesSearch(item) && matchesTopic(item) && matchesTag(item);
  });
  const topic = getTopics().find(function (candidate) { return candidate.key === activeTopic; });
  const filterLabel = topic ? " in " + escapeHtml(topic.label) : (activeTag ? " tagged " + escapeHtml(activeTag) : "");
  const resultText = searchTerm || activeTopic || activeTag
    ? `<p class="status-line">${filtered.length} ${filtered.length === 1 ? "writeup" : "writeups"}${filterLabel}${searchTerm ? " matching \"" + escapeHtml(searchTerm) + "\"" : ""}</p>`
    : "";
  const list = filtered.length
    ? filtered.map(entryMarkup).join("")
    : `<div class="empty-state">No writeups found.${searchTerm || activeTopic || activeTag ? `<button type="button" id="reset-results">[ reset filters ]</button>` : ""}</div>`;
  app.innerHTML = `<section class="entries" aria-label="Security writeups">${resultText}${list}</section>${sidebarMarkup()}`;
  bindTopicControls();
  bindTagControls();
  const reset = document.getElementById("reset-results");
  if (reset) reset.addEventListener("click", resetFilters);
  setActiveNav("writeups");
}

function articleMeta(item) {
  const values = [
    `<time datetime="${escapeHtml(item.date)}">${escapeHtml(item.date)}</time>`,
    item.identifier ? `<span>${escapeHtml(item.identifier)}</span>` : "",
    item.severity ? `<span>Severity: ${escapeHtml(item.severity)}</span>` : "",
    item.status ? `<span>${escapeHtml(item.status)}</span>` : "",
    item.affected ? `<span>Affected: ${escapeHtml(item.affected)}</span>` : ""
  ].filter(Boolean);
  return values.join("");
}

function renderArticle(slug) {
  document.body.classList.add("article-page");
  intro.hidden = true;
  const item = writeups.find(function (entry) { return entry.slug === slug; });
  if (!item) {
    app.innerHTML = `<section class="article-view"><a class="back-link" href="/#writeups">&lt; all writeups</a><h1 class="view-heading">Writeup not found</h1><p class="side-copy">That entry does not exist in the writeups directory.</p></section>`;
    setActiveNav("writeups");
    return;
  }
  document.title = item.title + " - sinkandsource";
  app.innerHTML = `
    <article class="article-view">
      <a class="back-link" href="/#writeups">&lt; all writeups</a>
      <h1 class="view-heading">${escapeHtml(item.title)}</h1>
      <div class="article-meta">${articleMeta(item)}</div>
      <p class="article-deck">${escapeHtml(item.summary)}</p>
      <p class="article-topics">TOPICS / ${item.topics.map(escapeHtml).join(" / ")}</p>
      <div class="entry-tags article-taxonomy" aria-label="Tags">
        ${item.tags.map(function (tag) { return `<button class="tag-link" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`; }).join("")}
      </div>
      <div class="article-body">${item.contentHtml}</div>
    </article>
    ${sidebarMarkup()}`;
  bindTopicControls();
  bindTagControls();
  setActiveNav("writeups");
  window.scrollTo(0, 0);
}

function renderAbout() {
  document.body.classList.remove("article-page");
  document.title = "About - sinkandsource";
  intro.hidden = false;
  app.innerHTML = `
    <article class="article-view">
      <p class="view-kicker">SINKANDSOURCE / ABOUT</p>
      <h1 class="view-heading about-heading">A notebook for things that break.</h1>
      <p class="about-intro">I'm Grant Grubbs, a bug bounty hunter and security researcher interested in finding and understanding security vulnerabilities. My research combines hands-on investigation with automated systems to uncover weaknesses and explore how applications behave in unexpected ways.</p>
      <div class="article-body about-copy">
        <p>I enjoy the process of pulling things apart, following unusual behavior, and figuring out what's happening beneath the surface.</p>
        <p>sinkandsource is my personal archive of security research and vulnerability writeups. It's where I document interesting discoveries, technical details, and the occasional rabbit hole worth sharing.</p>
      </div>
      <section class="article-section contact-section">
        <h2>Contact</h2>
        <p>For questions, feedback, collaboration opportunities, or anything else, feel free to reach out at <a href="mailto:hello@sinkandsource.com">hello@sinkandsource.com</a>.</p>
      </section>
    </article>
    ${sidebarMarkup()}`;
  bindTopicControls();
  setActiveNav("about");
  window.scrollTo(0, 0);
}

function renderTopicPage(key) {
  const knownTopic = getTopics().some(function (topic) { return topic.key === key; });
  activeTopic = knownTopic ? key : "";
  activeTag = "";
  searchTerm = "";
  searchInput.value = "";
  closeSearch();
  renderHome();
  window.scrollTo(0, 0);
}

function renderTagPage(tag) {
  activeTopic = "";
  activeTag = tag.toLowerCase();
  searchTerm = "";
  searchInput.value = "";
  closeSearch();
  renderHome();
  window.scrollTo(0, 0);
}

function bindTopicControls() {
  app.querySelectorAll("[data-topic]").forEach(function (button) {
    button.addEventListener("click", function () {
      const topic = button.getAttribute("data-topic");
      if (window.location.pathname !== "/") {
        window.location.href = "/#topic/" + encodeURIComponent(topic);
        return;
      }
      activeTopic = activeTopic === topic ? "" : topic;
      activeTag = "";
      window.location.hash = activeTopic ? "topic/" + activeTopic : "writeups";
      renderHome();
    });
  });
  const clear = document.getElementById("clear-filter");
  if (clear) clear.addEventListener("click", resetFilters);
}

function bindTagControls() {
  app.querySelectorAll("[data-tag]").forEach(function (button) {
    button.addEventListener("click", function () {
      const tag = button.getAttribute("data-tag");
      if (window.location.pathname !== "/") {
        window.location.href = "/#tag/" + encodeURIComponent(tag.toLowerCase());
        return;
      }
      activeTopic = "";
      activeTag = tag.toLowerCase();
      searchTerm = "";
      searchInput.value = "";
      closeSearch();
      window.location.hash = "tag/" + encodeURIComponent(activeTag);
      renderHome();
      window.scrollTo(0, 0);
    });
  });
}

function resetFilters() {
  activeTopic = "";
  activeTag = "";
  searchTerm = "";
  searchInput.value = "";
  window.location.hash = "writeups";
  renderHome();
}

function setActiveNav(name) {
  document.querySelectorAll("[data-nav]").forEach(function (link) {
    if (link.getAttribute("data-nav") === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function openSearch(focusInput) {
  searchPanel.classList.add("is-open");
  searchToggle.setAttribute("aria-expanded", "true");
  if (focusInput !== false) searchInput.focus();
}

function closeSearch() {
  searchPanel.classList.remove("is-open");
  searchToggle.setAttribute("aria-expanded", "false");
}

function showLoadError(message) {
  app.innerHTML = `
    <section class="load-error">
      <h2 class="view-heading">Writeups could not be loaded.</h2>
      <p>${escapeHtml(message)}</p>
    </section>`;
}

function renderRoute() {
  const articlePath = window.location.pathname.match(/^\/writeup\/(\d{3})\/?$/);
  if (articlePath) { renderArticle(articlePath[1]); return; }
  const route = window.location.hash.replace(/^#\/?/, "") || "writeups";
  if (route === "about") {
    renderAbout();
    return;
  }
  if (route === "writeups" || route === "") {
    activeTopic = "";
    activeTag = "";
    renderHome();
    return;
  }
  if (route.indexOf("writeup/") === 0) {
    renderArticle(route.slice("writeup/".length));
    return;
  }
  if (route.indexOf("topic/") === 0) {
    renderTopicPage(route.slice("topic/".length));
    return;
  }
  if (route.indexOf("tag/") === 0) {
    let tag = route.slice("tag/".length);
    try { tag = decodeURIComponent(tag); } catch (_) { /* Keep the literal fragment. */ }
    renderTagPage(tag);
    return;
  }
  renderHome();
}

async function loadWriteups() {
  app.innerHTML = `<section class="entries"><p class="side-copy">Loading writeups...</p></section>${sidebarMarkup()}`;

  if (typeof marked === "undefined" || typeof jsyaml === "undefined" || typeof DOMPurify === "undefined") {
    showLoadError("A required CDN library did not load. Check your internet connection and reload the page.");
    return;
  }

  try {
    writeups = await fetchWriteups();
    renderRoute();
  } catch (error) {
    console.error("sinkandsource:", error);
    showLoadError(error.message || "An unknown error occurred.");
  }
}

searchToggle.addEventListener("click", function () {
  const currentRoute = window.location.hash.replace(/^#\/?/, "") || "writeups";
  if (currentRoute === "about") {
    window.location.hash = "writeups";
    renderHome();
    openSearch(true);
    return;
  }
  if (searchPanel.classList.contains("is-open")) closeSearch();
  else openSearch(true);
});

searchInput.addEventListener("input", function () {
  searchTerm = searchInput.value.trim();
  activeTopic = "";
  activeTag = "";
  if (window.location.hash !== "#writeups") history.replaceState(null, "", "#writeups");
  renderHome();
  openSearch(false);
  searchInput.focus();
});

document.addEventListener("keydown", function (event) {
  const target = event.target;
  const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    openSearch(true);
  }
  if (event.key === "Escape" && searchPanel.classList.contains("is-open")) {
    closeSearch();
    searchToggle.focus();
  }
});

document.querySelector(".skip-link").addEventListener("click", function (event) {
  event.preventDefault();

  const main = document.getElementById("main-content");
  main.focus({ preventScroll: true });
  main.scrollIntoView({ block: "start" });
});

window.addEventListener("hashchange", renderRoute);
loadWriteups();
