/**
 * Vite dev server のページをスクリーンショット撮影する。
 * WebGL を描画するため GPU アクセラレーション付きで起動。
 * Usage: npx tsx screenshot.ts [url] [output]
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/';
const output = process.argv[3] || 'screenshot.png';

(async () => {
  const browser = await chromium.launch({
    args: [
      '--enable-webgl',
      '--enable-gpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  // Wait for WebGL render to settle
  await page.waitForTimeout(4000);
  await page.screenshot({ path: output, fullPage: false });
  await browser.close();
  console.log(`Screenshot saved: ${output}`);
})();
