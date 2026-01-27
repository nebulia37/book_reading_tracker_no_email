import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import crypto from 'crypto';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import iconv from 'iconv-lite';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Middleware to log every request
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} to ${req.url}`);
  next();
});

const PORT = 3001;
const DB_FILE = path.join(__dirname, 'claims.json');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// 钉钉机器人配置
const DINGTALK_WEBHOOK = process.env.DINGTALK_WEBHOOK;
const DINGTALK_SECRET = process.env.DINGTALK_SECRET;

// /view 页面访问密码
const VIEW_ACCESS_CODE = process.env.VIEW_ACCESS_CODE || 'admin123';

// 发送钉钉通知
async function sendDingTalkNotification(claim) {
  if (!DINGTALK_WEBHOOK || !DINGTALK_SECRET) {
    console.log('DingTalk not configured, skipping notification');
    return;
  }

  try {
    const timestamp = Date.now();
    const stringToSign = `${timestamp}\n${DINGTALK_SECRET}`;
    const sign = crypto.createHmac('sha256', DINGTALK_SECRET)
      .update(stringToSign)
      .digest('base64');

    const url = `${DINGTALK_WEBHOOK}&timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;

    const message = {
      msgtype: 'markdown',
      markdown: {
        title: '新认领通知',
        text: `### 📖 新认领通知\n\n` +
              `**经卷**: ${claim.volumeNumber} ${claim.volumeTitle}\n\n` +
              `**认领人**: ${claim.name}\n\n` +
              `**电话**: ${claim.phone.slice(0, 3)}****${claim.phone.slice(-4)}\n\n` +
              `**计划天数**: ${claim.plannedDays}天\n\n` +
              `**预计完成**: ${new Date(Date.now() + claim.plannedDays * 24 * 60 * 60 * 1000).toLocaleDateString('zh-CN')}\n\n` +
              (claim.remarks ? `**备注**: ${claim.remarks}\n\n` : '') +
              `---\n认领时间: ${new Date().toLocaleString('zh-CN')}`
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });

    const result = await response.json();
    if (result.errcode === 0) {
      console.log('DingTalk notification sent successfully');
    } else {
      console.error('DingTalk notification failed:', result);
    }
  } catch (error) {
    console.error('Failed to send DingTalk notification:', error);
  }
}

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

// Cache for Supabase data to reduce API calls
let sheetCache = { data: null, timestamp: 0 };
const CACHE_DURATION = 1 * 60 * 1000; // 1 minute

let supabaseClient = null;
const getSupabaseClient = () => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false }
    });
  }
  return supabaseClient;
};

app.post('/api/claim', async (req, res) => {
  console.log("Received claim data:", req.body);
  const { volumeId, part, scroll, volumeNumber, volumeTitle, name, phone, plannedDays, readingUrl, remarks } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  // Validate phone number format (8-11 digits)
  if (!/^[0-9]{8,11}$/.test(phone)) {
    return res.status(400).json({ error: 'Phone number must be 8-11 digits.' });
  }

  try {
    const claimedAt = new Date().toISOString();

    // Prepare the data to match your Supabase table columns
    // Note: expectedCompletionDate is auto-calculated by database trigger (claimedAt + plannedDays)
    const newClaim = {
      volumeId,
      part: part || 1,
      scroll: scroll || 1,
      volumeNumber,
      volumeTitle,
      name,
      phone,
      plannedDays: plannedDays || 7,
      readingUrl,
      claimedAt,
      status: 'claimed',
      remarks: remarks || ''
    };

    const supabase = getSupabaseClient();
    if (!supabase) {
      console.warn('Supabase not configured, claim saved locally only');
      return res.status(500).json({ error: 'Supabase not configured.' });
    }

    const { data: existingClaims, error: existingError } = await supabase
      .from('claims')
      .select('id')
      .eq('volumeId', volumeId)
      .limit(1);

    if (existingError) {
      console.error('Supabase lookup failed:', existingError.message);
      return res.status(500).json({ error: 'Failed to validate claim uniqueness.' });
    }

    if (existingClaims && existingClaims.length > 0) {
      return res.status(409).json({ error: 'This volume has already been claimed.' });
    }

    console.log("Saving to Supabase:", newClaim);
    const { data, error } = await supabase
      .from('claims')
      .insert([newClaim])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert failed:', error.message, error.code);
      // Check for unique constraint violation (duplicate volumeId)
      if (error.code === '23505') {
        return res.status(409).json({ error: '该经卷已被其他人认领，请刷新页面选择其他经卷。' });
      }
      return res.status(500).json({ error: 'Failed to record claim.' });
    }

    // Invalidate cache so next GET fetches fresh data
    sheetCache = { data: null, timestamp: 0 };

    // 发送钉钉通知给中国的同修
    sendDingTalkNotification(data || newClaim);

    res.json({ success: true, claim: data || newClaim });
  } catch (error) {
    console.error('Supabase Error:', error);
    res.status(500).json({ error: 'Failed to record claim.' });
  }
});

