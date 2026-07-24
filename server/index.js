const path = require('path');
const express = require('express');
const { extractProduct } = require('./productImport');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/import-url', async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A product URL is required.' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'That does not look like a valid URL.' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only http/https URLs are supported.' });
  }

  try {
    const product = await extractProduct(parsed.toString());
    res.json(product);
  } catch (err) {
    res.status(502).json({ error: err.message || 'Could not read product data from that page.' });
  }
});

app.listen(PORT, () => {
  console.log(`Shelf Talker Wizard running at http://localhost:${PORT}`);
});
