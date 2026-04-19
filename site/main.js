import {
  mdiArrowLeft,
  mdiCheck,
  mdiClose,
  mdiContentCopy,
  mdiDownload,
  mdiFileDocumentOutline,
  mdiGithub,
  mdiMagnify,
  mdiTableLarge,
  mdiViewGridOutline,
  mdiWeatherNight,
  mdiWhiteBalanceSunny,
} from "@mdi/js";
import { loadCatalog } from "./catalog.js";
import {
  renderApp,
  renderIndexPanel,
  renderManifestDialog,
  searchPlaceholder,
} from "./render.js";
import "./styles.css";

const BASE_URL = import.meta.env.BASE_URL;
const SNAPSHOT_BASE_URL = import.meta.env.VITE_SNAPSHOT_BASE_URL || 'https://favicon-catalog.github.io/favicons/';

const searchInput = document.getElementById("search");
const summary = document.getElementById("summary");
const pageSummary = document.getElementById("page-summary");
const tileViewNode = document.getElementById("tile-view");
const contentViewNode = document.getElementById("content-view");
const detailViewNode = document.getElementById("detail-view");
const detailTitleNode = document.getElementById("detail-title");
const detailContentNode = document.getElementById("detail-content");
const detailBackButton = document.getElementById("detail-back-button");
const backIconPath = document.getElementById("back-icon-path");
const rowsNode = document.getElementById("rows");
const emptyNode = document.getElementById("empty");
const pagerNode = document.getElementById("pager");
const tagNode = document.getElementById("tag");
const footerTagNode = document.getElementById("footer-tag");
const exportedAtNode = document.getElementById("exported-at");
const indexDialogNode = document.getElementById("index-dialog");
const indexContentNode = document.getElementById("index-content");
const indexCloseNode = document.getElementById("index-close");
const indexDownloadNode = document.getElementById("index-download");
const indexCopyNode = document.getElementById("index-copy");
const indexMenuButton = document.getElementById("index-menu-button");
const manifestDialogNode = document.getElementById("manifest-dialog");
const manifestContentNode = document.getElementById("manifest-content");
const manifestCloseNode = document.getElementById("manifest-close");
const manifestDialogTitleNode = document.getElementById("manifest-dialog-title");
const manifestDownloadNode = document.getElementById("manifest-download");
const manifestCopyNode = document.getElementById("manifest-copy");
const themeToggleButton = document.getElementById("theme-toggle");
const themeTogglePath = document.getElementById("theme-toggle-path");
const indexIconPath = document.getElementById("index-icon-path");
const indexDownloadIconPath = document.getElementById("index-download-icon-path");
const indexCopyIconPath = document.getElementById("index-copy-icon-path");
const githubIconPath = document.getElementById("github-icon-path");
const searchIconPath = document.getElementById("search-icon-path");
const tileViewIconPath = document.getElementById("tile-view-icon-path");
const contentViewIconPath = document.getElementById("content-view-icon-path");
const closeIconPath = document.getElementById("close-icon-path");
const manifestCloseIconPath = document.getElementById("manifest-close-icon-path");
const manifestDownloadIconPath = document.getElementById("manifest-download-icon-path");
const manifestCopyIconPath = document.getElementById("manifest-copy-icon-path");
const tileViewButton = document.getElementById("tile-view-button");
const contentViewButton = document.getElementById("content-view-button");
let indexCopyResetTimer = null;
let manifestCopyResetTimer = null;

const state = {
  currentPage: {
    tile: 1,
    content: 1,
  },
  entries: [],
  error: "",
  index: null,
  manifestEntry: null,
  view: window.localStorage.getItem("favicon-catalog-view") === "content" ? "content" : "tile",
  detailDomain: null,
};

const THEME_KEY = "favicon-catalog-theme";
const VIEW_KEY = "favicon-catalog-view";
const THEME_ICONS = {
  dark: mdiWeatherNight,
  light: mdiWhiteBalanceSunny,
};
const dom = {
  searchInput,
  summary,
  pageSummary,
  tileViewNode,
  contentViewNode,
  detailViewNode,
  detailTitleNode,
  detailContentNode,
  rowsNode,
  emptyNode,
  pagerNode,
  indexDialogNode,
  indexContentNode,
  indexDownloadNode,
  indexCopyNode,
  manifestDialogNode,
  manifestContentNode,
  manifestDialogTitleNode,
  manifestDownloadNode,
  manifestCopyNode,
  tileViewButton,
  contentViewButton,
};

