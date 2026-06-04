const puppeteer = require('puppeteer');

async function getBrowser() {
  return puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  });
}

// Search Instagram for CHW code
async function scrapeInstagram(browser, code) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');
  
  try {
    // Search hashtag or direct URL won't work without login
    // Use Instagram's public search via web
    const searchUrl = `https://www.instagram.com/explore/tags/${encodeURIComponent(code)}/`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(2000);

    // Try to find the post with this code in description
    const posts = await page.evaluate(() => {
      const imgs = document.querySelectorAll('article img, div[role="button"] img');
      return Array.from(imgs).slice(0, 20).map(img => ({
        alt: img.alt || '',
        src: img.src || ''
      }));
    });

    // Alternative: search via Google
    await page.goto(`https://www.google.com/search?q=site:instagram.com+"${code}"`, {
      waitUntil: 'networkidle2', timeout: 15000
    });
    await page.waitForTimeout(2000);

    const igUrl = await page.evaluate((searchCode) => {
      const links = document.querySelectorAll('a[href*="instagram.com"]');
      for (const link of links) {
        if (link.href.includes('instagram.com/p/') || link.href.includes('instagram.com/reel/')) {
          return link.href;
        }
      }
      return null;
    }, code);

    if (!igUrl) {
      console.log(`Instagram: no post found for ${code}`);
      return null;
    }

    // Visit the post
    await page.goto(igUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(2000);

    const metrics = await page.evaluate(() => {
      const text = document.body.innerText;
      // Extract likes
      const likesMatch = text.match(/(\d[\d,.]+)\s*(Me gusta|likes|likes?)/i);
      const commentsMatch = text.match(/(\d[\d,.]+)\s*(comentarios?|comments?)/i);
      const viewsMatch = text.match(/(\d[\d,.]+)\s*(visualizaciones|views|reproducciones)/i);
      
      const parseNum = (str) => {
        if (!str) return 0;
        return parseInt(str.replace(/[.,]/g, '')) || 0;
      };

      return {
        likes: parseNum(likesMatch?.[1]),
        comments: parseNum(commentsMatch?.[1]),
        views: parseNum(viewsMatch?.[1]),
        url: window.location.href
      };
    });

    return { platform: 'instagram', ...metrics };
  } catch (e) {
    console.error('Instagram scrape error:', e.message);
    return null;
  } finally {
    await page.close();
  }
}

// Search TikTok for CHW code
async function scrapeTikTok(browser, code) {
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

  try {
    // Search via Google
    await page.goto(`https://www.google.com/search?q=site:tiktok.com+"${code}"`, {
      waitUntil: 'networkidle2', timeout: 15000
    });
    await page.waitForTimeout(2000);

    const ttUrl = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="tiktok.com"]');
      for (const link of links) {
        if (link.href.includes('tiktok.com/@') && link.href.includes('/video/')) {
          return link.href;
        }
      }
      return null;
    });

    if (!ttUrl) {
      console.log(`TikTok: no post found for ${code}`);
      return null;
    }

    await page.goto(ttUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    await page.waitForTimeout(3000);

    const metrics = await page.evaluate(() => {
      // TikTok specific selectors
      const strongEls = document.querySelectorAll('strong[data-e2e]');
      let likes = 0, comments = 0, shares = 0, views = 0;
      
      strongEls.forEach(el => {
        const key = el.getAttribute('data-e2e') || '';
        const val = parseInt((el.textContent || '0').replace(/[^\d]/g, '')) || 0;
        if (key.includes('like')) likes = val;
        if (key.includes('comment')) comments = val;
        if (key.includes('share')) shares = val;
      });

      // Try video views
      const viewEl = document.querySelector('[data-e2e="video-views"], .video-count');
      if (viewEl) views = parseInt((viewEl.textContent || '0').replace(/[^\d]/g, '')) || 0;

      return { likes, comments, shares, views, url: window.location.href };
    });

    return { platform: 'tiktok', ...metrics };
  } catch (e) {
    console.error('TikTok scrape error:', e.message);
    return null;
  } finally {
    await page.close();
  }
}

// Main scrape function - runs IG and TT simultaneously
async function scrapeMetrics(code) {
  const browser = await getBrowser();
  const results = [];

  try {
    // Run both simultaneously
    const [igResult, ttResult] = await Promise.allSettled([
      scrapeInstagram(browser, code),
      scrapeTikTok(browser, code)
    ]);

    if (igResult.status === 'fulfilled' && igResult.value) {
      results.push(igResult.value);
    }
    if (ttResult.status === 'fulfilled' && ttResult.value) {
      results.push(ttResult.value);
    }
  } finally {
    await browser.close();
  }

  return results;
}

module.exports = scrapeMetrics;
