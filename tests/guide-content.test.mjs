/**
 * Keeps the User Guide (guide-content.js) honest:
 *   - Sinhala and Tamil cover exactly what the English does, task for
 *     task, with the same pictures;
 *   - every picture it names exists in guide/;
 *   - every on-screen label it quotes in **bold** is still on screen
 *     somewhere in the app, so a renamed button can't leave the guide
 *     pointing at nothing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { GUIDE_CONTENT, GUIDE_IMAGES, GUIDE_LANGUAGES } = require("../guide-content.js");
const root = new URL("../", import.meta.url);
const en = GUIDE_CONTENT.en;

const shape = (g) => ({
  ui: Object.keys(g.ui).sort(),
  toc: Object.keys(g.ui.toc).sort(),
  start: [g.start.steps.length, g.start.images],
  navigation: [g.navigation.image, g.navigation.items.length],
  roles: g.roles.map((r) => [r.role, r.tasks.map((t) => [t.images, t.steps.length])]),
  statuses: Object.keys(g.tickets.statuses).sort(),
  notes: g.tickets.notes.length,
  emails: g.emails.length,
  faq: g.faq.length
});

test("every language offered has a guide", () => {
  assert.deepEqual(GUIDE_LANGUAGES.map((l) => l.code).sort(), Object.keys(GUIDE_CONTENT).sort());
});

for (const code of Object.keys(GUIDE_CONTENT).filter((c) => c !== "en")) {
  test(`${code} guide matches the English one task for task`, () => {
    assert.deepEqual(shape(GUIDE_CONTENT[code]), shape(en));
  });
}

test("every picture the guide uses exists", () => {
  const used = new Set();
  for (const g of Object.values(GUIDE_CONTENT)) {
    g.start.images.forEach((i) => used.add(i));
    used.add(g.navigation.image);
    g.roles.forEach((r) => r.tasks.forEach((t) => t.images.forEach((i) => used.add(i))));
  }
  for (const name of used) {
    assert.ok(GUIDE_IMAGES[name], `unknown picture ${name}`);
    assert.ok(existsSync(new URL(GUIDE_IMAGES[name].src, root)), `missing file ${GUIDE_IMAGES[name].src}`);
  }
});

test("every bold label in the English guide is on screen in the app", () => {
  const screens =
    readFileSync(new URL("app.js", root), "utf8") +
    readdirSync(root).filter((f) => f.endsWith(".html")).map((f) => readFileSync(new URL(f, root), "utf8")).join("");
  const text = JSON.stringify(en);
  const labels = [...new Set([...text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]))]
    // Emphasis in the guide's own sentences rather than a screen label.
    .filter((l) => !/^(Create your account|Verify your email|Wait for approval|Sign in|First time in|Everyone|Customers|Technicians|Operators and the CEO|In reports|Who can move a ticket|Priority|Job type|below the lists)\b/.test(l))
    // The phone's own menus (adding the app to the home screen).
    .filter((l) => !["⋮", "Add to Home screen", "Install app", "Share", "Add to Home Screen"].includes(l));
  const missing = labels.filter((l) => !screens.includes(l.replace(/ → .*/, "")));
  assert.deepEqual(missing, []);
});

test("Sinhala and Tamil keep the on-screen labels in English", () => {
  const labels = (g) => new Set([...JSON.stringify(g.roles).matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]));
  const english = labels(en);
  for (const code of ["si", "ta"]) {
    const foreign = [...labels(GUIDE_CONTENT[code])].filter((l) => !english.has(l));
    assert.deepEqual(foreign, [], `${code} has bold labels the English guide doesn't`);
  }
});
