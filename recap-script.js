// Post-deploy multi-device recapture — guest state
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://festie.us';
const ROUTES = ['/', '/picks', '/crew', '/grid', '/cards', '/timeline'];
const DEVICES = [
  { name: 'iphone-se',        dev: { ...devices['iPhone SE'],        viewport: { width: 320, height: 568 } } },
  { name: 'iphone-14',        dev: { ...devices['iPhone 14'],        viewport: { width: 390, height: 664 } } },
  { name: 'iphone-14-pro-max',dev: { ...devices['iPhone 14 Pro Max'],viewport: { width: 428, height: 740 } } },
  { name: 'pixel-7',          dev: { ...devices['Pixel 7'],          viewport: { width: 412, height: 839 } } },
];

const OUT = process.argv[2] || '/tmp/recap-out';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const metrics = {};
  for (const d of DEVICES) {
    metrics[d.name] = {};
    const ctx = await browser.newContext(d.dev);
    const page = await ctx.newPage();
    const devDir = path.join(OUT, d.name);
    fs.mkdirSync(devDir, { recursive: true });
    for (const r of ROUTES) {
      const slug = r === '/' ? 'home' : r.slice(1);
      try {
        await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(devDir, slug + '-viewport.png'), fullPage: false });
        await page.screenshot({ path: path.join(devDir, slug + '-fullpage.png'), fullPage: true });
        const m = await page.evaluate(() => {
          const rect = (el) => el ? { w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, top: el.getBoundingClientRect().top } : null;
          const cb = document.querySelector('.cookie-banner');
          const bn = document.querySelector('.bottom-nav');
          const gt = document.querySelector('.guest-teaser');
          const cbr = cb?.getBoundingClientRect();
          const bnr = bn?.getBoundingClientRect();
          return {
            view: document.body.dataset.view || (location.pathname.slice(1) || 'home'),
            viewportH: window.innerHeight,
            cookieBanner: rect(cb),
            bottomNav: rect(bn),
            guestTeaser: rect(gt),
            cookieCoversNav: (cb && bn && cbr && bnr) ? (cbr.bottom > bnr.top && cbr.top < bnr.bottom) : false,
          };
        });
        metrics[d.name][slug] = m;
      } catch (e) {
        metrics[d.name][slug] = { error: e.message };
      }
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log('DONE');
})();
