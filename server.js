const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const scrapeMetrics = require('./scraper');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ChilliApp Scraper', version: '1.0.0' });
});

// Scrape single post by CHW code
app.post('/scrape', async (req, res) => {
  const { code, clientId } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== process.env.SCRAPER_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!code) {
    return res.status(400).json({ error: 'Falta el código CHW' });
  }

  try {
    console.log(`Scraping code: ${code}`);
    const results = await scrapeMetrics(code);
    
    // Save to Supabase if clientId provided
    if (clientId && process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
      for (const r of results) {
        await sb.from('social_metrics').upsert({
          client_id: clientId,
          code,
          platform: r.platform,
          views: r.views || 0,
          likes: r.likes || 0,
          comments: r.comments || 0,
          shares: r.shares || 0,
          post_url: r.url || '',
          updated_at: new Date().toISOString()
        }, { onConflict: 'code,platform' });
      }
    }

    res.json({ success: true, code, results });
  } catch (e) {
    console.error('Scrape error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Batch scrape all videos for a client
app.post('/scrape/batch', async (req, res) => {
  const { codes, clientId } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== process.env.SCRAPER_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!codes || !Array.isArray(codes)) {
    return res.status(400).json({ error: 'Falta el array de códigos' });
  }

  res.json({ success: true, message: `Procesando ${codes.length} códigos en segundo plano` });

  // Process in background
  (async () => {
    const sb = process.env.SUPABASE_URL 
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY) 
      : null;

    for (const code of codes) {
      try {
        console.log(`Batch scraping: ${code}`);
        const results = await scrapeMetrics(code);
        
        if (sb && clientId) {
          for (const r of results) {
            await sb.from('social_metrics').upsert({
              client_id: clientId,
              code,
              platform: r.platform,
              views: r.views || 0,
              likes: r.likes || 0,
              comments: r.comments || 0,
              shares: r.shares || 0,
              post_url: r.url || '',
              updated_at: new Date().toISOString()
            }, { onConflict: 'code,platform' });
          }
        }
        // Delay between requests to avoid rate limiting
        await new Promise(r => setTimeout(r, 3000));
      } catch (e) {
        console.error(`Error scraping ${code}:`, e.message);
      }
    }
    console.log('Batch complete');
  })();
});

app.listen(PORT, () => {
  console.log(`ChilliApp Scraper running on port ${PORT}`);
});
