import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import contactHandler from './api/contact.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Parse incoming JSON and form payloads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serverless Contact Form API endpoint
app.post('/api/contact', contactHandler);

// Serve static assets and html files with html extension support
app.use(express.static(__dirname, { extensions: ['html'] }));

// Catch-all route to serve index.html
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.listen(Number(PORT), HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
