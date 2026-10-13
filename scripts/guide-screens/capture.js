/**
 * Photographs the app for the User Guide (help.html), with made-up sample
 * data from mock-supabase.js - no real account or database is touched.
 *
 *   npm install --no-save puppeteer-core
 *   node scripts/guide-screens/capture.js            # writes guide/*.webp
 *   node scripts/guide-screens/capture.js --survey   # whole pages, to look at
 *
 * Needs Google Chrome (or set CHROME_PATH). Re-run after changing a screen
 * the guide shows, and commit the new images.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const puppeteer = require("puppeteer-core");
const shots = require("./shots");

const root = path.join(__dirname, "..", "..");
const outDir = path.join(root, "guide");
const survey = process.argv.includes("--survey");
const surveyDir = process.env.SURVEY_DIR || path.join(root, "guide-survey");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const mock = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");
const chromePath =
  process.env.CHROME_PATH ||
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"]
    .find((p) => fs.existsSync(p));

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".webp": "image/webp" };

// The site as Vercel serves it: clean URLs, everything from the repo root.
function serve() {
  const server = http.createServer((req, res) => {
    let file = decodeURIComponent(req.url.split(/[?#]/)[0]);
    if (file === "/") file = "/login";
    if (!path.extname(file)) file += ".html";
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full)) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": types[path.extname(full)] || "application/octet-stream" });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// Used by shots' prepare(): act on the page the way a person would.
function helpers(page) {
  return {
    async click(text, scope) {
      const ok = await page.evaluate((text, scope) => {
        const root = (scope && document.querySelector(scope)) || document;
        const el = [...root.querySelectorAll("button, a, summary, label")]
          .find((e) => e.offsetParent !== null && e.textContent.replace(/\s+/g, " ").trim().includes(text));
        if (el) el.click();
        return Boolean(el);
      }, text, scope);
      if (!ok) throw new Error(`nothing to click labelled "${text}"`);
      await new Promise((r) => setTimeout(r, 400));
    },
    async fill(selector, value) {
      await page.$eval(selector, (el, value) => {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
    }
  };
}

(async () => {
  if (!chromePath) throw new Error("Chrome not found - set CHROME_PATH.");
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
  fs.mkdirSync(survey ? surveyDir : outDir, { recursive: true });

  for (const shot of shots.filter((s) => !only || only.includes(s.name))) {
    const page = await browser.newPage();
    await page.setViewport({ width: shot.width || 1280, height: shot.height || 900, deviceScaleFactor: shot.scale || 1 });
    await page.evaluateOnNewDocument((role) => {
      window.__MOCK_ROLE = role;
      // Skip the welcome tour.
      const getItem = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) {
        return String(key).startsWith("absl-welcome-tour") ? "1" : getItem.call(this, key);
      };
    }, shot.role || "customer");
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (/\/vendor\/supabase-js[^/]*\.js$/.test(url)) return req.respond({ contentType: "text/javascript", body: mock });
      if (url.endsWith("/config.js")) return req.respond({ contentType: "text/javascript", body: 'window.ABSL_SUPABASE = { url: "https://sample.supabase.co", anonKey: "sample" };' });
      if (url.startsWith(base) || url.startsWith("data:") || /fonts\.(googleapis|gstatic)\.com/.test(url)) return req.continue();
      return req.abort();
    });
    page.on("pageerror", (err) => console.error(`  [${shot.name}] page error: ${err.message}`));

    await page.goto(base + shot.path, { waitUntil: "networkidle0" });
    await page.addStyleTag({
      content: `.guide-mark { outline: 3px solid #ef4444 !important; outline-offset: 3px; border-radius: 8px; }
                .toast, .toast-container, #toastContainer { display: none !important; }
                /* show a whole form, not just what fits on screen */
                .modal-overlay.is-visible { position: absolute !important; min-height: 100%; }
                #modalCard { max-height: none !important; overflow: visible !important; }
                *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }`
    });
    if (shot.prepare) await shot.prepare(page, helpers(page));
    await new Promise((r) => setTimeout(r, 250));

    if (survey) {
      const file = path.join(surveyDir, `${shot.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log("survey", file);
    } else {
      // shot.panel: crop to the card whose heading starts with this text.
      if (shot.panel) {
        const found = await page.evaluate((text) => {
          const heading = [...document.querySelectorAll("h1, h2, h3")].find((h) => h.textContent.trim().startsWith(text));
          const card = heading && (heading.closest(".panel, .modal-card, .auth-card") || heading.parentElement);
          if (card) card.setAttribute("data-guide-clip", "");
          return Boolean(card);
        }, shot.panel);
        if (!found) throw new Error(`${shot.name}: no card headed "${shot.panel}"`);
      }
      // shot.section: crop to one part of a card, from its heading down to
      // the next heading in the same card.
      let sectionClip = null;
      if (shot.section) {
        sectionClip = await page.evaluate((text) => {
          const headings = [...document.querySelectorAll("h2, h3, h4")];
          const heading = headings.find((h) => h.textContent.trim().startsWith(text));
          if (!heading) return null;
          const card = heading.closest(".panel") || heading.parentElement;
          const next = headings.find((h) => h !== heading && card.contains(h) &&
            (heading.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING));
          const box = card.getBoundingClientRect();
          const top = heading.getBoundingClientRect().top - 12;
          const bottom = next ? next.getBoundingClientRect().top - 8 : box.bottom;
          return { x: box.left + window.scrollX, y: top + window.scrollY, width: box.width, height: bottom - top };
        }, shot.section);
        if (!sectionClip) throw new Error(`${shot.name}: no heading "${shot.section}"`);
      }
      for (const mark of shot.mark || []) {
        await page.$$eval(mark, (els) => els.forEach((el) => el.classList.add("guide-mark")));
      }
      for (const text of shot.markText || []) {
        const marked = await page.evaluate((text, scope) => {
          const root = (scope && document.querySelector(scope)) || document;
          const el = [...root.querySelectorAll("button, a, label, summary, .stat-card, select, input[type=file]")]
            .find((e) => e.offsetParent !== null && e.textContent.replace(/\s+/g, " ").trim().includes(text));
          if (el) el.classList.add("guide-mark");
          return Boolean(el);
        }, text, shot.panel ? "[data-guide-clip]" : shot.clip || shot.markScope);
        if (!marked) throw new Error(`${shot.name}: nothing to mark labelled "${text}"`);
      }
      const file = path.join(outDir, `${shot.name}.webp`);
      const selector = shot.panel ? "[data-guide-clip]" : shot.clip;
      const target = selector ? await page.$(selector) : null;
      if (selector && !target) throw new Error(`${shot.name}: nothing matches ${selector}`);
      if (shot.top) await page.screenshot({ path: file, type: "webp", quality: 82, clip: { x: 0, y: 0, width: shot.width || 1280, height: shot.top } });
      else if (sectionClip) await page.screenshot({ path: file, type: "webp", quality: 82, clip: sectionClip, captureBeyondViewport: true });
      else await (target || page).screenshot({ path: file, type: "webp", quality: 82, ...(target ? { captureBeyondViewport: true } : {}) });
      console.log(`${shot.name}.webp  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    }
    await page.close();
  }

  await browser.close();
  server.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