// server.js - Add this to let the frontend see the claims
app.get('/api/claims', async (req, res) => {
  console.log(`[${new Date().toISOString()}] GET to /api/claims`);
  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.log('Supabase not configured, returning empty array');
      return res.json({ data: [] });
    }

    // Check cache first (skip if ?fresh=1)
    const now = Date.now();
    const skipCache = req.query.fresh === '1';
    if (!skipCache && sheetCache.data && (now - sheetCache.timestamp) < CACHE_DURATION) {
      console.log('Returning cached data (avoiding Supabase fetch)');
      return res.json(sheetCache.data);
    }

    console.log('Fetching from Supabase...');
    const { data, error } = await supabase
      .from('claims')
      .select('*');

    if (error) {
      throw new Error(`Supabase responded with error: ${error.message}`);
    }

    console.log('Supabase returned data:', JSON.stringify(data, null, 2));
    console.log(`Found ${Array.isArray(data) ? data.length : 0} claims`);

    // Update cache
    sheetCache = { data, timestamp: now };

    res.json({ data });
  } catch (error) {
    console.error('Error fetching from Supabase:', error);
    // Return cached data if available, otherwise error
    if (sheetCache.data) {
      console.log('Returning cached data due to error');
      return res.json(sheetCache.data);
    }
    res.status(500).json({ error: "Failed to fetch from Supabase", details: error.message });
  }
});


// 认领记录页面 - 需要访问码


