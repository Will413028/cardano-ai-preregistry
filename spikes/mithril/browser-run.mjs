// Throwaway spike: drive the built page in Chromium, cold and with the certificate cache warm.
import { chromium } from "@playwright/test";
import { preview } from "vite";

const server = await preview({ configFile: "vite.config.mjs", preview: { port: 4179, host: "127.0.0.1" } });
const base = "http://127.0.0.1:4179/";
const tx = process.argv[2];
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const failed = [];
page.on("requestfailed", (r) => failed.push(r.url()));
async function run(q) {
  await page.goto(`${base}?tx=${tx}${q}`);
  await page.waitForSelector("#out[data-done]", { timeout: 300000 });
  return page.textContent("#out");
}
console.log("cold", await run(""));
console.log("cache-1", await run("&cache=1"));
console.log("cache-2", await run("&cache=1"));
console.log("localStorage keys", await page.evaluate(() => Object.keys(localStorage).length));
console.log("failed", failed);
await browser.close();
await server.close();
