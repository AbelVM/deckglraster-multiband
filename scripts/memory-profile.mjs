import puppeteer from 'puppeteer-core';

const CHROME_PATH = '/usr/bin/google-chrome';
const URL = 'http://localhost:4173/deckglraster-multiband/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mb(n) {
  return Number((n / (1024 * 1024)).toFixed(2));
}

async function sample(page, client, label) {
  const heap = await page.evaluate(() => {
    const m = globalThis.performance && performance.memory;
    if (!m) return null;
    return {
      usedJSHeapSize: m.usedJSHeapSize,
      totalJSHeapSize: m.totalJSHeapSize,
      jsHeapSizeLimit: m.jsHeapSizeLimit
    };
  });

  const heapUsage = await client.send('Runtime.getHeapUsage').catch(() => null);
  const dom = await client.send('Memory.getDOMCounters').catch(() => null);

  return {
    label,
    perfMemory: heap
      ? {
          usedMB: mb(heap.usedJSHeapSize),
          totalMB: mb(heap.totalJSHeapSize),
          limitMB: mb(heap.jsHeapSizeLimit)
        }
      : null,
    runtimeHeap: heapUsage
      ? {
          usedMB: mb(heapUsage.usedSize),
          totalMB: mb(heapUsage.totalSize)
        }
      : null,
    domCounters: dom || null
  };
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-precise-memory-info'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1365, height: 768 });

    const client = await page.target().createCDPSession();
    await client.send('Performance.enable');

    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
    await sleep(7000);

    const samples = [];
    samples.push(await sample(page, client, 'baseline'));

    await page.evaluate(async () => {
      const select = document.getElementById('layers');
      if (!select) return;
      const opts = [...select.options].map((o) => o.value).filter(Boolean);
      if (opts.length === 0) return;

      for (let i = 0; i < 30; i++) {
        select.value = opts[i % opts.length];
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 150));
      }
    });

    await sleep(5000);
    samples.push(await sample(page, client, 'after-style-switch-stress'));

    await client.send('HeapProfiler.enable').catch(() => {});
    await client.send('HeapProfiler.collectGarbage').catch(() => {});
    await sleep(2000);
    samples.push(await sample(page, client, 'after-forced-gc'));

    console.log(JSON.stringify({
      url: URL,
      timestamp: new Date().toISOString(),
      samples
    }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error('MEMORY_PROFILE_FAILED');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
