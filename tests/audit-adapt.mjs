// Adaptation audit: loads every route across phone, phone-landscape, tablet,
// laptop, desktop, and 4K viewports and flags page-level horizontal overflow,
// off-screen elements, sub-44px tap targets, sub-16px form inputs on touch
// (iOS auto-zoom), and clipped text. Content inside a closed <details> is
// skipped because Chromium reports stale rects for it.
//
// Usage: start the dev server, then run `node tests/audit-adapt.mjs`
// (point it elsewhere with SMOKE_BASE_URL=https://...).
import { chromium } from "playwright";

const base = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const routes = ["/", "/how-it-works", "/scenarios", "/resources", "/faq", "/contact", "/auth", "/history", "/monitoring", "/terms", "/privacy", "/interview"];
const viewports = [
  { name: "320", w: 320, h: 640, touch: true },
  { name: "360", w: 360, h: 800, touch: true },
  { name: "390", w: 390, h: 844, touch: true },
  { name: "414", w: 414, h: 896, touch: true },
  { name: "landscape-844", w: 844, h: 390, touch: true },
  { name: "tablet-768", w: 768, h: 1024, touch: true },
  { name: "laptop-1024", w: 1024, h: 768, touch: false },
  { name: "desktop-1440", w: 1440, h: 900, touch: false },
  { name: "4k-2560", w: 2560, h: 1440, touch: false },
];

const browser = await chromium.launch({ headless: true, channel: "chromium" });
const report = [];

for (const route of routes) {
  for (const vp of viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, hasTouch: vp.touch, isMobile: vp.touch });
    const page = await ctx.newPage();
    let status = 0;
    try {
      const resp = await page.goto(base + route, { waitUntil: "domcontentloaded", timeout: 30000 });
      status = resp ? resp.status() : 0;
      await page.waitForTimeout(500);
      const data = await page.evaluate(() => {
        const cw = document.documentElement.clientWidth;
        const overflow = document.documentElement.scrollWidth - cw;

        const offscreen = [];
        const smallTargets = [];
        const smallInputs = [];
        const seenSmall = new Set();

        const all = document.querySelectorAll("body *");
        for (const el of all) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
          // Content inside a closed <details> keeps a stale rect in Chromium.
          if (el.closest("details:not([open])")) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.bottom < -1000 || r.top > 20000) continue;
          // offscreen horizontally (allow 1px)
          if (r.right > cw + 1 || r.left < -1) {
            const fixed = cs.position === "fixed";
            offscreen.push({
              sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""),
              left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), fixed,
            });
          }
          // tap targets
          const interactive = el.matches("a[href], button, input:not([type=hidden]), select, textarea, [role=button], summary");
          if (interactive) {
            if (r.width < 44 || r.height < 44) {
              const key = el.tagName + (el.className || "") + Math.round(r.width) + "x" + Math.round(r.height);
              if (!seenSmall.has(key)) {
                seenSmall.add(key);
                smallTargets.push({
                  sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""),
                  w: Math.round(r.width), h: Math.round(r.height),
                  text: (el.textContent || "").trim().slice(0, 24),
                });
              }
            }
          }
          if (el.matches("input, select, textarea, .answer-dock input, .editor-textarea, .component-answer")) {
            const fs = parseFloat(cs.fontSize);
            if (fs < 16) smallInputs.push({ sel: el.tagName.toLowerCase(), fs, cls: (el.className || "").toString().slice(0, 40) });
          }
        }
        // dedupe offscreen by sel
        const offMap = new Map();
        for (const o of offscreen) { const k = o.sel + o.left + o.right; if (!offMap.has(k)) offMap.set(k, o); }
        // text that overflows its own box (clipped words) — image-free check
        const textOverflow = [];
        const seenText = new Set();
        for (const el of all) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const tag = el.tagName.toLowerCase();
          if (!["h1", "h2", "h3", "p", "span", "strong", "li", "a", "label", "td", "th"].includes(tag)) continue;
          if (["auto", "scroll", "hidden"].includes(cs.overflowX)) continue;
          if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
            const key = tag + (typeof el.className === "string" ? el.className : "") + el.scrollWidth;
            if (seenText.has(key)) continue;
            seenText.add(key);
            textOverflow.push({ sel: tag + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""), cw: el.clientWidth, sw: el.scrollWidth, text: (el.textContent || "").trim().slice(0, 30) });
          }
        }
        const navLinksEl = document.querySelector(".nav-links");
        const navMenuEl = document.querySelector(".nav-menu");
        const navState = navMenuEl
          ? (getComputedStyle(navMenuEl).display !== "none" ? "menu" : (navLinksEl && getComputedStyle(navLinksEl).display !== "none" ? "links" : "none"))
          : null;
        return {
          overflow,
          navState,
          offscreen: [...offMap.values()].slice(0, 8),
          smallTargets: smallTargets.slice(0, 12),
          smallInputs,
          textOverflow: textOverflow.slice(0, 8),
        };
      });
      report.push({ route, vp: vp.name, touch: vp.touch, status, ...data });
    } catch (e) {
      report.push({ route, vp: vp.name, status, error: String(e).slice(0, 120) });
    }
    await ctx.close();
  }
}

await browser.close();

for (const r of report) {
  const flags = [];
  if (r.error) flags.push("ERROR:" + r.error);
  if (r.overflow > 1) flags.push(`OVERFLOW +${r.overflow}px`);
  if (r.offscreen?.length) flags.push("OFFSCREEN:" + r.offscreen.map((o) => `${o.sel}[${o.left}..${o.right}]`).join(", "));
  if (r.smallTargets?.length) flags.push("SMALL:" + r.smallTargets.map((t) => `${t.sel}(${t.w}x${t.h})`).join(", "));
  if (r.touch && r.smallInputs?.length) flags.push("INPUT<16:" + [...new Set(r.smallInputs.map((i) => i.cls || i.sel))].join(", "));
  if (r.textOverflow?.length) flags.push("TEXT-CLIP:" + r.textOverflow.map((t) => `${t.sel}[${t.cw}<${t.sw}]"${t.text}"`).join(", "));
  if (flags.length) console.log(`${r.route} @${r.vp} [${r.status}] ${flags.join(" | ")}`);
  if (r.navState && r.navState !== "links") console.log(`${r.route} @${r.vp} nav=${r.navState}`);
}
console.log("\ndone", report.length, "combos");