function setIconPath(node, path) {
  node.setAttribute("d", path);
}

function currentTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  window.localStorage.setItem(THEME_KEY, theme);
  themeToggleButton.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  themeToggleButton.setAttribute("title", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  setIconPath(themeTogglePath, theme === "dark" ? THEME_ICONS.dark : THEME_ICONS.light);
}

function snapshotUrl(relativePath) {
  return new URL(relativePath, SNAPSHOT_BASE_URL).toString();
}

function getCurrentPage() {
  return state.currentPage[state.view];
}

function setCurrentPage(value) {
  state.currentPage[state.view] = Math.max(1, value);
}

function setView(view) {
  state.view = view === "content" ? "content" : "tile";
  window.localStorage.setItem(VIEW_KEY, state.view);
}

function basePath() {
  const normalized = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
  return normalized || "";
}

function routePathForDomain(domain) {
  const root = basePath();
  return domain ? `${root}/${encodeURIComponent(domain)}` : `${root || "/"}`;
}

function domainFromLocation() {
  const root = basePath();
  const pathname = window.location.pathname;
  const relativePath = root && pathname.startsWith(root) ? pathname.slice(root.length) : pathname;
  const segments = relativePath.split("/").filter(Boolean);

  if (segments.length !== 1) {
    return null;
  }

  return decodeURIComponent(segments[0]);
}

function syncRoute(domain, mode = "push") {
  const targetPath = routePathForDomain(domain);
  const currentPath = window.location.pathname;

  if (currentPath === targetPath) {
    return;
  }

  const method = mode === "replace" ? "replaceState" : "pushState";
  window.history[method]({}, "", targetPath);
}

function applyRouteState(domain) {
  state.detailDomain = domain;
  render();
}

function showDetailView(domain, routeMode = "push") {
  syncRoute(domain, routeMode);
  state.detailDomain = domain;
  render();
}

function hideDetailView(routeMode = "push") {
  syncRoute(null, routeMode);
  applyRouteState(null);
}

function restoreRouteState() {
  const routeDomain = domainFromLocation();
  const entry = state.entries.find((item) => item.domain === routeDomain);

  if (routeDomain && entry) {
    applyRouteState(routeDomain);
    return;
  }

  if (routeDomain) {
    syncRoute(null, "replace");
  }

  applyRouteState(null);
}

async function copyJson(button, iconNode, value, timerKey) {
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    button.dataset.copied = "true";
    setIconPath(iconNode, mdiCheck);

    if (timerKey === "index" && indexCopyResetTimer) {
      window.clearTimeout(indexCopyResetTimer);
    }
    if (timerKey === "manifest" && manifestCopyResetTimer) {
      window.clearTimeout(manifestCopyResetTimer);
    }

    const resetTimer = window.setTimeout(() => {
      button.dataset.copied = "false";
      setIconPath(iconNode, mdiContentCopy);
      if (timerKey === "index") {
        indexCopyResetTimer = null;
      } else {
        manifestCopyResetTimer = null;
      }
    }, 1500);

    if (timerKey === "index") {
      indexCopyResetTimer = resetTimer;
    } else {
      manifestCopyResetTimer = resetTimer;
    }
  } catch (error) {
    console.error(error);
    button.dataset.copied = "false";
    setIconPath(iconNode, mdiContentCopy);
  }
}

function handleManifestTrigger(event) {
  const button = event.target.closest("[data-manifest-domain]");
  if (button) {
    const entry = state.entries.find((item) => item.domain === button.dataset.manifestDomain);
    if (!entry || !entry.manifest) {
      return;
    }

    state.manifestEntry = entry;
    manifestDialogNode.showModal();
    renderManifestDialog(dom, state);
    return;
  }

  const detailButton = event.target.closest(".domain-button[data-domain]");
  if (detailButton) {
    showDetailView(detailButton.dataset.domain);
    return;
  }

  const relatedDomainButton = event.target.closest(".related-domain-button[data-domain]");
  if (relatedDomainButton) {
    showDetailView(relatedDomainButton.dataset.domain);
    return;
  }

  const previewImage = event.target.closest(".preview[data-domain]");
  if (previewImage) {
    showDetailView(previewImage.dataset.domain);
    return;
  }

  const tileCard = event.target.closest(".tile-panel[data-domain]");
  if (tileCard) {
    const domain = tileCard.dataset.domain;
    showDetailView(domain);
  }
}

indexCopyNode.addEventListener("click", () => {
  copyJson(indexCopyNode, indexCopyIconPath, JSON.stringify(state.index, null, 2), "index");
});

