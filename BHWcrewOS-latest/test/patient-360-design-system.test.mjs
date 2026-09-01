import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provider = path.join(root, "provider");

test("Patient 360 uses the Opal and Ironstone palette and typography", () => {
  const css = fs.readFileSync(path.join(provider, "patient-360.css"), "utf8");
  assert.match(css, /--paper:#F8F6F1/);
  assert.match(css, /--card:#FEFDFB/);
  assert.match(css, /--sidebar:#0F2230/);
  assert.match(css, /--serif:"Playfair Display"/);
  assert.match(css, /--text-base:1rem/);
  assert.match(css, /Opal & Ironstone typography: 16px reading base, 14px dense UI, 13px metadata/);
  assert.match(css, /\.nav,\.btn,\.page-nav a/);
  assert.match(css, /font-size:var\(--text-sm\)/);
});

test("every Patient 360 page loads the design-system font families", () => {
  const pages = fs.readdirSync(provider).filter((name) => /^patient-360(?:-[a-z]+)?\.html$/.test(name));
  assert.equal(pages.length, 8);
  for (const page of pages) {
    const html = fs.readFileSync(path.join(provider, page), "utf8");
    assert.match(html, /family=Playfair\+Display/);
    assert.match(html, /family=Montserrat/);
    assert.doesNotMatch(html, /Cormorant\+Garamond/);
  }
});

test("Patient 360 does not display the body-outline explanation", () => {
  const app = fs.readFileSync(path.join(provider, "patient-360-app.mjs"), "utf8");
  assert.doesNotMatch(app, /Gender is not specified or they\/them pronouns are selected/);
  assert.doesNotMatch(app, /body-outline-note/);
});
