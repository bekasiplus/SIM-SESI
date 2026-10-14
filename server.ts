import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // CORS and Cache Headers for API
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Proxy endpoint to fetch Google Sheets CSV without CORS restrictions
  app.get('/api/fetch-sheet', async (req, res) => {
    const rawUrl = req.query.url as string;
    if (!rawUrl) {
      return res.status(400).json({ error: 'Parameter url harus disertakan.' });
    }

    const trimmedUrl = rawUrl.trim();

    // Check if it's a Google Sheets link
    const isGoogleSheet = trimmedUrl.includes('docs.google.com/spreadsheets');
    const sheetIdMatch = trimmedUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const pubIdMatch = trimmedUrl.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
    const gidMatch = trimmedUrl.match(/[#&?]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : '0';

    const candidateUrls: string[] = [];

    if (isGoogleSheet) {
      if (sheetIdMatch && sheetIdMatch[1]) {
        const id = sheetIdMatch[1];
        // 1. Google Visualization CSV API (Most reliable for public/shared sheets)
        candidateUrls.push(`https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`);
        // 2. Direct CSV Export
        candidateUrls.push(`https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`);
      }
      if (pubIdMatch && pubIdMatch[1]) {
        candidateUrls.push(`https://docs.google.com/spreadsheets/d/e/${pubIdMatch[1]}/pub?output=csv&gid=${gid}`);
      }
    }

    // Always include direct URL as fallback
    if (!candidateUrls.includes(trimmedUrl)) {
      candidateUrls.push(trimmedUrl);
    }

    let lastError = '';
    let isHtmlAuthRedirect = false;

    for (const testUrl of candidateUrls) {
      try {
        const response = await fetch(testUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/csv,text/plain,application/json,*/*'
          },
          redirect: 'follow'
        });

        if (response.ok) {
          const text = await response.text();
          // Verify it's not a login page or HTML redirect
          const isHtml = text.includes('<!DOCTYPE html>') || text.includes('<html') || text.includes('accounts.google.com');
          if (isHtml) {
            isHtmlAuthRedirect = true;
            continue;
          }

          if (text && text.trim().length > 0) {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            return res.send(text);
          }
        } else {
          lastError = `HTTP ${response.status}: ${response.statusText}`;
        }
      } catch (err: any) {
        lastError = err.message || 'Network error';
      }
    }

    if (isHtmlAuthRedirect) {
      return res.status(403).json({
        error: 'Tautan Google Sheets ini privat atau dibatasi (memerlukan login akun Google). Silakan ubah pengaturan Berbagi (Share) menjadi "Siapa saja yang memiliki link dapat melihat" (Anyone with the link can view), atau unduh sebagai file Excel (.xlsx) lalu gunakan tab "Upload File Excel".'
      });
    }

    return res.status(502).json({
      error: `Gagal mengunduh data Google Sheet (${lastError || 'Tidak dapat diakses'}). Pastikan link valid dan dapat diakses publik, atau gunakan upload file Excel (.xlsx).`
    });
  });

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    // Vite Dev Server middleware mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Static serve in production
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