manifestCopyNode.addEventListener("click", () => {
  copyJson(
    manifestCopyNode,
    manifestCopyIconPath,
    state.manifestEntry ? JSON.stringify(state.manifestEntry.manifest, null, 2) : "",
    "manifest",
  );
});

function render() {
  renderApp(dom, state, {
    getCurrentPage,
    setCurrentPage,
    changePage: (page) => {
      setCurrentPage(page);
      render();
    },
  });
}

searchInput.addEventListener("input", () => {
  setCurrentPage(1);
  render();
});

tileViewButton.addEventListener("click", () => {
  if (state.view === "tile") {
    if (state.detailDomain) {
      hideDetailView();
    }
    return;
  }
  const currentPageSize = state.view === "content" ? 25 : 240;
  const firstVisibleIndex = (getCurrentPage() - 1) * currentPageSize;
  setView("tile");
  state.detailDomain = null;
  setCurrentPage(Math.floor(firstVisibleIndex / 240) + 1);
  render();
});

contentViewButton.addEventListener("click", () => {
  if (state.view === "content") {
    if (state.detailDomain) {
      hideDetailView();
    }
    return;
  }
  const currentPageSize = state.view === "content" ? 25 : 240;
  const firstVisibleIndex = (getCurrentPage() - 1) * currentPageSize;
  setView("content");
  state.detailDomain = null;
  setCurrentPage(Math.floor(firstVisibleIndex / 25) + 1);
  render();
});

rowsNode.addEventListener("click", handleManifestTrigger);
tileViewNode.addEventListener("click", handleManifestTrigger);
detailViewNode.addEventListener("click", handleManifestTrigger);

detailBackButton.addEventListener("click", () => {
  hideDetailView();
});

window.addEventListener("popstate", () => {
  restoreRouteState();
});

themeToggleButton.addEventListener("click", () => {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
});

indexMenuButton.addEventListener("click", () => {
  if (indexDialogNode.open) {
    indexDialogNode.close();
  } else {
    indexDialogNode.showModal();
    indexMenuButton.setAttribute("aria-expanded", "true");
  }
  renderIndexPanel(dom, state);
});

indexCloseNode.addEventListener("click", () => {
  indexDialogNode.close();
  renderIndexPanel(dom, state);
});

indexDialogNode.addEventListener("close", () => {
  if (indexCopyResetTimer) {
    window.clearTimeout(indexCopyResetTimer);
    indexCopyResetTimer = null;
  }
  indexCopyNode.dataset.copied = "false";
  setIconPath(indexCopyIconPath, mdiContentCopy);
  indexMenuButton.setAttribute("aria-expanded", "false");
  renderIndexPanel(dom, state);
});

manifestCloseNode.addEventListener("click", () => {
  manifestDialogNode.close();
  renderManifestDialog(dom, state);
});

manifestDialogNode.addEventListener("close", () => {
  if (manifestCopyResetTimer) {
    window.clearTimeout(manifestCopyResetTimer);
    manifestCopyResetTimer = null;
  }
  setIconPath(manifestCopyIconPath, mdiContentCopy);
  renderManifestDialog(dom, state);
});

setIconPath(indexIconPath, mdiFileDocumentOutline);
setIconPath(indexDownloadIconPath, mdiDownload);
setIconPath(indexCopyIconPath, mdiContentCopy);
setIconPath(githubIconPath, mdiGithub);
setIconPath(searchIconPath, mdiMagnify);
setIconPath(tileViewIconPath, mdiViewGridOutline);
setIconPath(contentViewIconPath, mdiTableLarge);
setIconPath(closeIconPath, mdiClose);
setIconPath(manifestCloseIconPath, mdiClose);
setIconPath(manifestDownloadIconPath, mdiDownload);
setIconPath(manifestCopyIconPath, mdiContentCopy);
setIconPath(backIconPath, mdiArrowLeft);
applyTheme(currentTheme());

loadCatalog()
  .then(({ index, entries }) => {
    state.index = index;
    state.entries = entries;
    indexDownloadNode.href = snapshotUrl("index.json");

    const tag = index.tag || "snapshot";
    tagNode.textContent = tag;
    footerTagNode.textContent = tag;
    exportedAtNode.textContent = index.exported_at || "unknown";
    searchInput.placeholder = searchPlaceholder(state.entries);
    searchInput.disabled = false;

    restoreRouteState();
  })
  .catch((error) => {
    state.error = error instanceof Error ? error.message : String(error);
    searchInput.disabled = true;
    render();
  });