// CSV export for /view
app.get('/view.csv', async (req, res) => {
  const code = req.query.code;
  if (code !== VIEW_ACCESS_CODE) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const supabase = getSupabaseClient();
    let claims = [];

    if (supabase) {
      const { data } = await supabase.from('claims').select('*').order('claimedAt', { ascending: false });
      claims = data || [];
    }

    const now = new Date();
    claims = claims.map(c => ({
      ...c,
      displayStatus: c.expectedCompletionDate && now >= new Date(c.expectedCompletionDate) ? '\u5df2\u5b8c\u6210' : '\u5df2\u8ba4\u9886'
    }));

    const headers = [
      'volumeId',
      'part',
      'scroll',
      'volumeNumber',
      'volumeTitle',
      'name',
      'phone',
      'plannedDays',
      'claimedAt',
      'expectedCompletionDate',
      'status',
      'readingUrl',
      'remarks'
    ];

    const escapeValue = (value) => {
      const raw = value === null || value === undefined ? '' : String(value);
      if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    };

    const lines = [headers.join(',')];
    claims.forEach(c => {
      const row = [
        c.volumeId || '',
        c.part || '',
        c.scroll || '',
        c.volumeNumber || '',
        c.volumeTitle || '',
        c.name || '',
        c.phone || '',
        c.plannedDays || '',
        c.claimedAt || '',
        c.expectedCompletionDate || '',
        c.displayStatus || '',
        c.readingUrl || '',
        c.remarks || ''
      ];
      lines.push(row.map(escapeValue).join(','));
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="claims.csv"');
    res.send(lines.join('\n'));
  } catch (error) {
    console.error('Error exporting CSV:', error);
    res.status(500).send('Failed to export CSV');
  }
});
app.get('/view', async (req, res) => {
  // 检查访问码
  const code = req.query.code;
  if (code !== VIEW_ACCESS_CODE) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>访问受限</title>
        <style>
          body { font-family: -apple-system, sans-serif; background: #fdfbf7; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
          .box { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
          h2 { color: #5c4033; margin-bottom: 20px; }
          p { color: #666; margin-bottom: 20px; }
          input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; margin-bottom: 15px; }
          button { width: 100%; padding: 12px; background: #8b7355; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
          button:hover { background: #5c4033; }
        </style>
      </head>
      <body>
        <div class="box">
          <h2>🔒 请输入访问码</h2>
          <p>此页面需要访问码才能查看</p>
          <form onsubmit="window.location.href='/view?code='+document.getElementById('code').value; return false;">
            <input type="password" id="code" placeholder="请输入访问码" autofocus>
            <button type="submit">确认</button>
          </form>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const supabase = getSupabaseClient();
    let claims = [];

    if (supabase) {
      const { data } = await supabase.from('claims').select('*').order('claimedAt', { ascending: false });
      claims = data || [];
    }

    // 检查是否已完成（过了预计完成日期）
    const now = new Date();
    claims = claims.map(c => ({
      ...c,
      displayStatus: c.expectedCompletionDate && now >= new Date(c.expectedCompletionDate) ? '\u5df2\u5b8c\u6210' : '\u5df2\u8ba4\u9886'
    }));

    const inProgressCount = claims.filter(c => c.displayStatus === '已认领').length;
    const completedCount = claims.filter(c => c.displayStatus === '已完成').length;

    // Build table rows
    const tableRows = claims.map(c => {
      const phone = c.phone ? c.phone.slice(0,3) + '****' + c.phone.slice(-4) : '-';
      const claimedDate = c.claimedAt ? new Date(c.claimedAt).toLocaleDateString('zh-CN') : '-';
      const expectedDate = c.expectedCompletionDate ? new Date(c.expectedCompletionDate).toLocaleDateString('zh-CN') : '-';
      const statusClass = c.displayStatus === '已完成' ? 'status-completed' : 'status-claimed';
      return `<tr>
        <td>${c.volumeNumber || '-'}</td>
        <td>${c.volumeTitle || '-'}</td>
        <td>${c.name || '-'}</td>
        <td>${phone}</td>
        <td>${c.plannedDays || '-'}天</td>
        <td>${claimedDate}</td>
        <td>${expectedDate}</td>
        <td class="${statusClass}">${c.displayStatus}</td>
        <td>${c.remarks || '-'}</td>
      </tr>`;
    }).join('');

    const tableHtml = claims.length > 0 ? `
    <table>
      <thead>
        <tr>
          <th>卷号</th>
          <th>经名</th>
          <th>认领人</th>
          <th>电话</th>
          <th>天数</th>
          <th>认领时间</th>
          <th>预计完成</th>
          <th>状态</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>` : '<div class="empty">暂无认领记录</div>';

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>诵读认领记录</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; background: #fdfbf7; padding: 20px; min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { color: #5c4033; text-align: center; margin-bottom: 8px; font-size: 28px; }
    .stats { display: flex; justify-content: center; gap: 20px; margin-bottom: 20px; flex-wrap: wrap; }
    .stat-box { background: white; padding: 15px 25px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); text-align: center; }
    .stat-num { font-size: 24px; font-weight: bold; color: #5c4033; }
    .stat-label { font-size: 12px; color: #8b7355; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    th { background: #8b7355; color: white; padding: 14px 10px; text-align: left; font-size: 14px; font-weight: 500; }
    td { padding: 12px 10px; border-bottom: 1px solid #f0ebe3; font-size: 13px; color: #333; }
    tr:last-child td { border-bottom: none; }
    tr:hover { background: #fdfbf7; }
    .status-claimed { color: #d97706; font-weight: 600; }
    .status-completed { color: #059669; font-weight: 600; }
    
    .actions { text-align: center; margin-top: 20px; display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
    .actions a { color: #8b7355; text-decoration: none; padding: 10px 20px; border: 1px solid #8b7355; border-radius: 8px; display: inline-block; transition: all 0.2s; }
    .actions a:hover { background: #8b7355; color: white; }
    .download { background: white; color: #5c4033; border-color: #5c4033; font-weight: 600; }
    .download:hover { background: #5c4033; color: white; border-color: #5c4033; }

    .empty { text-align: center; padding: 60px 20px; color: #999; }
    .update-time { text-align: center; color: #999; font-size: 12px; margin-top: 15px; }
    @media (max-width: 768px) {
      body { padding: 10px; }
      h1 { font-size: 22px; }
      th, td { padding: 10px 6px; font-size: 12px; }
      .stats { gap: 10px; }
      .stat-box { padding: 10px 15px; }
      .stat-num { font-size: 20px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📖 诵读认领记录</h1>
    <div class="stats">
      <div class="stat-box">
        <div class="stat-num">${claims.length}</div>
        <div class="stat-label">总认领数</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${inProgressCount}</div>
        <div class="stat-label">进行中</div>
      </div>
      <div class="stat-box">
        <div class="stat-num">${completedCount}</div>
        <div class="stat-label">已完成</div>
      </div>
    </div>
    ${tableHtml}
    <div class="actions">
      <a class="download" href="/view.csv?code=${code}">Download CSV</a>
      <a class="refresh" href="/view?code=${code}">Refresh</a>
    </div>
    <p class="update-time">最后更新: ${new Date().toLocaleString('zh-CN')}</p>
  </div>
</body>
</html>`;

    res.send(html);
  } catch (error) {
    console.error('Error rendering view:', error);
    res.status(500).send('加载失败: ' + error.message);
  }
});

// ============================================
// SCRIPTURE TEXT AND PDF ENDPOINTS
// ============================================

// Cache for scripture content to reduce upstream requests
let scriptureCache = new Map();
const SCRIPTURE_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Scripture text proxy endpoint (avoids CORS issues)
// BOOK_ID = 2069 + scroll (e.g., scroll 1 → book 2070, scroll 200 → book 2269)
app.get('/api/scripture/:scroll', async (req, res) => {
  const scroll = parseInt(req.params.scroll);
  if (isNaN(scroll) || scroll < 1 || scroll > 200) {
    return res.status(400).json({ error: 'Invalid scroll number (1-200)' });
  }

  const bookId = 2069 + scroll;
  const cacheKey = `scripture_${scroll}`;

  // Check cache first
  const cached = scriptureCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
    console.log(`Returning cached scripture for scroll ${scroll}`);
    return res.json({ html: cached.html, scroll, bookId, cached: true });
  }

  console.log(`Fetching scripture for scroll ${scroll}, book ID ${bookId}`);

  try {
    const response = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: `menuid=43|67&book=${bookId}&lang=zh&only_content=1`
    });

    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }

    // Upstream returns GB2312 encoding, need to decode properly
    const buffer = await response.arrayBuffer();
    const html = iconv.decode(Buffer.from(buffer), 'gbk');

    // Cache the result
    scriptureCache.set(cacheKey, { html, timestamp: Date.now() });

    res.json({ html, scroll, bookId, cached: false });
  } catch (error) {
    console.error('Failed to fetch scripture:', error);
    res.status(500).json({ error: 'Failed to fetch scripture text: ' + error.message });
  }
});

// Text file download endpoint (reliable Chinese support)
app.get('/api/scripture/:scroll/txt', async (req, res) => {
  const scroll = parseInt(req.params.scroll);
  if (isNaN(scroll) || scroll < 1 || scroll > 200) {
    return res.status(400).json({ error: 'Invalid scroll number (1-200)' });
  }

  const bookId = 2069 + scroll;
  console.log(`Generating TXT for scroll ${scroll}, book ID ${bookId}`);

  try {
    const cacheKey = `scripture_${scroll}`;
    let scriptureHtml;

    const cached = scriptureCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
      scriptureHtml = cached.html;
    } else {
      const response = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: `menuid=43|67&book=${bookId}&lang=zh&only_content=1`
      });

      if (!response.ok) {
        throw new Error(`Upstream returned ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      scriptureHtml = iconv.decode(Buffer.from(buffer), 'gbk');
      scriptureCache.set(cacheKey, { html: scriptureHtml, timestamp: Date.now() });
    }

    // Extract plain text - keep Chinese characters only
    const plainText = scriptureHtml
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<i><span>[^<]*<\/span><span>([^<]*)<\/span><\/i>/gi, '$1')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const fullText = `大般若波羅蜜多經 卷${scroll}\n唐三藏法師玄奘 奉詔譯\n${'='.repeat(40)}\n\n${plainText}`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const txtFilename = `大般若波羅蜜多經_卷${scroll}.txt`;
    const encodedTxtFilename = encodeURIComponent(txtFilename);
    res.setHeader('Content-Disposition', `attachment; filename="${scroll}.txt"; filename*=UTF-8''${encodedTxtFilename}`);
    res.send(fullText);
  } catch (error) {
    console.error('Failed to generate TXT:', error);
    res.status(500).json({ error: 'Failed to generate text file: ' + error.message });
  }
});

// PDF generation endpoint using Puppeteer (proper Chinese support & styling)
app.get('/api/scripture/:scroll/pdf', async (req, res) => {
  const scroll = parseInt(req.params.scroll);
  if (isNaN(scroll) || scroll < 1 || scroll > 200) {
    return res.status(400).json({ error: 'Invalid scroll number (1-200)' });
  }

  const bookId = 2069 + scroll;
  console.log(`Generating PDF for scroll ${scroll}, book ID ${bookId}`);

  try {
    // First fetch the scripture content (check cache)
    const cacheKey = `scripture_${scroll}`;
    let scriptureHtml;

    const cached = scriptureCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
      scriptureHtml = cached.html;
    } else {
      const response = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: `menuid=43|67&book=${bookId}&lang=zh&only_content=1`
      });

      if (!response.ok) {
        throw new Error(`Upstream returned ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      scriptureHtml = iconv.decode(Buffer.from(buffer), 'gbk');
      scriptureCache.set(cacheKey, { html: scriptureHtml, timestamp: Date.now() });
    }

    // Upstream nests punctuation inside the hanzi span:
    //   <i><span>pinyin</span><span>hanzi<span class=dou>，</span></span></i>
    // Extract to a separate <i> block so it becomes its own py-pair with empty pinyin
    let cleanedHtml = scriptureHtml;
    cleanedHtml = cleanedHtml.replace(
      /<span class=(?:["'])?(?:dou|dian)(?:["'])?>([^<]*)<\/span>(<\/span><\/i>)/gi,
      '$2<i><span>\u00a0</span><span>$1</span></i>'
    );
    // Convert all <i><span>pinyin</span><span>hanzi</span></i> to py-pair
    const rubyHtml = cleanedHtml
      .replace(/<i><span[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)<\/span><\/i>/gi, (_, py, hz) => {
        const pinyin = py.trim() || '\u00a0';
        return `<span class="py-pair"><span class="py">${pinyin}</span><span class="hz">${hz}</span></span>`;
      });

    let pCount = 0;
    const centeredHtml = rubyHtml.replace(/<p([^>]*)>/gi, (match, attrs) => {
      pCount += 1;
      if (pCount > 3) return `<p${attrs}>`;
      if (/\bclass\s*=/.test(attrs)) {
        return match.replace(/class\s*=\s*["']([^"']*)["']/, (m, cls) => `class="${cls} center"`);
      }
      return `<p${attrs} class="center">`;
    });

    // Generate styled HTML for PDF - matching xianmijingzang.com style with ruby annotations
    const fullHtml = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      size: A4;
      margin: 1.5cm 1.5cm;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: "Microsoft YaHei", "SimSun", "STSong", "Noto Serif CJK SC", "PingFang SC", serif;
      font-size: 16pt;
      line-height: 2.8;
      color: #333;
      background: #fdfbf7;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: linear-gradient(to bottom, #f5f0e8, #fdfbf7);
      border-bottom: 2px solid #c9a86c;
    }
    .title {
      font-size: 32pt;
      font-weight: bold;
      color: #8b4513;
      margin-bottom: 10px;
      letter-spacing: 10px;
      text-shadow: 1px 1px 2px rgba(0,0,0,0.1);
    }
    .subtitle {
      font-size: 16pt;
      color: #a0522d;
      letter-spacing: 6px;
    }
    .translator {
      font-size: 12pt;
      color: #8b7355;
      margin-top: 8px;
      letter-spacing: 3px;
    }
    .content {
      padding: 20px 30px;
      text-align: justify;
      background: #fff;
      border: 1px solid #e8e0d0;
      border-radius: 4px;
      margin: 0 10px;
    }
    .content p {
      margin-bottom: 1em;
      text-indent: 2em;
      font-size: 0;
    }
    .content p.center {
      text-align: center;
      text-indent: 0;
    }

    /* Pinyin above Chinese characters, separate lines */
    .py-pair {
      display: inline-block;
      text-align: center;
      margin: 0;
      line-height: 1.1;
    }
    .py-pair .py {
      display: block;
      font-size: 8pt;
      color: #888;
      font-family: Arial, "Helvetica Neue", sans-serif;
      line-height: 1;
      min-height: 8pt;
    }
    .py-pair .hz {
      display: block;
      font-size: 16pt;
      color: #333;
      line-height: 1.2;
    }

    .footer {
      margin-top: 40px;
      padding: 15px;
      text-align: center;
      font-size: 10pt;
      color: #a0522d;
      border-top: 1px solid #c9a86c;
    }

    /* Hide any remaining styling elements */
    i { font-style: normal; }

    /* Decorative elements */
    .ornament {
      text-align: center;
      color: #c9a86c;
      font-size: 14pt;
      margin: 15px 0;
      letter-spacing: 10px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">大般若波羅蜜多經</div>
    <div class="subtitle">卷第${scroll}</div>
    <div class="translator">唐三藏法師玄奘 奉詔譯</div>
  </div>
  <div class="ornament">❀ ❀ ❀</div>
  <div class="content">
    ${centeredHtml}
  </div>
  <div class="ornament">❀ ❀ ❀</div>
  <div class="footer">
    — 大般若波羅蜜多經 卷第${scroll} —<br>
    <span style="font-size: 8pt; color: #999;">Generated from xianmijingzang.com</span>
  </div>
</body>
</html>`;

    // Generate PDF using Puppeteer
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
          '--disable-web-security'
        ]
      });

      const page = await browser.newPage();
      await page.setContent(fullHtml, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '2.5cm',
          bottom: '2.5cm',
          left: '2cm',
          right: '2cm'
        },
        displayHeaderFooter: false
      });

      await browser.close();

      res.setHeader('Content-Type', 'application/pdf');
      const filename = `大般若波羅蜜多經_卷${scroll}.pdf`;
      const encodedFilename = encodeURIComponent(filename);
      res.setHeader('Content-Disposition', `attachment; filename="${scroll}.pdf"; filename*=UTF-8''${encodedFilename}`);
      res.send(pdfBuffer);

    } catch (browserError) {
      console.error('Browser/PDF error:', browserError);
      if (browser) await browser.close().catch(() => {});
      throw browserError;
    }

  } catch (error) {
    console.error('Failed to generate PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nServer Active at http://localhost:${PORT}`);
  console.log(`View claims at http://localhost:${PORT}/view`);
  console.log(`CORS enabled for all origins`);
  console.log(`Supabase configured: ${!!(SUPABASE_URL && SUPABASE_ANON_KEY)}`);
});
