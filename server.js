import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import { fetch } from 'undici';
import * as xhs from './adapters/xhs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname, {
  index: 'index.html',
  extensions: ['html'],
}));

// 简单内存限流：每 IP 每分钟 30 次
const rateMap = new Map();
function limiter(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const rec = rateMap.get(ip) || { count: 0, reset: now + 60_000 };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + 60_000; }
  rec.count++;
  rateMap.set(ip, rec);
  if (rec.count > 30) return res.status(429).json({ ok: false, error: '请求过于频繁，1 分钟后再试' });
  next();
}

// 平台分发
function pickAdapter(url) {
  if (/xiaohongshu\.com|xhslink\.com/i.test(url)) return xhs;
  return null;
}

app.get('/api/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/api/parse', limiter, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: '缺少 url 参数' });
  }
  // 从复制的文本里抽 URL（小红书分享带一堆中文和表情）
  const urlMatch = url.match(/https?:\/\/[^\s，。]+/);
  const realUrl = urlMatch ? urlMatch[0] : url.trim();

  const adapter = pickAdapter(realUrl);
  if (!adapter) {
    return res.status(400).json({ ok: false, error: '暂不支持该平台（当前仅支持小红书）' });
  }

  try {
    const data = await adapter.parse(realUrl);
    // 把每项 url 改写成走 /api/download 代理（前端下载不用处理防盗链）
    data.items = data.items.map(it => ({
      ...it,
      originalUrl: it.url,
      url: `/api/download?src=${encodeURIComponent(it.url)}&ref=${encodeURIComponent('https://www.xiaohongshu.com')}&name=${encodeURIComponent(it.filename)}`,
      previewUrl: `/api/preview?src=${encodeURIComponent(it.url)}&ref=${encodeURIComponent('https://www.xiaohongshu.com')}`,
    }));
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[parse]', e);
    res.status(500).json({ ok: false, error: e.message || '解析失败' });
  }
});

// 代理下载（强制 attachment）
app.get('/api/download', async (req, res) => {
  const { src, ref, name } = req.query;
  if (!src) return res.status(400).send('missing src');
  try {
    const upstream = await fetch(src, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15',
        'Referer': ref || 'https://www.xiaohongshu.com',
      },
    });
    if (!upstream.ok) return res.status(upstream.status).send('upstream ' + upstream.status);

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    const filename = name || 'file.bin';
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    // Node 18+ 可直接 pipe web stream 到 res
    const { Readable } = await import('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    res.status(500).send('proxy error: ' + e.message);
  }
});

// 代理预览（不加 Content-Disposition，直接在 img/video 里显示）
app.get('/api/preview', async (req, res) => {
  const { src, ref } = req.query;
  if (!src) return res.status(400).send('missing src');
  try {
    const upstream = await fetch(src, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15',
        'Referer': ref || 'https://www.xiaohongshu.com',
      },
    });
    if (!upstream.ok) return res.status(upstream.status).send('upstream ' + upstream.status);
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const { Readable } = await import('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    res.status(500).send('proxy error: ' + e.message);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[media-parser] listening on :${PORT}`);
});
