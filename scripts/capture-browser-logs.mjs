import puppeteer from 'puppeteer-core';

const URL = 'http://localhost:4173/deckglraster-multiband/';
const CHROME_PATH = '/usr/bin/google-chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

try {
  const page = await browser.newPage();
  const logs = [];

  page.on('console', async (msg) => {
    const vals = [];
    for (const arg of msg.args()) {
      try {
        vals.push(await arg.jsonValue());
      } catch {
        vals.push(String(arg));
      }
    }
    logs.push({
      kind: 'console',
      type: msg.type(),
      text: msg.text(),
      values: vals,
      location: msg.location()
    });
  });

  page.on('pageerror', (err) => {
    logs.push({
      kind: 'pageerror',
      message: err?.message || String(err),
      stack: err?.stack || null
    });
  });

  page.on('requestfailed', (req) => {
    logs.push({
      kind: 'requestfailed',
      url: req.url(),
      method: req.method(),
      failure: req.failure()?.errorText || 'unknown'
    });
  });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(12000);

  // Trigger a couple interactions to surface runtime issues.
  await page.evaluate(async () => {
    const select = document.getElementById('layers');
    if (select && select.options.length > 1) {
      select.selectedIndex = 1;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      select.selectedIndex = 0;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  await sleep(4000);

  console.log(JSON.stringify({
    url: URL,
    capturedAt: new Date().toISOString(),
    count: logs.length,
    logs
  }, null, 2));
} finally {
  await browser.close();
}
