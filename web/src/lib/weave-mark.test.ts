import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";

const SPEAKERS = ["#E5E517", "#17E517", "#17E5E5", "#E517E5"];

test("the mark in the studio is drawn exactly as the app icon is", () => {
  const icon = readFileSync(new URL("../app/icon.svg", import.meta.url), "utf8");
  const component = readFileSync(new URL("../components/weave-mark.tsx", import.meta.url), "utf8");
  const shapes = (text: string) => [...text.matchAll(/<(rect|path)\b([^>]*?)\/?>/g)].map((m) => {
    const attr = (name: string) => m[2].match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
    return `${m[1]} ${attr("width")} ${attr("height")} ${attr("rx")} ${attr("d")} ${attr("fill")}`;
  });
  const drawn = shapes(icon);
  assert.equal(drawn.length, 5);
  assert.deepEqual(shapes(component), drawn);
  assert.equal(drawn[0], "rect 64 64 14  #000000");
  assert.deepEqual(drawn.slice(1).map((s) => s.split(" ").at(-1)), SPEAKERS);
});
