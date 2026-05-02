#!/usr/bin/env node
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3003';
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR ?? path.join(process.cwd(), 'screenshots');
const fixturesDir = path.join(__dirname, '..', 'e2e', 'fixtures');

const NIXOS_CHROMIUM = '/run/current-system/sw/bin/chromium';
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync(NIXOS_CHROMIUM) ? NIXOS_CHROMIUM : undefined);

mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function uploadTwoTracks(page) {
  await page.locator('#track').setInputFiles(path.join(fixturesDir, 'track1.gpx'));
  await page.waitForFunction(() => document.querySelectorAll('.delete-button').length >= 1, null, { timeout: 5000 });
  await page.locator('#track').setInputFiles(path.join(fixturesDir, 'track2.gpx'));
  await page.waitForFunction(() => document.querySelectorAll('.delete-button').length >= 2, null, { timeout: 5000 });
  await page.waitForTimeout(800);
}

const captures = [
  {
    name: '01-empty-desktop',
    viewport: { width: 1280, height: 900 },
    async setup(page) {
      // no tracks — just navigate
    },
  },
  {
    name: '02-two-tracks-desktop',
    viewport: { width: 1280, height: 900 },
    setup: uploadTwoTracks,
  },
  {
    name: '03-two-tracks-mobile',
    viewport: { width: 390, height: 844 },
    contextOptions: { deviceScaleFactor: 3, isMobile: true },
    setup: uploadTwoTracks,
  },
];

const browser = await chromium.launch({
  executablePath: chromiumExecutable,
  args: ['--no-sandbox'],
  headless: true,
});

let failed = false;
for (const capture of captures) {
  const contextOptions = {
    viewport: capture.viewport,
    ...capture.contextOptions,
  };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  try {
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await capture.setup(page);
    const dest = path.join(SCREENSHOTS_DIR, `${capture.name}.png`);
    await page.screenshot({ path: dest, fullPage: true });
    console.log(`Saved ${dest}`);
  } catch (err) {
    console.error(`FAILED ${capture.name}: ${err.message}`);
    failed = true;
  } finally {
    await context.close();
  }
}

await browser.close();
if (failed) process.exit(1);
