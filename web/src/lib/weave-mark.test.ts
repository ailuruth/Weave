import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

test("the mark in the top bar is drawn exactly as the app icon is", () => {
  const icon = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");
  const component = readFileSync(new URL("../components/weave-mark.tsx", import.meta.url), "utf8");
  const paths = (text: string) => [...text.matchAll(/d="([^"]+)" stroke="(#[0-9A-F]{6})"/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.equal(paths(icon).length, 4);
  assert.deepEqual(paths(component), paths(icon));
  assert.match(icon, /stroke-width="7"/);
  assert.match(component, /strokeWidth="7"/);
});
