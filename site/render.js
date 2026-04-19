import { mdiContentCopy, mdiDownload, mdiFileDocumentOutline } from "@mdi/js";

const PAGE_SIZE_BY_VIEW = {
  tile: 240,
  content: 25,
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkifyJsonUrls(value) {
  return escapeHtml(value).replaceAll(
    /&quot;(https?:\/\/[^"\s]+)&quot;/g,
    (_, url) => `&quot;<a class="json-link" href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>&quot;`,
  );
}

function renderIconSize(icon) {
  if (icon.extension === "svg") {
    return escapeHtml(".svg");
  }
  if (icon.extension === "ico") {
    const sizeLabel = icon.sizes.length ? icon.sizes.join("/") : "ico";
    return escapeHtml(`${sizeLabel}.ico`);
  }
  const sizeLabel = icon.sizes.length ? icon.sizes.join("/") : "size n/a";
  return escapeHtml(`${sizeLabel}.${icon.extension}`);
}

function iconSortValue(icon) {
  if (icon.extension === "ico" || icon.extension === "svg") {
    return Number.POSITIVE_INFINITY;
  }
  return icon.sizes.length ? Math.min(...icon.sizes) : Number.POSITIVE_INFINITY;
}

function normalizeOrigin(origin) {
  if (origin === "html" || origin === "root") {
    return "site";
  }
  return origin || "unknown";
}

function sortIconsWithinOrigin(icons) {
  return [...icons].sort((left, right) => {
    const sizeDiff = iconSortValue(left) - iconSortValue(right);
    if (sizeDiff) {
      return sizeDiff;
    }
    const extensionDiff = left.extension.localeCompare(right.extension);
    if (extensionDiff) {
      return extensionDiff;
    }
    return left.file.localeCompare(right.file);
  });
}

function iconOriginLabel(icon, groupedOrigin) {
  if (groupedOrigin === "site" && (icon.origin === "html" || icon.origin === "root")) {
    return `site ${icon.origin}`;
  }
  return icon.origin || groupedOrigin;
}

function groupIconsByOrigin(icons) {
  const groups = new Map();
  for (const icon of icons) {
    const key = normalizeOrigin(icon.origin);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(icon);
  }

  return new Map(
    [...groups.entries()].map(([origin, groupedIcons]) => [origin, sortIconsWithinOrigin(groupedIcons)]),
  );
}

function renderIcons(icons, origin) {
  if (!icons.length) {
    return `<span class="hint">No ${origin} icons</span>`;
  }

  return [
    '<div class="icon-stack">',
    '<div class="icon-grid">',
    icons.map((icon) => [
      `<a class="icon-card" href="${icon.assetUrl}" download="${escapeHtml(icon.file)}" title="${escapeHtml(`${renderIconSize(icon)} download · origin: ${iconOriginLabel(icon, origin)}`)}" aria-label="${escapeHtml(`Download ${icon.file}`)}">`,
      `<img class="icon-thumb" src="${icon.assetUrl}" alt="" loading="lazy">`,
      '<span class="icon-meta-row">',
      `<span class="icon-size">${renderIconSize(icon)}</span>`,
      '<span class="icon-download-badge" aria-hidden="true">',
      `<svg viewBox="0 0 24 24" focusable="false"><path d="${mdiDownload}"></path></svg>`,
      "</span>",
      "</span>",
      "</a>",
    ].join("")).join(""),
    "</div>",
    "</div>",
  ].join("");
}

function renderDomainButton(entry) {
  return [
    `<button class="domain-button" type="button" data-domain="${escapeHtml(entry.domain)}" aria-label="Open ${escapeHtml(entry.domain)} details" title="Open details">`,
    escapeHtml(entry.domain),
    "</button>",
  ].join("");
}

function renderDomainPreview(entry) {
  return [
    '<div class="domain">',
    `<img class="preview" src="${entry.previewUrl}" alt="${escapeHtml(entry.domain)} representative favicon" loading="lazy" data-domain="${escapeHtml(entry.domain)}">`,
    renderDomainButton(entry),
    "</div>",
  ].join("");
}

function renderTileCard(entry) {
  return [
    `<article class="tile-panel" data-domain="${escapeHtml(entry.domain)}" title="${escapeHtml(entry.domain)}">`,
    '<div class="tile-media">',
    `<img class="preview tile-preview" src="${entry.previewUrl}" alt="${escapeHtml(entry.domain)} representative favicon" loading="lazy">`,
    "</div>",
    "</article>",
  ].join("");
}

function renderContentRows(entries) {
  return entries.map((entry) => {
    const groupedIcons = groupIconsByOrigin(entry.icons);
    const siteIcons = groupedIcons.get("site") || [];
    const gstaticIcons = groupedIcons.get("gstatic") || [];

    return [
      "<tr>",
      "<td>",
      renderDomainPreview(entry),
      "</td>",
      `<td>${renderIcons(siteIcons, "site")}</td>`,
      `<td>${renderIcons(gstaticIcons, "gstatic")}</td>`,
      "</tr>",
    ].join("");
  }).join("");
}

function renderTileGrid(entries) {
  return entries.length
    ? `<div class="icon-tile-grid">${entries.map((entry) => renderTileCard(entry)).join("")}</div>`
    : "";
}

function parentDomain(domain) {
  const parts = domain.split(".");
  return parts.length > 2 ? parts.slice(1).join(".") : null;
}

function isDirectChildDomain(domain, maybeParent) {
  return parentDomain(domain) === maybeParent;
}

function siblingDomains(domain, allDomains) {
  const parent = parentDomain(domain);
  if (!parent) {
    return [];
  }

  return allDomains.filter((candidate) => candidate !== domain && parentDomain(candidate) === parent);
}

function relatedDomains(domain, entries) {
  const domains = entries.map((entry) => entry.domain);
  const parent = parentDomain(domain);
  const children = domains.filter((candidate) => isDirectChildDomain(candidate, domain));
  const siblings = siblingDomains(domain, domains);
  const related = new Set([...(parent ? [parent] : []), ...children, ...siblings]);
  related.delete(domain);
  return domains.filter((candidate) => related.has(candidate));
}

function renderRelatedDomains(entry, entries) {
  const domains = relatedDomains(entry.domain, entries);
  if (!domains.length) {
    return "";
  }

  const relatedEntries = entries.filter((candidate) => domains.includes(candidate.domain));

  return [
    '<section class="detail-section">',
    "<h3>Domains</h3>",
    '<div class="related-domains">',
    relatedEntries.map((relatedEntry) => [
      `<button class="related-domain-button" type="button" data-domain="${escapeHtml(relatedEntry.domain)}" aria-label="Open ${escapeHtml(relatedEntry.domain)} details" title="Open details">`,
      `<img class="related-domain-preview" src="${relatedEntry.previewUrl}" alt="" loading="lazy">`,
      `<span class="related-domain-label">${escapeHtml(relatedEntry.domain)}</span>`,
      "</button>",
    ].join("")).join(""),
    "</div>",
    "</section>",
  ].join("");
}

function renderDetailHeader(entry) {
  return [
    `<img class="detail-title-preview" src="${entry.previewUrl}" alt="" loading="lazy">`,
    `<span class="detail-title-copy">${escapeHtml(entry.domain)}</span>`,
    `<button class="detail-manifest-trigger" type="button" data-manifest-domain="${escapeHtml(entry.domain)}" aria-label="Open ${escapeHtml(entry.domain)} manifest" title="Open manifest">`,
    `<span class="detail-stats">${entry.icons.length} icon${entry.icons.length === 1 ? "" : "s"}</span>`,
    '<span class="detail-manifest-icon" aria-hidden="true">',
    `<svg viewBox="0 0 24 24" focusable="false"><path d="${mdiFileDocumentOutline}"></path></svg>`,
    "</span>",
    "</button>",
  ].join("");
}

function renderDetailView(entry, entries) {
  if (!entry) {
    return "";
  }

  const groupedIcons = groupIconsByOrigin(entry.icons);
  const siteIcons = groupedIcons.get("site") || [];
  const gstaticIcons = groupedIcons.get("gstatic") || [];

  return [
    '<div class="detail-info">',
    '<div class="detail-sections">',
    "<section class=\"detail-section\">",
    "<h3>Site Icons</h3>",
    siteIcons.length ? renderIcons(siteIcons, "site") : '<p class="hint">No site icons</p>',
    "</section>",
    "<section class=\"detail-section\">",
    "<h3>Gstatic Icons</h3>",
    gstaticIcons.length ? renderIcons(gstaticIcons, "gstatic") : '<p class="hint">No gstatic icons</p>',
    "</section>",
    renderRelatedDomains(entry, entries),
    "</div>",
    "</div>",
  ].join("");
}

function pageSizeForView(view) {
  return PAGE_SIZE_BY_VIEW[view] || PAGE_SIZE_BY_VIEW.tile;
}

function totalPages(entries, view) {
  const pageSize = pageSizeForView(view);
  return Math.max(1, Math.ceil(entries.length / pageSize));
}

function pageRange(entries, view, currentPage) {
  const pageSize = pageSizeForView(view);
  const start = (currentPage - 1) * pageSize;
  return { pageSize, start, currentPage };
}

function syncViewControls(dom, state, hasResults = true) {
  const tileActive = state.view === "tile" && !state.detailDomain;
  const contentActive = state.view === "content" && !state.detailDomain;
  const detailActive = !!state.detailDomain;

  dom.tileViewButton.classList.toggle("active", tileActive);
  dom.contentViewButton.classList.toggle("active", contentActive);
  dom.tileViewButton.setAttribute("aria-pressed", tileActive ? "true" : "false");
  dom.contentViewButton.setAttribute("aria-pressed", contentActive ? "false" : "true");

  dom.tileViewNode.hidden = !hasResults || !tileActive;
  dom.contentViewNode.hidden = !hasResults || !contentActive;
  dom.detailViewNode.hidden = !detailActive;
  dom.emptyNode.hidden = hasResults;
}

function renderPager(dom, total, page, onPageChange) {
  dom.pagerNode.innerHTML = "";

  const prev = document.createElement("button");
  prev.textContent = "Previous";
  prev.className = "btn";
  prev.disabled = page <= 1;
  prev.addEventListener("click", () => {
    onPageChange(page - 1);
  });
  dom.pagerNode.appendChild(prev);

  const windowStart = Math.max(1, page - 2);
  const windowEnd = Math.min(total, page + 2);
  for (let value = windowStart; value <= windowEnd; value += 1) {
    const button = document.createElement("button");
    button.textContent = String(value);
    button.className = value === page ? "btn active" : "btn";
    button.addEventListener("click", () => {
      onPageChange(value);
    });
    dom.pagerNode.appendChild(button);
  }

  const next = document.createElement("button");
  next.textContent = "Next";
  next.className = "btn";
  next.disabled = page >= total;
  next.addEventListener("click", () => {
    onPageChange(page + 1);
  });
  dom.pagerNode.appendChild(next);
}

export function searchPlaceholder(entries) {
  const faviconCount = entries.reduce((count, entry) => count + entry.icons.length, 0);
  const domainCount = entries.length;
  return `Search ${domainCount} domain${domainCount === 1 ? "" : "s"}, ${faviconCount} favicon${faviconCount === 1 ? "" : "s"}...`;
}

export function renderIndexPanel(dom, state) {
  if (!state.index || state.error || !dom.indexDialogNode.open) {
    dom.indexContentNode.innerHTML = "";
    return;
  }

  const json = linkifyJsonUrls(JSON.stringify(state.index, null, 2));
  dom.indexContentNode.innerHTML = `<pre class="index-code">${json}</pre>`;
}

export function renderManifestDialog(dom, state) {
  if (!state.manifestEntry || !dom.manifestDialogNode.open) {
    dom.manifestContentNode.innerHTML = "";
    return;
  }

  const manifestJson = linkifyJsonUrls(JSON.stringify(state.manifestEntry.manifest, null, 2));
  dom.manifestDialogTitleNode.textContent = `${state.manifestEntry.domain} manifest`;
  dom.manifestDownloadNode.href = state.manifestEntry.manifestUrl;
  dom.manifestDownloadNode.download = `${state.manifestEntry.domain}-manifest.json`;
  dom.manifestCopyNode.dataset.copied = "false";
  dom.manifestContentNode.innerHTML = [
    '<p class="index-note">',
    'URL: ',
    `<a class="inline-link" href="${state.manifestEntry.manifestUrl}" target="_blank" rel="noreferrer noopener">${escapeHtml(state.manifestEntry.manifestUrl)}</a>`,
    "</p>",
    `<pre class="index-code">${manifestJson}</pre>`,
  ].join("");
}

export function renderError(dom, state) {
  dom.summary.textContent = state.error;
  dom.pageSummary.textContent = "No results";
  dom.tileViewNode.innerHTML = "";
  dom.rowsNode.innerHTML = "";
  dom.tileViewNode.hidden = true;
  dom.contentViewNode.hidden = true;
  dom.emptyNode.hidden = false;
  dom.emptyNode.textContent = state.error;
  dom.pagerNode.innerHTML = "";
  renderIndexPanel(dom, state);
}

export function renderApp(dom, state, actions) {
  if (state.error) {
    renderError(dom, state);
    return;
  }

  if (state.detailDomain) {
    const entry = state.entries.find((item) => item.domain === state.detailDomain);
    if (entry) {
      dom.detailTitleNode.innerHTML = renderDetailHeader(entry);
      dom.detailContentNode.innerHTML = renderDetailView(entry, state.entries);
    }
    syncViewControls(dom, state, true);
    return;
  }

  const query = dom.searchInput.value.trim().toLowerCase();
  const entries = query
    ? state.entries.filter((entry) => entry.domain.toLowerCase().includes(query))
    : state.entries;
  const pages = totalPages(entries, state.view);
  const currentPage = Math.min(actions.getCurrentPage(), pages);
  actions.setCurrentPage(currentPage);

  const { pageSize, start } = pageRange(entries, state.view, currentPage);
  const visible = entries.slice(start, start + pageSize);

  dom.summary.textContent = `${entries.length} matched`;
  dom.pageSummary.textContent = entries.length === 0
    ? "No results"
    : `Showing ${start + 1}-${start + visible.length} of ${entries.length}`;

  dom.rowsNode.innerHTML = renderContentRows(visible);
  dom.tileViewNode.innerHTML = renderTileGrid(visible);

  const hasResults = visible.length > 0;
  dom.emptyNode.hidden = hasResults;
  syncViewControls(dom, state, hasResults);
  renderPager(dom, pages, currentPage, actions.changePage);
  renderIndexPanel(dom, state);
}
