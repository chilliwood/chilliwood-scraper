const chromium = require('chrome-aws-lambda');
const puppeteerCore = require('puppeteer-core');

async function getBrowser() {
  return puppeteerCore.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless
  });
}

// Search Google for CHW code and extract post URL
async function findPostUrl(page, code, platform) {
  const query = `site:${platform}.com "${code}"`;
  await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
    waitUntil: 'networkidle2', timeout: 20000
  });
  await page.waitForTimeout(2000);

  const url = await page.evaluate((site) => {
    const links = document.querySelectorAll('a');
    for (const link of links) {
      const href = link.href || '';
      if (href.includes(site + '.com') && (
        href.includes('/p/') || href.includes('/reel/') || 
        href.includes('/video/') || href.includes('/@')
      )) {
        return href;
      }
    }
    return null;
  }, platform);

  return url;
}

async function scrapeInstagram(browser, code) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
  try {
    const postUrl = await findPostUrl(page, code, 'instagram');
    if (!postUrl) return null;

    await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForTimeout(3000);

    const metrics = await page.evaluate(() => {
      const text = document.body.innerText;
      const parseNum = s => parseInt((s||'0').replace(/[^\d]/g,'')) || 0;
      const likesM = text.match(/([\d,\.]+)\s*(Me gusta|likes)/i);
      const commentsM = text.match(/([\d,\.]+)\s*(comentarios?|comments?)/i);
      const viewsM = text.match(/([\d,\.]+)\s*(reproducciones|visualizaciones|views)/i);
      return {
        likes: parseNum(likesM?.[1]),
        comments: parseNum(commentsM?.[1]),
        views: parseNum(viewsM?.[1]),
        url: window.location.href
      };
    });
    return { platform: 'instagram', ...metrics };
  } catch(e) {
    console.error('IG error:', e.message);
    return null;
  } finally {
    await page.close();
  }
}

async function scrapeTikTok(browser, code) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
  try {
    const postUrl = await findPostUrl(page, code, 'tiktok');
    if (!postUrl) return null;

    await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 20000 });
    await page.waitForTimeout(3000);

    const metrics = await page.evaluate(() => {
      const parseNum = s => parseInt((s||'0').replace(/[^\d]/g,'')) || 0;
      let likes=0, comments=0, shares=0, views=0;
      document.querySelectorAll('strong[data-e2e]').forEach(el => {
        const k = el.dataset.e2e || '';
        const v = parseNum(el.textContent);
        if(k.includes('like')) likes = v;
        if(k.includes('comment')) comments = v;
        if(k.includes('share')) shares = v;
      });
      const viewEl = document.querySelector('[data-e2e="video-views"]');
      if(viewEl) views = parseNum(viewEl.textContent);
      return { likes, comments, shares, views, url: window.location.href };
    });
    return { platform: 'tiktok', ...metrics };
  } catch(e) {
    console.error('TT error:', e.message);
    return null;
  } finally {
    await page.close();
  }
}

async function scrapeMetrics(code) {
  const browser = await getBrowser();
  const results = [];
  try {
    const [ig, tt] = await Promise.allSettled([
      scrapeInstagram(browser, code),
      scrapeTikTok(browser, code)
    ]);
    if (ig.status === 'fulfilled' && ig.value) results.push(ig.value);
    if (tt.status === 'fulfilled' && tt.value) results.push(tt.value);
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = scrapeMetrics;
