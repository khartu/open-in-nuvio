// Paste in the DevTools console on the IMDb page, then paste back what it prints.
// Answers one question: does THIS extension run in THIS document at all?
(() => {
  const out = {
    is_top_frame: window.top === window,
    url: location.href.slice(0, 80),
    origin: location.origin,
  };

  // Our own injected marker (current build writes data-nuvio-btn; older ones only the id).
  const byId = document.getElementById("nuvio-open-btn");
  const byAttr = document.querySelector('[data-nuvio-btn="1"]');
  const btn = byId || byAttr;
  out.button_found = !!btn;
  out.button_where = (() => {
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })();

  // Is nuvio.css applied in this document?
  const probe = document.createElement("a");
  probe.className = "nuvio-btn";
  document.body.appendChild(probe);
  out.css_loaded = getComputedStyle(probe).display === "flex";
  probe.remove();

  // Which placement anchors exist here?
  out.anchors = {
    watchlist_btn: !!document.querySelector('[data-testid="tm-box-wl-button"]'),
    split_button: !!document.querySelector(".ipc-split-button"),
    hero_title: !!document.querySelector('[data-testid="hero__pageTitle"]'),
    any_h1: !!document.querySelector("h1"),
  };

  // Can the extension find an id here?
  const re = /\/title\/(tt\d{6,})/;
  out.ids = {
    path: (location.pathname.match(re) || [])[1] || null,
    canonical: (document.querySelector('link[rel="canonical"]')?.href || "").match(re)?.[1] || null,
    og_url: (document.querySelector('meta[property="og:url"]')?.content || "").match(re)?.[1] || null,
    imdb_link: (document.querySelector('a[href*="imdb.com/title/tt"]')?.href || "").match(/(tt\d{6,})/)?.[1] || null,
  };

  // Content scripts live in an isolated world: the page itself must never see our
  // attributes on a page-owned element, and our button is invisible to page JS only
  // when the host replaced it. This flag tells the two apart.
  out.notes = "css_loaded=false → extension not running in this document; button_found=false + css_loaded=true → it runs but bailed out (check ids/anchors).";

  const text = JSON.stringify(out, null, 2);
  console.log(text);
  copy(text);
  return out;
})();
