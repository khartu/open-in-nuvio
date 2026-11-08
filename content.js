// Open in Nuvio — adds an "Open in Nuvio" button on Letterboxd and IMDb title pages.
//
// Placement mirrors where the classic Stremio extensions put theirs:
//   • Letterboxd → first item of the right-hand action panel (ul.js-actions-panel)
//   • IMDb       → next to the "Add to Watchlist" split button in the hero
//
// Deep link contract (from Nuvio's DeepLinkParser / AppUrlBridge):
//   nuvio://meta?type=movie|series&id=tt0133093

(() => {
  const ID = "nuvio-open-btn";
  const ICON =
    globalThis.__NUVIO_ICON ||
    (() => {
      try {
        return chrome.runtime.getURL("icons/nuvio-mark.png");
      } catch {
        return "";
      }
    })();

  // Chrome can run this file once per matching content-script entry, so guard
  // against a second injection in the same document.
  if (window.__nuvioOpenInstalled) return;
  window.__nuvioOpenInstalled = true;

  let lastHref = "";

  /** Returns the IMDb id (tt0133093) present on the current page, or null. */
  function findImdbId() {
    const fromPath = location.pathname.match(/\/title\/(tt\d{6,})/);
    if (fromPath) return fromPath[1];

    // IMDb's own canonical/og:url reference — works even if the path is localised.
    for (const sel of ['link[rel="canonical"]', 'meta[property="og:url"]', 'meta[name="twitter:url"]']) {
      const v = document.querySelector(sel)?.getAttribute("href") ||
                document.querySelector(sel)?.getAttribute("content") || "";
      const m = v.match(/\/title\/(tt\d{6,})/);
      if (m) return m[1];
    }

    // Letterboxd film pages link out to IMDb ("View on IMDb" in the sidebar).
    const link = document.querySelector('a[href*="imdb.com/title/tt"]');
    if (link) {
      const m = link.getAttribute("href").match(/(tt\d{6,})/);
      if (m) return m[1];
    }

    for (const el of document.querySelectorAll("[data-imdb-id], [data-imdbid]")) {
      const v = el.getAttribute("data-imdb-id") || el.getAttribute("data-imdbid");
      const m = (v || "").match(/tt\d{6,}/);
      if (m) return m[0];
    }

    // Last resort: the whole document (Letterboxd puts the id in its JSON-LD / links).
    const m = document.documentElement.innerHTML.match(/\btt\d{7,8}\b/);
    return m ? m[0] : null;
  }

  /** "series" for TV shows, "movie" otherwise. */
  function findType() {
    if (/letterboxd\.com$/.test(location.hostname.replace(/^www\./, ""))) return "movie";

    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(s.textContent);
      } catch {
        continue;
      }
      for (const node of Array.isArray(data) ? data : [data]) {
        for (const item of node["@graph"] || [node]) {
          const t = String(item?.["@type"] || "");
          if (/TVSeries|TVSeason|TVEpisode|TVMiniSeries/i.test(t)) return "series";
          if (/^Movie$/i.test(t)) return "movie";
        }
      }
    }

    const og = document.querySelector('meta[property="og:type"]')?.content || "";
    if (/tv_show|tv_episode|video\.tv/i.test(og)) return "series";

    // IMDb: only series pages carry an /episodes/ nav link.
    if (document.querySelector('a[href*="/episodes"]')) return "series";

    // Localised IMDb UI: "Serie de TV", "TV-Serie", "Série", "Serie", "Série de TV"…
    const heroText = document.querySelector('[data-testid="hero__primary-text"], h1')?.textContent || "";
    if (/serie|series|tv|s[ée]rie|fernsehserie/i.test(heroText)) return "series";

    return "movie";
  }

  /** Rough light/dark detection so the button matches the host page. */
  function isDarkPage() {
    let el = document.body;
    let bg = "";
    while (el) {
      const c = getComputedStyle(el).backgroundColor || "";
      if (c && c !== "transparent" && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c)) {
        bg = c;
        break;
      }
      el = el.parentElement;
    }
    const m = bg.match(/(\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return false; // unknown → assume light, the default on both sites
    const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 10));
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
  }

  function buildButton(href, type, id) {
    if (!id) id = (href.match(/[?&]id=([^&]+)/) || [])[1] || "";
    if (!type) type = (href.match(/[?&]type=([^&]+)/) || [])[1] || "";
    const a = document.createElement("a");
    a.id = ID;
    a.className = "nuvio-btn";
    a.href = href; // real href = real user gesture, so Chrome lets the scheme through
    // Lets us recognise our own button even when the host page re-parents it
    // (or clones it into a different document/frame).
    a.dataset.nuvioBtn = "1";
    a.title = type && id ? `Open in Nuvio (${type} ${id})` : "Open in Nuvio";
    a.setAttribute("aria-label", id ? `Open ${id} in Nuvio` : "Open in Nuvio");
    a.dataset.nuvioTheme = isDarkPage() ? "dark" : "light";
    a.innerHTML =
      (ICON ? `<img class="nuvio-logo" src="${ICON}" alt="">` : "") +
      "<span>Open in Nuvio</span>";
    return a;
  }

  function rgbOf(css) {
    const m = css && css.match(/(\d+),\s*(\d+),\s*(\d+)/);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
  }

  /** Alpha channel of a computed colour, 1 when absent. */
  function alphaOf(css) {
    if (!css || css === "transparent") return 0;
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const parts = m[1].split(",").map((v) => parseFloat(v));
    return parts.length >= 4 ? parts[3] : 1;
  }

  /** First opaque background walking up from <body>. */
  function pageBgColor() {
    let el = document.body;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== "transparent" && alphaOf(bg) > 0.05) return rgbOf(bg);
      el = el.parentElement;
    }
    return [20, 24, 28];
  }

  /**
   * Copy the sidebar panel's own colours so the button looks native in any theme.
   * Only *painted* blocks qualify — a transparent wrapper would give the button no
   * fill at all, which is how it ended up with no visible box.
   */
  function mimicSidebarPanel(btn) {
    const page = pageBgColor();
    const candidates = [...document.querySelectorAll(".sidebar *")]
      .map((e) => ({ e, bg: getComputedStyle(e).backgroundColor }))
      .filter(({ e, bg }) => {
        // Never sample ourselves, and never sample an unpainted wrapper.
        if (e.closest(".nuvio-slot, .nuvio-item") || e.id === ID) return false;
        if (!bg || bg === "transparent" || alphaOf(bg) < 0.5) return false;
        const c = rgbOf(bg);
        if (!c) return false;
        const delta =
          Math.abs(c[0] - page[0]) + Math.abs(c[1] - page[1]) + Math.abs(c[2] - page[2]);
        const r = e.getBoundingClientRect();
        return delta > 12 && r.width > 100 && r.height > 20;
      });

    // Prefer the real action panel, and within it the biggest painted block —
    // that is the panel body whose swatch the rest of the UI uses.
    const area = ({ e }) => {
      const r = e.getBoundingClientRect();
      return r.width * r.height;
    };
    const inPanel = candidates.filter(({ e }) =>
      e.closest("ul.js-actions-panel, .watch-panel, .panel"),
    );
    const pool = inPanel.length ? inPanel : candidates;
    const ref = pool.sort((a, b) => area(b) - area(a))[0];
    if (!ref) return;

    const c = rgbOf(ref.bg);
    const cs = getComputedStyle(ref.e);
    const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const adj = (v) => Math.max(0, Math.min(255, Math.round(v + (lum < 0.5 ? 22 : -20))));

    btn.style.backgroundColor = ref.bg;
    btn.style.backgroundImage = "none";
    btn.style.border = `1px solid rgb(${adj(c[0])}, ${adj(c[1])}, ${adj(c[2])})`;
    if (cs.borderRadius && cs.borderRadius !== "0px") btn.style.borderRadius = cs.borderRadius;

    const textC = rgbOf(cs.color);
    const textDelta = textC
      ? Math.abs(textC[0] - c[0]) + Math.abs(textC[1] - c[1]) + Math.abs(textC[2] - c[2])
      : 0;
    btn.style.color =
      textC && textDelta > 40 ? cs.color : lum < 0.5 ? "#b9c7d2" : "#5a6673";

    // Safety net: never leave the button without a visible fill.
    const applied = getComputedStyle(btn).backgroundColor;
    if (!applied || applied === "transparent" || alphaOf(applied) < 0.5) {
      const dark = isDarkPage();
      btn.style.backgroundColor = dark ? "#2c3440" : "#ffffff";
      btn.style.border = dark ? "1px solid #3d4a57" : "1px solid #d5dbe1";
      btn.style.color = dark ? "#99aabb" : "#5a6673";
    }
  }

  /** Build the button node and put it in the right place for the current site. */
  function place(btn, type, id) {
    const isLetterboxd = /(^|\.)letterboxd\.com$/i.test(location.hostname);

    if (isLetterboxd) {
      btn.classList.add("nuvio-btn--lb");
      const sidebar = document.querySelector(".sidebar") || document.querySelector("aside");
      if (sidebar) {
        // The empty slot at the very top of the right column — above the
        // Watch / Like / Watchlist panel, where the Stremio extensions land.
        const host = document.createElement("div");
        host.className = "nuvio-slot";
        host.appendChild(btn);
        sidebar.insertBefore(host, sidebar.firstChild);
        scheduleMimic(btn);
        return true;
      }
      const panel = document.querySelector("ul.js-actions-panel");
      if (panel) {
        const li = document.createElement("li");
        li.className = "nuvio-item";
        li.appendChild(btn);
        panel.insertBefore(li, panel.firstChild);
        scheduleMimic(btn);
        return true;
      }
      return false;
    }

    // ---- IMDb (and anything else) ----
    // Primary target: the watchlist / watchlist-split button. The button goes
    // immediately before it, inside the same column, so it sits above
    // "Add to Watchlist" rather than floating in an unexpected place.
    const split = document.querySelector(
      '[data-testid="tm-box-wl-button"], [data-testid="tm-box-addtolist-button"]',
    );
    const wl = split?.closest(".ipc-split-button") || split;

    // Target: sit inside the small stack that holds the watchlist row — the container
    // that also carries the "set your services" link — so our button lands directly on
    // top of the yellow button instead of above a big block like RENT/BUY.
    // Climb from the watchlist button until the parent box is tall enough to contain
    // both it and its immediate previous sibling (i.e. it has more than one row).
    let container = null;
    let before = null;
    if (wl) {
      const wlBox = wl.getBoundingClientRect();
      let el = wl;
      for (let depth = 0; depth < 8 && el; depth++) {
        const parent = el.parentElement;
        if (!parent) break;
        const pBox = parent.getBoundingClientRect();
        const prev = el.previousElementSibling;

        // The parent must be a real stack (holds the row plus something above it),
        // yet not so tall that it swallows unrelated blocks.
        if (prev && parent.children.length >= 2 && pBox.height < wlBox.height * 5) {
          container = parent;
          before = el; // insert directly before the watchlist row
          break;
        }
        el = parent;
      }
      if (!container) {
        container = wl.parentElement?.parentElement || wl.parentElement;
        before = wl.parentElement || null;
      }
    }

    if (!container) {
      // IMDb moved/renamed the watchlist control: fall back to the hero title block
      // so the button is still reachable instead of silently vanishing.
      const hero = document.querySelector('[data-testid="hero__pageTitle"], h1');
      container = hero ? hero.closest("section") || hero.parentElement : null;
      before = null;
    }
    if (!container) {
      // Nothing on the page looks usable — last resort, a fixed pill like other
      // "open in app" extensions use. Never leave the user with no button at all.
      btn.classList.add("nuvio-btn--fallback");
      document.body.appendChild(btn);
      scheduleMimic(btn);
      return true;
    }

    const imdbBtn = buildImdbButton(type, id);
    const cs = getComputedStyle(container);
    const rows = /flex|grid/.test(cs.display) && /^row/.test(cs.flexDirection || "row");
    imdbBtn.classList.toggle("nuvio-btn--imdb-stacked", !rows);

    container.insertBefore(imdbBtn, before); // null `before` appends to the end
    mimicImdbButton(imdbBtn);
    scheduleMimic(imdbBtn);
    // The watchlist row can render a beat later; re-fit a few times.
    [300, 900, 2000].forEach((t) => setTimeout(() => mimicImdbButton(imdbBtn), t));
    return true;
  }

  function buildImdbButton(type, id) {
    const btn = buildButton(
      `nuvio://meta?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`,
      type,
      id,
    );
    btn.classList.add("nuvio-btn--imdb");
    return btn;
  }

  /**
   * Copy the watchlist button's own geometry so ours reads as part of the same
   * stack: same height, padding, font, and border-radius (IMDb uses a 24px pill).
   */
  function mimicImdbButton(btn) {
    const ref =
      document.querySelector('[data-testid="tm-box-wl-button"]') ||
      document.querySelector(".ipc-split-button__btn");
    if (!ref) return;

    const cs = getComputedStyle(ref);
    const r = ref.getBoundingClientRect();
    if (r.height > 0) btn.style.height = `${Math.round(r.height)}px`;
    if (cs.borderRadius && cs.borderRadius !== "0px") {
      // A split button is rounded on the left only; ours is standalone, so give it
      // the full pill using the largest corner value.
      const radii = cs.borderRadius.split(/\s+/).map((v) => parseFloat(v) || 0);
      const maxRadius = Math.max(...radii);
      btn.style.borderRadius = maxRadius ? `${maxRadius}px` : cs.borderRadius;
    }
    if (cs.fontFamily) btn.style.font = cs.font;
    if (cs.paddingLeft) btn.style.paddingLeft = cs.paddingLeft;
    if (cs.paddingRight) btn.style.paddingRight = cs.paddingRight;
  }

  /**
   * The sidebar panel is a client-side include: it can arrive after us, and the
   * host may re-render it later. Re-sample its colours a few times so the button
   * settles into the final theme instead of keeping the early fallback.
   */
  function scheduleMimic(btn, tries = 8) {
    if (!btn.isConnected) return;
    mimicSidebarPanel(btn);
    if (tries > 0) setTimeout(() => scheduleMimic(btn, tries - 1), 500);
  }

  /** Our injected button, wherever the host page has moved it. */
  function findOwnButton() {
    return document.getElementById(ID) || document.querySelector('[data-nuvio-btn="1"]');
  }

  function removeButton() {
    document
      .querySelectorAll(".nuvio-slot, .nuvio-item")
      .forEach((n) => n.remove());
    document.querySelectorAll(`#${ID}`).forEach((n) => n.remove());
  }

  function render() {
    let id = null;
    try {
      id = findImdbId();
    } catch {
      return; // opaque/cross-origin frame — nothing to inject here
    }
    const existing = findOwnButton();

    if (!id) {
      if (existing) (existing.closest(".nuvio-slot") || existing.closest(".nuvio-item") || existing).remove();
      return;
    }

    let type = "movie";
    try {
      type = findType();
    } catch {
      /* keep the default */
    }
    const href = `nuvio://meta?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;

    if (existing && existing.getAttribute("href") === href) {
      // Same title. If the host re-rendered the sidebar our wrapper may be gone,
      // but then `existing` would be detached too — re-place it.
      if (!existing.isConnected) {
        const wrap = existing.closest(".nuvio-slot") || existing.closest(".nuvio-item") || existing;
        wrap.remove();
        place(buildButton(href, type, id), type, id);
      }
      return;
    }

    if (existing) (existing.closest(".nuvio-slot") || existing.closest(".nuvio-item") || existing).remove();
    place(buildButton(href, type, id), type, id);
  }

  let lastRenderAt = 0;
  function renderSoon() {
    const now = Date.now();
    if (now - lastRenderAt < 250) return; // avoid thrashing against the host's own re-renders
    lastRenderAt = now;
    render();
  }

  function tick() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      removeButton();
    }
    if (!document.getElementById(ID)) render();
  }

  // Seed lastHref *before* the first render, otherwise the first tick looks like a
  // navigation and wipes the button we just added (it flashed out on load).
  lastHref = location.href;
  render();

  new MutationObserver(() => {
    if (!document.getElementById(ID)) renderSoon();
  }).observe(document.body, { childList: true, subtree: true });

  setInterval(tick, 700);
})();
