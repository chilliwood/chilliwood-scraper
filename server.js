const express = require('express');
const cors = require('cors');
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');
const scrapeMetrics = require('./scraper');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Supabase client with ws transport for Node 20
function getSB() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
    realtime: { transport: ws }
  });
}

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ChilliApp Scraper', version: '1.1.0' });
});

// Scrape single post by CHW code
app.post('/scrape', async (req, res) => {
  const { code, clientId } = req.body;
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.SCRAPER_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!code) return res.status(400).json({ error: 'Falta el código CHW' });

  try {
    console.log(`Scraping: ${code}`);
    const results = await scrapeMetrics(code);
    const sb = getSB();
    if (sb && clientId) {
      for (const r of results) {
        await sb.from('social_metrics').upsert({
          client_id: clientId, code,
          platform: r.platform,
          views: r.views || 0, likes: r.likes || 0,
          comments: r.comments || 0, shares: r.shares || 0,
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

// Batch scrape
app.post('/scrape/batch', async (req, res) => {
  const { codes, clientId } = req.body;
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.SCRAPER_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  if (!codes || !Array.isArray(codes)) return res.status(400).json({ error: 'Falta array de códigos' });

  res.json({ success: true, message: `Procesando ${codes.length} códigos en segundo plano` });

  // Process in background
  (async () => {
    const sb = getSB();
    for (const code of codes) {
      try {
        console.log(`Batch: ${code}`);
        const results = await scrapeMetrics(code);
        if (sb && clientId) {
          for (const r of results) {
            await sb.from('social_metrics').upsert({
              client_id: clientId, code,
              platform: r.platform,
              views: r.views || 0, likes: r.likes || 0,
              comments: r.comments || 0, shares: r.shares || 0,
              post_url: r.url || '',
              updated_at: new Date().toISOString()
            }, { onConflict: 'code,platform' });
          }
        }
        await new Promise(r => setTimeout(r, 3000));
      } catch (e) {
        console.error(`Error ${code}:`, e.message);
      }
    }
    console.log('Batch complete');
  })();
});

app.listen(PORT, () => console.log(`ChilliApp Scraper running on port ${PORT}`));
