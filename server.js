// Disable SSL certificate verification for expired upstream certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import crypto from 'crypto';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import iconv from 'iconv-lite';

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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_SERVER_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

// 钉钉机器人配置
const DINGTALK_WEBHOOK = process.env.DINGTALK_WEBHOOK;
const DINGTALK_SECRET = process.env.DINGTALK_SECRET;

// /view 页面访问密码
const VIEW_ACCESS_CODE = process.env.VIEW_ACCESS_CODE || 'admin123';
const COMPLETED_STATUS_VALUES = new Set(['completed', 'complete', 'done', '已完成']);
const normalizeStatus = (status) => String(status || '').trim().toLowerCase();
const isCompletedStatus = (status) => {
  const normalized = normalizeStatus(status);
  return COMPLETED_STATUS_VALUES.has(normalized) || normalized.includes('完成');
};

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
  if (!SUPABASE_URL || !SUPABASE_SERVER_KEY) return null;
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVER_KEY, {
      auth: { persistSession: false }
    });
    console.log(`Supabase client initialized with ${SUPABASE_SERVICE_ROLE_KEY ? 'service role key' : 'anon key'}`);
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


// Mark a volume as completed
app.post('/api/complete', async (req, res) => {
  const rawVolumeId = req.body?.volumeId;
  const volumeId = rawVolumeId === undefined || rawVolumeId === null ? '' : String(rawVolumeId).trim();
  const part = Number(req.body?.part);
  const scroll = Number(req.body?.scroll);
  const volumeNumber = req.body?.volumeNumber ? String(req.body.volumeNumber).trim() : '';
  console.log(`Complete request: volumeId="${volumeId}", part=${part}, scroll=${scroll}, volumeNumber="${volumeNumber}"`);

  if (!volumeId) {
    return res.status(400).json({ error: 'volumeId is required' });
  }

  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    let updatedClaim = null;

    // 1) Try update by volumeId
    console.log(`Complete: trying update by volumeId="${volumeId}"`);
    let result = await supabase
      .from('claims')
      .update({ status: 'completed' })
      .eq('volumeId', volumeId)
      .select('*');

    console.log(`Complete: volumeId result: data=${JSON.stringify(result.data)}, error=${result.error?.message || 'none'}`);

    if (!result.error && Array.isArray(result.data) && result.data.length > 0) {
      updatedClaim = result.data[0];
    }

    // 2) Fallback: volumeNumber
    if (!updatedClaim && volumeNumber) {
      console.log(`Complete: trying update by volumeNumber="${volumeNumber}"`);
      result = await supabase
        .from('claims')
        .update({ status: 'completed' })
        .eq('volumeNumber', volumeNumber)
        .select('*');

      console.log(`Complete: volumeNumber result: data=${JSON.stringify(result.data)}, error=${result.error?.message || 'none'}`);

      if (!result.error && Array.isArray(result.data) && result.data.length > 0) {
        updatedClaim = result.data[0];
      }
    }

    // Invalidate cache
    sheetCache = { data: null, timestamp: 0 };

    if (!updatedClaim) {
      console.warn(`Complete: no matching row found for volumeId="${volumeId}", volumeNumber="${volumeNumber}"`);
      return res.status(404).json({
        error: 'No matching claim found in database',
        volumeId,
        volumeNumber
      });
    }

    console.log(`Complete: successfully updated claim for volumeId="${updatedClaim.volumeId}" to status="${updatedClaim.status}"`);

    res.json({ success: true, claim: updatedClaim });
  } catch (error) {
    console.error('Complete error:', error);
    res.status(500).json({
      error: 'Failed to complete volume',
      details: error?.message || String(error)
    });
  }
});

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
      displayStatus: isCompletedStatus(c.status) ? '\u5df2\u5b8c\u6210' : '\u5df2\u8ba4\u9886'
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
    claims = claims.map(c => ({
      ...c,
      displayStatus: isCompletedStatus(c.status) ? '\u5df2\u5b8c\u6210' : '\u5df2\u8ba4\u9886'
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

// Helper: fetch a single book's HTML from upstream
// menuid format: "collectionId|subid" e.g. "48|465"
async function fetchBookHtml(bookId, menuid) {
  const response = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: `menuid=${menuid}&book=${bookId}&lang=zh&only_content=1`
  });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  const buffer = await response.arrayBuffer();
  return iconv.decode(Buffer.from(buffer), 'gbk');
}

// Fetch both HTML content and audio URL from upstream in parallel.
// Metadata request (no only_content) returns the audio URL.
// HTML request (only_content=1) always returns HTML directly.
// Both are independent so we fire them simultaneously.
async function fetchBookWithAudio(bookId, menuid) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest'
  };

  const [metaBuffer, html] = await Promise.all([
    fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
      method: 'POST', headers,
      body: `menuid=${menuid}&book=${bookId}&lang=zh`
    }).then(r => { if (!r.ok) throw new Error(`Upstream returned ${r.status}`); return r.arrayBuffer(); }),
    fetchBookHtml(bookId, menuid)
  ]);

  const metaJson = JSON.parse(iconv.decode(Buffer.from(metaBuffer), 'gbk'));
  const audioUrl = metaJson.links || metaJson.audiolinks || '';

  return { html, audioUrl };
}

// ============================================
// CATALOG FOR PARTS 777-1076 (collection 51)
// ============================================
const SCRIPTURE_CATALOG = [
  { part: 777, title: '佛說大乗莊嚴寳王經', subid: 884, scrollCount: 4, firstBookId: 5039, collectionId: 51 },
  { part: 778, title: '分别善惡報應經', subid: 885, scrollCount: 2, firstBookId: 5043, collectionId: 51 },
  { part: 779, title: '佛說守護大千國土經', subid: 886, scrollCount: 3, firstBookId: 5045, collectionId: 51 },
  { part: 780, title: '大方廣總持寳光明經', subid: 887, scrollCount: 5, firstBookId: 5048, collectionId: 51 },
  { part: 781, title: '佛說大乗聖無量壽決定光明王如來陀羅尼經', subid: 888, scrollCount: 1, firstBookId: 5053, collectionId: 51 },
  { part: 782, title: '佛說大乗聖吉祥持世陀羅尼經', subid: 889, scrollCount: 1, firstBookId: 5054, collectionId: 51 },
  { part: 783, title: '佛說大乗日子王所問經', subid: 890, scrollCount: 1, firstBookId: 5055, collectionId: 51 },
  { part: 784, title: '佛說金耀童子經', subid: 891, scrollCount: 1, firstBookId: 5056, collectionId: 51 },
  { part: 785, title: '佛頂放無垢光明入普門觀察一切如來心陀羅尼經', subid: 892, scrollCount: 2, firstBookId: 5057, collectionId: 51 },
  { part: 786, title: '佛說樓閣正法甘露鼓經', subid: 893, scrollCount: 1, firstBookId: 5059, collectionId: 51 },
  { part: 787, title: '佛說大乗善見變化文殊師利問法經', subid: 894, scrollCount: 1, firstBookId: 5060, collectionId: 51 },
  { part: 788, title: '聖虚空藏菩薩陀羅尼經', subid: 895, scrollCount: 1, firstBookId: 5061, collectionId: 51 },
  { part: 789, title: '佛說大護明大陀羅尼經', subid: 896, scrollCount: 1, firstBookId: 5062, collectionId: 51 },
  { part: 790, title: '佛說無能勝旛王如來莊嚴陀羅尼經', subid: 897, scrollCount: 1, firstBookId: 5063, collectionId: 51 },
  { part: 791, title: '最勝佛頂陀羅尼經', subid: 898, scrollCount: 1, firstBookId: 5064, collectionId: 51 },
  { part: 792, title: '聖佛母小字般若波羅蜜多經', subid: 899, scrollCount: 1, firstBookId: 5065, collectionId: 51 },
  { part: 793, title: '消除一切閃電障難隨求如意陀羅尼經', subid: 900, scrollCount: 1, firstBookId: 5066, collectionId: 51 },
  { part: 794, title: '聖最上燈明如來陀羅尼經', subid: 901, scrollCount: 1, firstBookId: 5067, collectionId: 51 },
  { part: 795, title: '大寒林聖難拏陀羅尼經', subid: 902, scrollCount: 1, firstBookId: 5068, collectionId: 51 },
  { part: 796, title: '佛說諸行有爲經', subid: 903, scrollCount: 1, firstBookId: 5069, collectionId: 51 },
  { part: 797, title: '息除中夭陀羅尼經', subid: 904, scrollCount: 1, firstBookId: 5070, collectionId: 51 },
  { part: 798, title: '一切如來正法秘密篋印心陀羅尼經', subid: 905, scrollCount: 1, firstBookId: 5071, collectionId: 51 },
  { part: 799, title: '妙法聖念處經', subid: 906, scrollCount: 8, firstBookId: 5072, collectionId: 51 },
  { part: 800, title: '佛說大迦葉問大寳積正法經', subid: 907, scrollCount: 5, firstBookId: 5080, collectionId: 51 },
  { part: 801, title: '嗟韈曩法天子受三歸依獲免惡道經', subid: 908, scrollCount: 1, firstBookId: 5085, collectionId: 51 },
  { part: 802, title: '佛說較量壽命經', subid: 909, scrollCount: 1, firstBookId: 5086, collectionId: 51 },
  { part: 803, title: '佛說沙彌十戒儀則經', subid: 910, scrollCount: 1, firstBookId: 5087, collectionId: 51 },
  { part: 804, title: '佛說聖持世陀羅尼經', subid: 911, scrollCount: 1, firstBookId: 5088, collectionId: 51 },
  { part: 805, title: '佛說布施經', subid: 913, scrollCount: 1, firstBookId: 5089, collectionId: 51 },
  { part: 806, title: '佛說聖曜母陀羅尼經', subid: 914, scrollCount: 1, firstBookId: 5090, collectionId: 51 },
  { part: 807, title: '法集名數經', subid: 915, scrollCount: 1, firstBookId: 5091, collectionId: 51 },
  { part: 808, title: '聖多羅菩薩一百八名陀羅尼經', subid: 916, scrollCount: 1, firstBookId: 5092, collectionId: 51 },
  { part: 809, title: '十二縁生祥瑞經', subid: 917, scrollCount: 2, firstBookId: 5093, collectionId: 51 },
  { part: 810, title: '讃揚聖德多羅菩薩一百八名經', subid: 918, scrollCount: 1, firstBookId: 5095, collectionId: 51 },
  { part: 811, title: '聖觀自在菩薩一百八名經', subid: 919, scrollCount: 1, firstBookId: 5096, collectionId: 51 },
  { part: 812, title: '佛說目連所問經', subid: 920, scrollCount: 1, firstBookId: 5097, collectionId: 51 },
  { part: 813, title: '外道問聖大乗法無我義經', subid: 921, scrollCount: 1, firstBookId: 5098, collectionId: 51 },
  { part: 814, title: '毗俱胝菩薩一百八名經', subid: 922, scrollCount: 1, firstBookId: 5099, collectionId: 51 },
  { part: 815, title: '勝軍化世百喻伽他經', subid: 923, scrollCount: 1, firstBookId: 5100, collectionId: 51 },
  { part: 816, title: '六道伽陀經', subid: 924, scrollCount: 1, firstBookId: 5101, collectionId: 51 },
  { part: 817, title: '妙臂菩薩所問經', subid: 925, scrollCount: 4, firstBookId: 5102, collectionId: 51 },
  { part: 818, title: '佛說苾芻五法經', subid: 926, scrollCount: 1, firstBookId: 5106, collectionId: 51 },
  { part: 819, title: '佛說苾芻迦尸迦十法經', subid: 927, scrollCount: 1, firstBookId: 5107, collectionId: 51 },
  { part: 820, title: '諸佛心印陀羅尼經', subid: 928, scrollCount: 1, firstBookId: 5108, collectionId: 51 },
  { part: 821, title: '大乗寳月童子問法經', subid: 929, scrollCount: 1, firstBookId: 5109, collectionId: 51 },
  { part: 822, title: '佛說蓮華眼陀羅尼經', subid: 930, scrollCount: 1, firstBookId: 5110, collectionId: 51 },
  { part: 823, title: '佛說觀想佛母般若波羅蜜多菩薩經', subid: 931, scrollCount: 1, firstBookId: 5111, collectionId: 51 },
  { part: 824, title: '佛說如意摩尼陀羅尼經', subid: 932, scrollCount: 1, firstBookId: 5112, collectionId: 51 },
  { part: 825, title: '佛說聖大緫持王經', subid: 933, scrollCount: 1, firstBookId: 5113, collectionId: 51 },
  { part: 826, title: '佛說最上意陀羅尼經', subid: 934, scrollCount: 1, firstBookId: 5114, collectionId: 51 },
  { part: 827, title: '佛說持明藏八大緫持王經', subid: 935, scrollCount: 1, firstBookId: 5115, collectionId: 51 },
  { part: 828, title: '聖無能勝金剛火陀羅尼經', subid: 936, scrollCount: 1, firstBookId: 5116, collectionId: 51 },
  { part: 829, title: '佛說尊勝大明王經', subid: 937, scrollCount: 1, firstBookId: 5117, collectionId: 51 },
  { part: 830, title: '佛說智光滅一切業障陀羅尼經', subid: 938, scrollCount: 1, firstBookId: 5118, collectionId: 51 },
  { part: 831, title: '佛說如意寳緫持王經', subid: 939, scrollCount: 1, firstBookId: 5119, collectionId: 51 },
  { part: 832, title: '佛說大自在天子因地經', subid: 940, scrollCount: 1, firstBookId: 5120, collectionId: 51 },
  { part: 833, title: '佛說寳生陀羅尼經', subid: 941, scrollCount: 1, firstBookId: 5121, collectionId: 51 },
  { part: 834, title: '佛說十號經', subid: 942, scrollCount: 1, firstBookId: 5122, collectionId: 51 },
  { part: 835, title: '佛爲娑伽羅龍王所說大乗法經', subid: 943, scrollCount: 1, firstBookId: 5123, collectionId: 51 },
  { part: 836, title: '佛說普賢菩薩陀羅尼經', subid: 944, scrollCount: 1, firstBookId: 5124, collectionId: 51 },
  { part: 837, title: '大金剛妙髙山樓閣陀羅尼', subid: 945, scrollCount: 1, firstBookId: 5125, collectionId: 51 },
  { part: 838, title: '廣大蓮華莊嚴曼拏羅滅一切罪陀羅尼經', subid: 946, scrollCount: 1, firstBookId: 5126, collectionId: 51 },
  { part: 839, title: '佛說大摩里支菩薩經', subid: 947, scrollCount: 8, firstBookId: 5127, collectionId: 51, has0aPreface: true },
  { part: 840, title: '佛說末利支提婆華鬘經', subid: 948, scrollCount: 1, firstBookId: 5135, collectionId: 51 },
  { part: 841, title: '佛說摩利支天經', subid: 949, scrollCount: 1, firstBookId: 5136, collectionId: 51 },
  { part: 842, title: '佛說摩利支天陀羅尼呪經', subid: 950, scrollCount: 1, firstBookId: 5137, collectionId: 51 },
  { part: 843, title: '佛說長者施報經', subid: 951, scrollCount: 1, firstBookId: 5138, collectionId: 51 },
  { part: 844, title: '佛說毗沙門天王經', subid: 952, scrollCount: 1, firstBookId: 5139, collectionId: 51 },
  { part: 845, title: '毗婆尸佛經', subid: 953, scrollCount: 2, firstBookId: 5140, collectionId: 51 },
  { part: 846, title: '佛說大三摩惹經', subid: 954, scrollCount: 1, firstBookId: 5142, collectionId: 51 },
  { part: 847, title: '佛說月光菩薩經', subid: 955, scrollCount: 1, firstBookId: 5143, collectionId: 51 },
  { part: 848, title: '佛說普賢曼拏羅經', subid: 956, scrollCount: 1, firstBookId: 5144, collectionId: 51 },
  { part: 849, title: '佛說聖莊嚴陀羅尼經', subid: 957, scrollCount: 2, firstBookId: 5145, collectionId: 51 },
  { part: 850, title: '佛說聖六字大明王陀羅尼經', subid: 958, scrollCount: 1, firstBookId: 5147, collectionId: 51 },
  { part: 851, title: '千轉大明陀羅尼經', subid: 959, scrollCount: 1, firstBookId: 5148, collectionId: 51 },
  { part: 852, title: '佛說華積樓閣陀羅尼經', subid: 960, scrollCount: 1, firstBookId: 5149, collectionId: 51 },
  { part: 853, title: '佛說勝旛瓔珞陀羅尼經', subid: 961, scrollCount: 1, firstBookId: 5150, collectionId: 51 },
  { part: 854, title: '衆許摩訶帝經', subid: 962, scrollCount: 13, firstBookId: 5151, collectionId: 51 },
  { part: 855, title: '佛說七佛經', subid: 963, scrollCount: 1, firstBookId: 5164, collectionId: 51 },
  { part: 856, title: '佛說解憂經', subid: 964, scrollCount: 1, firstBookId: 5165, collectionId: 51 },
  { part: 857, title: '佛說徧照般若波羅蜜經', subid: 965, scrollCount: 1, firstBookId: 5166, collectionId: 51 },
  { part: 858, title: '佛說大乗無量壽莊嚴經', subid: 966, scrollCount: 3, firstBookId: 5167, collectionId: 51 },
  { part: 859, title: '佛母寳徳藏般若波羅蜜經', subid: 967, scrollCount: 3, firstBookId: 5170, collectionId: 51 },
  { part: 860, title: '佛說帝釋般若波羅蜜多心經', subid: 968, scrollCount: 1, firstBookId: 5173, collectionId: 51 },
  { part: 861, title: '佛說諸佛經', subid: 969, scrollCount: 1, firstBookId: 5174, collectionId: 51 },
  { part: 862, title: '大乗舍黎娑擔摩經', subid: 970, scrollCount: 1, firstBookId: 5175, collectionId: 51 },
  { part: 863, title: '佛說大金剛香陀羅尼經', subid: 971, scrollCount: 1, firstBookId: 5176, collectionId: 51 },
  { part: 864, title: '最上大乗金剛大教寳王經', subid: 972, scrollCount: 2, firstBookId: 5177, collectionId: 51 },
  { part: 865, title: '佛說薩鉢多酥哩踰捺野經', subid: 973, scrollCount: 1, firstBookId: 5179, collectionId: 51 },
  { part: 866, title: '佛說一切如來烏瑟膩沙最勝緫持經', subid: 974, scrollCount: 1, firstBookId: 5180, collectionId: 51 },
  { part: 867, title: '菩提心觀釋', subid: 975, scrollCount: 1, firstBookId: 5181, collectionId: 51 },
  { part: 868, title: '佛說護國尊者所問大乗經', subid: 976, scrollCount: 4, firstBookId: 5182, collectionId: 51 },
  { part: 869, title: '佛說四無所畏經', subid: 977, scrollCount: 1, firstBookId: 5186, collectionId: 51 },
  { part: 870, title: '増慧陀羅尼經', subid: 978, scrollCount: 1, firstBookId: 5187, collectionId: 51 },
  { part: 871, title: '聖六字増壽大明陀羅尼經', subid: 979, scrollCount: 1, firstBookId: 5188, collectionId: 51 },
  { part: 872, title: '佛說大乗戒經', subid: 980, scrollCount: 1, firstBookId: 5189, collectionId: 51 },
  { part: 873, title: '佛說聖最勝陀羅尼經', subid: 981, scrollCount: 1, firstBookId: 5190, collectionId: 51 },
  { part: 874, title: '佛說五十頌聖般若波羅蜜經', subid: 982, scrollCount: 1, firstBookId: 5191, collectionId: 51 },
  { part: 875, title: '大乗八大曼拏羅經', subid: 983, scrollCount: 1, firstBookId: 5192, collectionId: 51 },
  { part: 876, title: '佛說較量一切佛刹功徳經', subid: 984, scrollCount: 1, firstBookId: 5193, collectionId: 51 },
  { part: 877, title: '囉嚩拏說救療小兒疾病經', subid: 985, scrollCount: 1, firstBookId: 5194, collectionId: 51 },
  { part: 878, title: '迦葉仙人說醫女人經', subid: 986, scrollCount: 1, firstBookId: 5195, collectionId: 51 },
  { part: 879, title: '佛說俱枳羅陀羅尼經', subid: 987, scrollCount: 1, firstBookId: 5196, collectionId: 51 },
  { part: 880, title: '佛說消除一切災障寳髻陀羅尼經', subid: 988, scrollCount: 1, firstBookId: 5197, collectionId: 51 },
  { part: 881, title: '佛說妙色陀羅尼經', subid: 990, scrollCount: 1, firstBookId: 5198, collectionId: 51 },
  { part: 882, title: '佛說栴檀香身陀羅尼經', subid: 991, scrollCount: 1, firstBookId: 5199, collectionId: 51 },
  { part: 883, title: '佛說鉢蘭那賖嚩哩大陀羅尼經', subid: 992, scrollCount: 1, firstBookId: 5200, collectionId: 51 },
  { part: 884, title: '佛說宿命智陀羅尼經', subid: 993, scrollCount: 1, firstBookId: 5201, collectionId: 51 },
  { part: 885, title: '佛說慈氏菩薩誓願陀羅尼經', subid: 994, scrollCount: 1, firstBookId: 5202, collectionId: 51 },
  { part: 886, title: '佛說滅除五逆罪大陀羅尼經', subid: 995, scrollCount: 1, firstBookId: 5203, collectionId: 51 },
  { part: 887, title: '佛說無量功徳陀羅尼經', subid: 996, scrollCount: 1, firstBookId: 5204, collectionId: 51 },
  { part: 888, title: '佛說十八臂陀羅尼經', subid: 997, scrollCount: 1, firstBookId: 5205, collectionId: 51 },
  { part: 889, title: '佛說洛叉陀羅尼經', subid: 998, scrollCount: 1, firstBookId: 5206, collectionId: 51 },
  { part: 890, title: '佛說辟除諸惡陀羅尼經', subid: 999, scrollCount: 1, firstBookId: 5207, collectionId: 51 },
  { part: 891, title: '佛說大愛陀羅尼經', subid: 1000, scrollCount: 1, firstBookId: 5208, collectionId: 51 },
  { part: 892, title: '佛說阿羅漢具徳經', subid: 1001, scrollCount: 1, firstBookId: 5209, collectionId: 51 },
  { part: 893, title: '佛說八大靈塔名號經', subid: 1002, scrollCount: 1, firstBookId: 5210, collectionId: 51 },
  { part: 894, title: '佛說尊那經', subid: 1003, scrollCount: 1, firstBookId: 5211, collectionId: 51 },
  { part: 895, title: '佛說頻婆娑羅王經', subid: 1004, scrollCount: 1, firstBookId: 5212, collectionId: 51 },
  { part: 896, title: '佛說人仙經', subid: 1005, scrollCount: 1, firstBookId: 5213, collectionId: 51 },
  { part: 897, title: '佛說舊城喻經', subid: 1006, scrollCount: 1, firstBookId: 5214, collectionId: 51 },
  { part: 898, title: '佛說信解智力經', subid: 1007, scrollCount: 1, firstBookId: 5215, collectionId: 51 },
  { part: 899, title: '大正句王經', subid: 1008, scrollCount: 2, firstBookId: 5216, collectionId: 51 },
  { part: 900, title: '佛說善樂長者經', subid: 1009, scrollCount: 1, firstBookId: 5218, collectionId: 51 },
  { part: 901, title: '佛說聖多羅菩薩經', subid: 1010, scrollCount: 1, firstBookId: 5219, collectionId: 51 },
  { part: 902, title: '佛說大吉祥陀羅尼經', subid: 1011, scrollCount: 1, firstBookId: 5220, collectionId: 51 },
  { part: 903, title: '寳賢陀羅尼經', subid: 1012, scrollCount: 1, firstBookId: 5221, collectionId: 51 },
  { part: 904, title: '佛說秘宻八名陀羅尼經', subid: 1013, scrollCount: 1, firstBookId: 5222, collectionId: 51 },
  { part: 905, title: '觀自在菩薩母陀羅尼經', subid: 1014, scrollCount: 1, firstBookId: 5223, collectionId: 51 },
  { part: 906, title: '佛說戒香經', subid: 1015, scrollCount: 1, firstBookId: 5224, collectionId: 51 },
  { part: 907, title: '佛說妙吉祥菩薩陀羅尼', subid: 1016, scrollCount: 1, firstBookId: 5225, collectionId: 51 },
  { part: 908, title: '佛說無量壽大智陀羅尼', subid: 1017, scrollCount: 1, firstBookId: 5226, collectionId: 51 },
  { part: 909, title: '佛說宿命智陀羅尼', subid: 1018, scrollCount: 1, firstBookId: 5227, collectionId: 51 },
  { part: 910, title: '佛說慈氏菩薩陀羅尼', subid: 1019, scrollCount: 1, firstBookId: 5228, collectionId: 51 },
  { part: 911, title: '佛說虚空藏菩薩陀羅尼', subid: 1020, scrollCount: 1, firstBookId: 5229, collectionId: 51 },
  { part: 912, title: '寳授菩薩菩提行經', subid: 1021, scrollCount: 1, firstBookId: 5230, collectionId: 51 },
  { part: 913, title: '佛說延壽妙門陀羅尼經', subid: 1022, scrollCount: 1, firstBookId: 5231, collectionId: 51 },
  { part: 914, title: '一切如來名號陀羅尼經', subid: 1023, scrollCount: 1, firstBookId: 5232, collectionId: 51 },
  { part: 915, title: '佛說息除賊難陀羅尼經', subid: 1024, scrollCount: 1, firstBookId: 5233, collectionId: 51 },
  { part: 916, title: '佛說法身經', subid: 1025, scrollCount: 1, firstBookId: 5234, collectionId: 51 },
  { part: 917, title: '信佛功德經', subid: 1026, scrollCount: 1, firstBookId: 5235, collectionId: 51 },
  { part: 918, title: '佛說解夏經', subid: 1027, scrollCount: 1, firstBookId: 5236, collectionId: 51 },
  { part: 919, title: '佛說帝釋所問經', subid: 1028, scrollCount: 1, firstBookId: 5237, collectionId: 51 },
  { part: 920, title: '佛說未曽有正法經', subid: 1029, scrollCount: 6, firstBookId: 5238, collectionId: 51 },
  { part: 921, title: '佛說大方廣善巧方便經', subid: 1030, scrollCount: 4, firstBookId: 5244, collectionId: 51 },
  { part: 922, title: '佛母出生三法藏般若波羅蜜多經', subid: 1031, scrollCount: 25, firstBookId: 5248, collectionId: 51 },
  { part: 923, title: '佛說決定義經', subid: 1032, scrollCount: 1, firstBookId: 5273, collectionId: 51 },
  { part: 924, title: '佛說護國經', subid: 1033, scrollCount: 1, firstBookId: 5274, collectionId: 51 },
  { part: 925, title: '佛說分别布施經', subid: 1034, scrollCount: 1, firstBookId: 5275, collectionId: 51 },
  { part: 926, title: '佛說分别縁生經', subid: 1035, scrollCount: 1, firstBookId: 5276, collectionId: 51 },
  { part: 927, title: '佛說法印經', subid: 1036, scrollCount: 1, firstBookId: 5277, collectionId: 51 },
  { part: 928, title: '佛說大生義經', subid: 1037, scrollCount: 1, firstBookId: 5278, collectionId: 51 },
  { part: 929, title: '佛說發菩提心破諸魔經', subid: 1038, scrollCount: 2, firstBookId: 5279, collectionId: 51 },
  { part: 930, title: '佛說聖佛母般若波羅蜜多經', subid: 1039, scrollCount: 1, firstBookId: 5281, collectionId: 51 },
  { part: 931, title: '佛說大乗不思議神通境界經', subid: 1040, scrollCount: 3, firstBookId: 5282, collectionId: 51 },
  { part: 932, title: '佛說給孤長者女得度因縁經', subid: 1041, scrollCount: 3, firstBookId: 5285, collectionId: 51 },
  { part: 933, title: '佛說大集法門經', subid: 1042, scrollCount: 2, firstBookId: 5288, collectionId: 51 },
  { part: 934, title: '佛說光明童子因縁經', subid: 1043, scrollCount: 4, firstBookId: 5290, collectionId: 51 },
  { part: 935, title: '佛說寳帶陀羅尼經', subid: 1044, scrollCount: 1, firstBookId: 5294, collectionId: 51 },
  { part: 936, title: '佛說金身陀羅尼經', subid: 1045, scrollCount: 1, firstBookId: 5295, collectionId: 51 },
  { part: 937, title: '佛說入無分别法門經', subid: 1046, scrollCount: 1, firstBookId: 5296, collectionId: 51 },
  { part: 938, title: '佛說淨意優婆塞所問經', subid: 1047, scrollCount: 1, firstBookId: 5297, collectionId: 51 },
  { part: 939, title: '佛說金剛場莊嚴般若波羅蜜多教中一分', subid: 1048, scrollCount: 1, firstBookId: 5298, collectionId: 51 },
  { part: 940, title: '佛說息諍因縁經', subid: 1049, scrollCount: 1, firstBookId: 5299, collectionId: 51 },
  { part: 941, title: '佛說初分說經', subid: 1050, scrollCount: 2, firstBookId: 5300, collectionId: 51 },
  { part: 942, title: '佛說無畏授所問大乘經', subid: 1051, scrollCount: 3, firstBookId: 5302, collectionId: 51 },
  { part: 943, title: '佛說月喻經', subid: 1052, scrollCount: 1, firstBookId: 5305, collectionId: 51 },
  { part: 944, title: '佛說醫喻經', subid: 1053, scrollCount: 1, firstBookId: 5306, collectionId: 51 },
  { part: 945, title: '佛說灌頂王喻經', subid: 1054, scrollCount: 1, firstBookId: 5307, collectionId: 51 },
  { part: 946, title: '佛說尼拘陀梵志經', subid: 1055, scrollCount: 2, firstBookId: 5308, collectionId: 51 },
  { part: 947, title: '佛說白衣金幢二婆羅門縁起經', subid: 1056, scrollCount: 3, firstBookId: 5310, collectionId: 51 },
  { part: 948, title: '佛說福力太子因縁經', subid: 1057, scrollCount: 3, firstBookId: 5313, collectionId: 51 },
  { part: 949, title: '佛說身毛喜豎經', subid: 1058, scrollCount: 3, firstBookId: 5316, collectionId: 51 },
  { part: 950, title: '大乗本生心地觀經', subid: 1059, scrollCount: 9, firstBookId: 5319, collectionId: 51, has0aPreface: true },
  { part: 951, title: '佛說出生無邊門陀羅尼經', subid: 1060, scrollCount: 1, firstBookId: 5328, collectionId: 51 },
  { part: 952, title: '一切如來心祕宻全身舍利寳篋印陀羅尼經', subid: 1061, scrollCount: 1, firstBookId: 5329, collectionId: 51 },
  { part: 953, title: '佛說大吉祥天女十二名號經', subid: 1062, scrollCount: 1, firstBookId: 5330, collectionId: 51 },
  { part: 954, title: '佛說大吉祥天女十二契一百八名無垢大乗經', subid: 1063, scrollCount: 1, firstBookId: 5331, collectionId: 51 },
  { part: 955, title: '佛說一切如來金剛壽命陀羅尼經', subid: 1064, scrollCount: 1, firstBookId: 5332, collectionId: 51 },
  { part: 956, title: '佛說穰麌梨童女經', subid: 1065, scrollCount: 1, firstBookId: 5333, collectionId: 51 },
  { part: 957, title: '佛說雨寳陀羅尼經', subid: 1066, scrollCount: 1, firstBookId: 5334, collectionId: 51 },
  { part: 958, title: '慈氏菩薩所說大乗縁生稻[卄/幹]喻經', subid: 1067, scrollCount: 1, firstBookId: 5335, collectionId: 51 },
  { part: 959, title: '佛說除蓋障菩薩所問經', subid: 1068, scrollCount: 20, firstBookId: 5336, collectionId: 51 },
  { part: 960, title: '仁王護國般若波羅蜜多經', subid: 1069, scrollCount: 3, firstBookId: 5356, collectionId: 51, has0aPreface: true },
  { part: 961, title: '穢跡金剛說神通大滿陀羅尼法術靈要門經', subid: 1070, scrollCount: 1, firstBookId: 5359, collectionId: 51 },
  { part: 962, title: '穢跡金剛法禁百變法門經', subid: 1071, scrollCount: 1, firstBookId: 5360, collectionId: 51 },
  { part: 963, title: '佛說大乗大方廣佛冠經', subid: 1072, scrollCount: 2, firstBookId: 5361, collectionId: 51 },
  { part: 964, title: '佛說八種長養功德經', subid: 1073, scrollCount: 1, firstBookId: 5363, collectionId: 51 },
  { part: 965, title: '大雲輪請雨經', subid: 1074, scrollCount: 2, firstBookId: 5364, collectionId: 51 },
  { part: 966, title: '大乗密嚴經', subid: 1075, scrollCount: 4, firstBookId: 5366, collectionId: 51, has0aPreface: true },
  { part: 967, title: '佛說大集會正法經', subid: 1076, scrollCount: 5, firstBookId: 5370, collectionId: 51 },
  { part: 968, title: '葉衣觀自在菩薩經', subid: 1077, scrollCount: 1, firstBookId: 5375, collectionId: 51 },
  { part: 969, title: '毗沙門天王經', subid: 1078, scrollCount: 1, firstBookId: 5376, collectionId: 51 },
  { part: 970, title: '文殊問經字母品', subid: 1079, scrollCount: 1, firstBookId: 5377, collectionId: 51 },
  { part: 971, title: '海意菩薩所問淨印法門經', subid: 1080, scrollCount: 9, firstBookId: 5378, collectionId: 51 },
  { part: 972, title: '佛說如幻三摩地無量印法門經', subid: 1081, scrollCount: 3, firstBookId: 5387, collectionId: 51 },
  { part: 973, title: '守護國界主陀羅尼經', subid: 1082, scrollCount: 10, firstBookId: 5390, collectionId: 51 },
  { part: 974, title: '佛說三十五佛名禮懴文', subid: 1083, scrollCount: 1, firstBookId: 5400, collectionId: 51 },
  { part: 975, title: '觀自在菩薩說普賢陀羅尼經', subid: 1084, scrollCount: 1, firstBookId: 5401, collectionId: 51 },
  { part: 976, title: '佛說八大菩薩曼荼羅經', subid: 1085, scrollCount: 1, firstBookId: 5402, collectionId: 51 },
  { part: 977, title: '佛說能淨一切眼疾病陀羅尼經', subid: 1086, scrollCount: 1, firstBookId: 5403, collectionId: 51 },
  { part: 978, title: '佛說除一切疾病陀羅尼經', subid: 1087, scrollCount: 1, firstBookId: 5404, collectionId: 51 },
  { part: 979, title: '佛說救拔焰口餓鬼陀羅尼經', subid: 1088, scrollCount: 1, firstBookId: 5405, collectionId: 51 },
  { part: 980, title: '瑜伽集要救阿難陀羅尼焰口儀軌經', subid: 1089, scrollCount: 1, firstBookId: 5406, collectionId: 51 },
  { part: 981, title: '佛說蟻喻經', subid: 1090, scrollCount: 1, firstBookId: 5407, collectionId: 51 },
  { part: 982, title: '聖觀自在菩薩不空王秘宻心陀羅尼', subid: 1091, scrollCount: 1, firstBookId: 5408, collectionId: 51 },
  { part: 983, title: '佛說勝軍王所問經', subid: 1092, scrollCount: 1, firstBookId: 5409, collectionId: 51 },
  { part: 984, title: '佛說輪王七寳經', subid: 1093, scrollCount: 1, firstBookId: 5410, collectionId: 51 },
  { part: 985, title: '佛說園生樹經', subid: 1094, scrollCount: 1, firstBookId: 5411, collectionId: 51 },
  { part: 986, title: '佛說了義般若波羅蜜多經', subid: 1095, scrollCount: 1, firstBookId: 5412, collectionId: 51 },
  { part: 987, title: '佛說大方廣未曽有經善巧方便品', subid: 1096, scrollCount: 1, firstBookId: 5413, collectionId: 51 },
  { part: 988, title: '佛說大堅固婆羅門縁起經', subid: 1097, scrollCount: 2, firstBookId: 5414, collectionId: 51 },
  { part: 989, title: '佛說巨力長者所問大乗經', subid: 1098, scrollCount: 3, firstBookId: 5416, collectionId: 51 },
  { part: 990, title: '佛說妙吉祥菩薩所問大乗法螺經', subid: 1099, scrollCount: 1, firstBookId: 5419, collectionId: 51 },
  { part: 991, title: '佛說四品法門經', subid: 1100, scrollCount: 1, firstBookId: 5420, collectionId: 51 },
  { part: 992, title: '佛說八大菩薩經', subid: 1101, scrollCount: 1, firstBookId: 5421, collectionId: 51 },
  { part: 993, title: '佛說施一切無畏陀羅尼經', subid: 1102, scrollCount: 1, firstBookId: 5422, collectionId: 51 },
  { part: 994, title: '聖八千頌般若波羅蜜多一百八名眞實圎義陀羅尼經', subid: 1103, scrollCount: 1, firstBookId: 5423, collectionId: 51 },
  { part: 995, title: '佛說一髻尊陀羅尼經', subid: 1104, scrollCount: 1, firstBookId: 5424, collectionId: 51 },
  { part: 996, title: '金剛摧碎陀羅尼', subid: 1105, scrollCount: 1, firstBookId: 5425, collectionId: 51 },
  { part: 997, title: '不空罥索毘盧遮那佛大灌頂光眞言經', subid: 1106, scrollCount: 1, firstBookId: 5426, collectionId: 51 },
  { part: 998, title: '地藏菩薩本願經', subid: 1107, scrollCount: 2, firstBookId: 5427, collectionId: 51 },
  { part: 999, title: '大乘理趣六波羅蜜多經', subid: 1108, scrollCount: 11, firstBookId: 5429, collectionId: 51, has0aPreface: true },
  { part: 1000, title: '佛說大乗菩薩藏正法經', subid: 1109, scrollCount: 40, firstBookId: 5440, collectionId: 51 },
  { part: 1001, title: '佛爲優塡王說王法政論經', subid: 1110, scrollCount: 1, firstBookId: 5480, collectionId: 51 },
  { part: 1002, title: '佛說五大施經', subid: 1111, scrollCount: 1, firstBookId: 5481, collectionId: 51 },
  { part: 1003, title: '佛說無畏陀羅尼經', subid: 1112, scrollCount: 1, firstBookId: 5482, collectionId: 51 },
  { part: 1004, title: '佛說大威德金輪佛頂熾盛光如來消除一切災難陀羅尼經', subid: 1113, scrollCount: 1, firstBookId: 5483, collectionId: 51 },
  { part: 1005, title: '佛說熾盛光大威德消災吉祥陀羅尼經', subid: 1114, scrollCount: 2, firstBookId: 5484, collectionId: 51, has0aPreface: true },
  { part: 1006, title: '佛說頂生王因縁經', subid: 1115, scrollCount: 6, firstBookId: 5486, collectionId: 51 },
  { part: 1007, title: '佛說大乗隨轉宣說諸法經', subid: 1116, scrollCount: 3, firstBookId: 5492, collectionId: 51 },
  { part: 1008, title: '佛說大乗入諸佛境界智光明莊嚴經', subid: 1117, scrollCount: 5, firstBookId: 5495, collectionId: 51 },
  { part: 1009, title: '佛說大乗智印經', subid: 1118, scrollCount: 5, firstBookId: 5500, collectionId: 51 },
  { part: 1010, title: '佛說法乗義決定經', subid: 1119, scrollCount: 3, firstBookId: 5505, collectionId: 51 },
  { part: 1011, title: '佛說大白傘蓋緫持陀羅尼', subid: 1120, scrollCount: 1, firstBookId: 5508, collectionId: 51 },
  { part: 1012, title: '佛說一切如來眞實攝大乗現證三昧大教王經', subid: 1121, scrollCount: 30, firstBookId: 5509, collectionId: 51 },
  { part: 1013, title: '一切如來大祕密王未曽有最上微妙大曼拏羅經', subid: 1122, scrollCount: 5, firstBookId: 5539, collectionId: 51 },
  { part: 1014, title: '出生一切如來法眼徧照大力明王經', subid: 1123, scrollCount: 2, firstBookId: 5544, collectionId: 51 },
  { part: 1015, title: '金剛頂一切如來眞實攝大乗現證大敎王經', subid: 1124, scrollCount: 3, firstBookId: 5546, collectionId: 51 },
  { part: 1016, title: '阿唎多羅陀羅尼阿嚕力經', subid: 1125, scrollCount: 1, firstBookId: 5549, collectionId: 51 },
  { part: 1017, title: '佛說瑜伽大敎王經', subid: 1126, scrollCount: 5, firstBookId: 5550, collectionId: 51 },
  { part: 1018, title: '一字竒特佛頂經', subid: 1127, scrollCount: 3, firstBookId: 5555, collectionId: 51 },
  { part: 1019, title: '菩提場所說一字頂輪王經', subid: 1128, scrollCount: 5, firstBookId: 5558, collectionId: 51 },
  { part: 1020, title: '菩提場莊嚴陀羅尼經', subid: 1129, scrollCount: 1, firstBookId: 5563, collectionId: 51 },
  { part: 1021, title: '佛說祕宻相經', subid: 1130, scrollCount: 3, firstBookId: 5564, collectionId: 51 },
  { part: 1022, title: '佛說一切如來金剛三業最上祕宻大教王經', subid: 1131, scrollCount: 7, firstBookId: 5567, collectionId: 51 },
  { part: 1023, title: '大寳廣博樓閣善住祕宻陀羅尼經', subid: 1132, scrollCount: 3, firstBookId: 5574, collectionId: 51 },
  { part: 1024, title: '佛說祕宻三昧大教王經', subid: 1133, scrollCount: 4, firstBookId: 5577, collectionId: 51 },
  { part: 1025, title: '佛說無二平等最上瑜伽大教王經', subid: 1134, scrollCount: 6, firstBookId: 5581, collectionId: 51 },
  { part: 1026, title: '佛說金剛手菩薩降伏一切部多大教王經', subid: 1135, scrollCount: 3, firstBookId: 5587, collectionId: 51 },
  { part: 1027, title: '聖妙吉祥眞實名經', subid: 1136, scrollCount: 2, firstBookId: 5590, collectionId: 51, has0aPreface: true },
  { part: 1028, title: '金剛頂瑜伽理趣般若經', subid: 1137, scrollCount: 1, firstBookId: 5592, collectionId: 51 },
  { part: 1029, title: '大樂金剛不空眞實三麽耶般若波羅蜜多理趣經', subid: 1138, scrollCount: 1, firstBookId: 5593, collectionId: 51 },
  { part: 1030, title: '佛說佛母般若波羅蜜多大明觀想儀軌經', subid: 1139, scrollCount: 1, firstBookId: 5594, collectionId: 51 },
  { part: 1031, title: '金剛頂瑜伽念珠經', subid: 1140, scrollCount: 1, firstBookId: 5595, collectionId: 51 },
  { part: 1032, title: '佛說最上根本大樂金剛不空三昧大教王經', subid: 1141, scrollCount: 8, firstBookId: 5596, collectionId: 51, has0aPreface: true },
  { part: 1033, title: '佛說最上祕宻那拏天經', subid: 1142, scrollCount: 3, firstBookId: 5604, collectionId: 51 },
  { part: 1034, title: '金剛峯樓閣一切瑜伽瑜祇經', subid: 1143, scrollCount: 2, firstBookId: 5607, collectionId: 51 },
  { part: 1035, title: '佛說妙吉祥最勝根本大教經', subid: 1144, scrollCount: 3, firstBookId: 5609, collectionId: 51 },
  { part: 1036, title: '妙吉祥平等祕密最上觀門大教王經', subid: 1145, scrollCount: 5, firstBookId: 5612, collectionId: 51 },
  { part: 1037, title: '普徧光明焰鬘清淨熾盛如意寳印心無能勝大明王大隨求陀羅尼經', subid: 1146, scrollCount: 2, firstBookId: 5617, collectionId: 51 },
  { part: 1038, title: '佛說如來不思議祕宻大乗經', subid: 1147, scrollCount: 20, firstBookId: 5619, collectionId: 51 },
  { part: 1039, title: '大乗瑜伽金剛性海曼殊室利千臂千鉢大教王經', subid: 1148, scrollCount: 11, firstBookId: 5639, collectionId: 51, has0aPreface: true },
  { part: 1040, title: '佛說聖寳藏神儀軌經', subid: 1149, scrollCount: 2, firstBookId: 5650, collectionId: 51 },
  { part: 1041, title: '佛說寳藏神大明曼拏羅儀軌經', subid: 1150, scrollCount: 2, firstBookId: 5652, collectionId: 51 },
  { part: 1042, title: '金剛恐怖集會方廣軌儀觀自在菩薩三世最勝心明王經', subid: 1151, scrollCount: 1, firstBookId: 5654, collectionId: 51 },
  { part: 1043, title: '金剛恐怖集會方廣軌儀觀自在菩薩三世最勝心明王大威力烏樞瑟摩明王經', subid: 1152, scrollCount: 3, firstBookId: 5655, collectionId: 51 },
  { part: 1044, title: '佛說大乗觀想曼拏羅淨諸惡趣經', subid: 1153, scrollCount: 2, firstBookId: 5658, collectionId: 51 },
  { part: 1045, title: '佛說大方廣曼殊室利經觀自在多羅菩薩儀軌經', subid: 1155, scrollCount: 1, firstBookId: 5660, collectionId: 51 },
  { part: 1046, title: '佛說一切佛攝相應大教王經聖觀自在菩薩念誦儀軌經', subid: 1158, scrollCount: 1, firstBookId: 5661, collectionId: 51 },
  { part: 1047, title: '瑜伽金剛頂經釋字母品', subid: 1161, scrollCount: 1, firstBookId: 5662, collectionId: 51 },
  { part: 1048, title: '佛說一切如來安像三昧儀軌經', subid: 1163, scrollCount: 1, firstBookId: 5663, collectionId: 51 },
  { part: 1049, title: '文殊師利菩薩根本大教王金翅鳥王品', subid: 1167, scrollCount: 1, firstBookId: 5664, collectionId: 51 },
  { part: 1050, title: '十一面觀自在菩薩心宻言念誦儀軌經', subid: 1170, scrollCount: 3, firstBookId: 5665, collectionId: 51 },
  { part: 1051, title: '大方廣菩薩藏文殊師利根本儀軌經', subid: 1173, scrollCount: 20, firstBookId: 5668, collectionId: 51 },
  { part: 1052, title: '佛說持明藏瑜伽大教尊那菩薩大明成就儀軌經', subid: 1176, scrollCount: 4, firstBookId: 5688, collectionId: 51 },
  { part: 1053, title: '佛說金剛香菩薩大明成就儀軌經', subid: 1179, scrollCount: 3, firstBookId: 5692, collectionId: 51 },
  { part: 1054, title: '金剛薩埵說頻那夜迦天成就儀軌經', subid: 1184, scrollCount: 4, firstBookId: 5695, collectionId: 51 },
  { part: 1055, title: '佛說大悲空智金剛大教王儀軌經', subid: 1186, scrollCount: 5, firstBookId: 5699, collectionId: 51 },
  { part: 1056, title: '佛說幻化網大瑜伽教十忿怒明王大明觀想儀軌經', subid: 1189, scrollCount: 1, firstBookId: 5704, collectionId: 51 },
  { part: 1057, title: '佛說妙吉祥瑜伽大教金剛陪囉嚩輪觀想成就儀軌經', subid: 1192, scrollCount: 1, firstBookId: 5705, collectionId: 51 },
  { part: 1058, title: '底哩三昧耶不動尊威怒王使者念誦法', subid: 1194, scrollCount: 1, firstBookId: 5706, collectionId: 51 },
  { part: 1059, title: '聖迦柅忿怒金剛童子菩薩成就儀軌經', subid: 1195, scrollCount: 3, firstBookId: 5707, collectionId: 51 },
  { part: 1060, title: '七佛讃唄伽陀', subid: 1197, scrollCount: 1, firstBookId: 5710, collectionId: 51 },
  { part: 1061, title: '佛三身讃', subid: 1200, scrollCount: 1, firstBookId: 5711, collectionId: 51 },
  { part: 1062, title: '佛一百八名讃經', subid: 1204, scrollCount: 1, firstBookId: 5712, collectionId: 51 },
  { part: 1063, title: '聖救度佛母二十一種禮讃經', subid: 1206, scrollCount: 2, firstBookId: 5713, collectionId: 51, has0aPreface: true },
  { part: 1064, title: '佛說一切如來頂輪王一百八名讃經', subid: 1207, scrollCount: 1, firstBookId: 5715, collectionId: 51 },
  { part: 1065, title: '讃法界頌', subid: 1208, scrollCount: 1, firstBookId: 5716, collectionId: 51 },
  { part: 1066, title: '八大靈塔梵讃', subid: 1209, scrollCount: 1, firstBookId: 5717, collectionId: 51 },
  { part: 1067, title: '三身梵讃', subid: 1210, scrollCount: 1, firstBookId: 5718, collectionId: 51 },
  { part: 1068, title: '佛說文殊師利一百八名梵讃', subid: 1211, scrollCount: 1, firstBookId: 5719, collectionId: 51 },
  { part: 1069, title: '曼殊室利菩薩吉祥伽陀', subid: 1212, scrollCount: 1, firstBookId: 5720, collectionId: 51 },
  { part: 1070, title: '聖金剛手菩薩一百八名梵讃', subid: 1213, scrollCount: 1, firstBookId: 5721, collectionId: 51 },
  { part: 1071, title: '聖觀自在菩薩功徳讃', subid: 1214, scrollCount: 3, firstBookId: 5722, collectionId: 51, has0aPreface: true, mergeFileCount: 3 },
  { part: 1072, title: '讃觀世音菩薩頌', subid: 1215, scrollCount: 1, firstBookId: 5725, collectionId: 51 },
  { part: 1073, title: '佛說聖觀自在菩薩梵讃', subid: 1216, scrollCount: 1, firstBookId: 5726, collectionId: 51 },
  { part: 1074, title: '聖多羅菩薩梵讃', subid: 1217, scrollCount: 1, firstBookId: 5727, collectionId: 51 },
  { part: 1075, title: '事師法五十頌', subid: 1218, scrollCount: 1, firstBookId: 5728, collectionId: 51 },
  { part: 1076, title: '揵椎梵讃', subid: 1219, scrollCount: 1, firstBookId: 5729, collectionId: 51 },
];
function getCatalogEntry(part) {
  return SCRIPTURE_CATALOG.find(e => e.part === part);
}

/**
 * Returns the effective number of claimable scrolls for a catalog entry.
 * Supports both new (bookIdGroups) and legacy (formula-based) entries.
 */
function getEffectiveScrollCount(entry) {
  if (entry.bookIdGroups) return entry.bookIdGroups.length;
  const mergeCount = entry.mergeFileCount || 2;
  return entry.has0aPreface ? entry.scrollCount - (mergeCount - 1) : entry.scrollCount;
}

/**
 * Returns the array of upstream bookIds to fetch and merge for a given scroll.
 * Most scrolls return a single-element array; merged scrolls (0a+0b, 1a+1b, etc.) return multiple.
 * Supports both new (bookIdGroups) and legacy (formula-based) entries.
 */
function getScrollBookIds(entry, scroll) {
  if (entry.bookIdGroups) return entry.bookIdGroups[scroll - 1] || null;
  const mergeCount = entry.mergeFileCount || 2;
  if (entry.has0aPreface && scroll === 1) {
    return Array.from({ length: mergeCount }, (_, i) => entry.firstBookId + i);
  }
  const bookId = entry.has0aPreface
    ? entry.firstBookId + mergeCount + (scroll - 2)
    : entry.firstBookId + scroll - 1;
  return [bookId];
}

// ============================================
// SCRIPTURE TEXT AND PDF ENDPOINTS
// ============================================

// Cache for scripture content to reduce upstream requests
let scriptureCache = new Map();
const SCRIPTURE_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Cache for audio URLs: key = "part_scroll" → upstream audio URL string
// Populated when scripture text is fetched (which already retrieves audio URLs)
// Used by mp3 proxy to skip the redundant metadata request
let audioUrlCache = new Map();

// Scripture content for catalog entries
app.get('/api/scripture/:part/:scroll', async (req, res) => {
  const part = parseInt(req.params.part);
  const scroll = parseInt(req.params.scroll);
  const entry = getCatalogEntry(part);

  if (!entry) return res.status(400).json({ error: `Unknown part ${part}` });
  const effectiveScrolls = getEffectiveScrollCount(entry);
  if (isNaN(scroll) || scroll < 1 || scroll > effectiveScrolls) {
    return res.status(400).json({ error: `Invalid scroll ${scroll} for part ${part} (1-${effectiveScrolls})` });
  }

  const bookIds = getScrollBookIds(entry, scroll);
  const subid = (entry.subidOverrides && entry.subidOverrides[scroll]) || entry.subid;
  const menuid = `${entry.collectionId}|${subid}`;
  const cacheKey = `scripture_cat_${part}_${scroll}`;

  const cached = scriptureCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
    return res.json({ ...cached.data, cached: true });
  }

  console.log(`Fetching scripture for part ${part} scroll ${scroll}, bookIds ${bookIds}, menuid ${menuid}`);

  try {
    const results = await Promise.all(bookIds.map(id => fetchBookWithAudio(id, menuid)));
    const html = results.map(r => r.html).join('');
    // Cache primary audio URL so mp3 proxy can skip the redundant metadata request
    const primaryAudioUrl = results[0]?.audioUrl || '';
    if (primaryAudioUrl) audioUrlCache.set(`${part}_${scroll}`, primaryAudioUrl);
    // Use local proxy URL for primary audio to avoid SSL certificate issues
    const audioSrc = `/api/scripture/${part}/${scroll}/mp3`;
    const secondaryAudioSrc = results[1]?.audioUrl || null;
    const tertiaryAudioSrc = results[2]?.audioUrl || null;
    const data = { html, scroll, part, bookId: bookIds[0], audioSrc, secondaryAudioSrc, tertiaryAudioSrc, prefaceHtml: null };
    scriptureCache.set(cacheKey, { data, timestamp: Date.now() });
    res.json({ ...data, cached: false });
  } catch (error) {
    console.error('Failed to fetch scripture:', error);
    res.status(500).json({ error: 'Failed to fetch scripture text: ' + error.message });
  }
});

// Text download for catalog entries
app.get('/api/scripture/:part/:scroll/txt', async (req, res) => {
  const part = parseInt(req.params.part);
  const scroll = parseInt(req.params.scroll);
  const entry = getCatalogEntry(part);

  if (!entry) return res.status(400).json({ error: `Unknown part ${part}` });
  const effectiveScrolls = getEffectiveScrollCount(entry);
  if (isNaN(scroll) || scroll < 1 || scroll > effectiveScrolls) {
    return res.status(400).json({ error: `Invalid scroll ${scroll}` });
  }

  const bookIds = getScrollBookIds(entry, scroll);
  const subid = (entry.subidOverrides && entry.subidOverrides[scroll]) || entry.subid;
  const menuid = `${entry.collectionId}|${subid}`;

  try {
    const cacheKey = `scripture_cat_${part}_${scroll}`;
    let scriptureHtml;
    const cached = scriptureCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
      scriptureHtml = cached.data.html;
    } else {
      const htmlParts = await Promise.all(bookIds.map(id => fetchBookHtml(id, menuid)));
      scriptureHtml = htmlParts.join('');
    }

    const plainText = scriptureHtml
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<i><span>[^<]*<\/span><span>([^<]*)<\/span><\/i>/gi, '$1')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const title = entry.title;
    const scrollLabel = effectiveScrolls > 1 ? ` 卷${scroll}` : '';
    const fullText = `${title}${scrollLabel}\n${'='.repeat(40)}\n\n${plainText}`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const txtFilename = `${title}${scrollLabel}.txt`;
    const encodedTxtFilename = encodeURIComponent(txtFilename);
    res.setHeader('Content-Disposition', `attachment; filename="${part}_${scroll}.txt"; filename*=UTF-8''${encodedTxtFilename}`);
    res.send(fullText);
  } catch (error) {
    console.error('Failed to generate TXT:', error);
    res.status(500).json({ error: 'Failed to generate text file: ' + error.message });
  }
});

// Audio proxy for catalog entries
app.get('/api/scripture/:part/:scroll/mp3', async (req, res) => {
  const part = parseInt(req.params.part);
  const scroll = parseInt(req.params.scroll);
  const entry = getCatalogEntry(part);

  if (!entry) return res.status(400).json({ error: `Unknown part ${part}` });
  const effectiveScrolls = getEffectiveScrollCount(entry);
  if (isNaN(scroll) || scroll < 1 || scroll > effectiveScrolls) {
    return res.status(400).json({ error: `Invalid scroll ${scroll}` });
  }

  // Audio is per-file; use the first bookId of the scroll group
  const bookId = getScrollBookIds(entry, scroll)[0];
  const subid = (entry.subidOverrides && entry.subidOverrides[scroll]) || entry.subid;
  const menuid = `${entry.collectionId}|${subid}`;
  try {
    // Use cached audio URL if available (populated when scripture text was loaded)
    // This skips the redundant metadata request that was the main cause of slow audio start
    const audioCacheKey = `${part}_${scroll}`;
    let audioUrl = audioUrlCache.get(audioCacheKey) || '';

    if (!audioUrl) {
      // Fallback: fetch metadata if not cached (e.g. direct mp3 link without loading text first)
      const metaResp = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: `menuid=${menuid}&book=${bookId}&lang=zh`
      });
      if (!metaResp.ok) throw new Error(`Upstream returned ${metaResp.status}`);
      const metaBuffer = await metaResp.arrayBuffer();
      const metaJson = JSON.parse(iconv.decode(Buffer.from(metaBuffer), 'gbk'));
      audioUrl = metaJson.links || metaJson.audiolinks || '';
      if (audioUrl) audioUrlCache.set(audioCacheKey, audioUrl);
    }
    if (!audioUrl) throw new Error('No audio URL found');

    // Handle full URLs vs path-only URLs
    const upstream = audioUrl.startsWith('http') ? audioUrl : `https://w1.xianmijingzang.com${audioUrl}${audioUrl.includes('?') ? '' : '?_mt='}`;
    const response = await fetch(upstream);
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    // Stream-friendly headers: no Content-Disposition (was forcing download), forward Content-Length
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'none');
    const contentLength = response.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    const { Readable } = await import('stream');
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error('Failed to proxy MP3:', error);
    res.status(500).json({ error: 'Failed to download audio' });
  }
});

// PDF page for catalog entries
app.get('/api/scripture/:part/:scroll/pdf', async (req, res) => {
  const part = parseInt(req.params.part);
  const scroll = parseInt(req.params.scroll);
  const entry = getCatalogEntry(part);

  if (!entry) return res.status(400).json({ error: `Unknown part ${part}` });
  const effectiveScrolls = getEffectiveScrollCount(entry);
  if (isNaN(scroll) || scroll < 1 || scroll > effectiveScrolls) {
    return res.status(400).json({ error: `Invalid scroll ${scroll}` });
  }

  const bookIds = getScrollBookIds(entry, scroll);
  const menuid = `${entry.collectionId}|${entry.subid}`;

  try {
    const cacheKey = `scripture_cat_${part}_${scroll}`;
    let scriptureHtml;
    const cached = scriptureCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
      scriptureHtml = cached.data.html;
    } else {
      const htmlParts = await Promise.all(bookIds.map(id => fetchBookHtml(id, menuid)));
      scriptureHtml = htmlParts.join('');
    }

    let cleanedHtml = scriptureHtml;
    cleanedHtml = cleanedHtml.replace(
      /<span class=(?:["'])?(?:dou|dian)(?:["'])?>([^<]*)<\/span>(<\/span><\/i>)/gi,
      '$2$1'
    );
    const rubyHtml = cleanedHtml
      .replace(/<i><span[^>]*>([^<]*)<\/span><span[^>]*>([^<]*)<\/span><\/i>/gi, (_, py, hz) => {
        const pinyin = py.trim();
        return pinyin ? `<ruby>${hz}<rt>${pinyin}</rt></ruby>` : hz;
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

    const title = entry.title;
    const scrollLabel = effectiveScrolls > 1 ? `卷第${scroll}` : '';

    const fullHtml = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 1.5cm 1.5cm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Noto Serif SC", "PingFang SC", "Microsoft YaHei", serif; font-size: 16pt; line-height: 2.8; color: #333; background: #fdfbf7; }
    .header { text-align: center; margin-bottom: 30px; padding: 20px; background: linear-gradient(to bottom, #f5f0e8, #fdfbf7); border-bottom: 2px solid #c9a86c; }
    .title { font-size: 32pt; font-weight: bold; color: #8b4513; margin-bottom: 10px; letter-spacing: 10px; }
    .subtitle { font-size: 16pt; color: #a0522d; letter-spacing: 6px; }
    .content { padding: 20px 30px; text-align: left; background: #fff; border: 1px solid #e8e0d0; border-radius: 4px; margin: 0 10px; }
    .content p { margin-bottom: 1em; text-indent: 2em; }
    .content p.center { text-align: center; text-indent: 0; }
    ruby { ruby-align: center; }
    rt { font-size: 8pt; color: #888; font-family: Arial, sans-serif; }
    .footer { margin-top: 40px; padding: 15px; text-align: center; font-size: 10pt; color: #a0522d; border-top: 1px solid #c9a86c; }
    i { font-style: normal; }
    .ornament { text-align: center; color: #c9a86c; font-size: 14pt; margin: 15px 0; letter-spacing: 10px; }
    .print-btn { position: fixed; top: 16px; right: 16px; padding: 10px 24px; background: #8b7355; color: #fff; border: none; border-radius: 8px; font-size: 14pt; font-weight: bold; cursor: pointer; z-index: 1000; }
    .print-btn:hover { background: #5c4033; }
    @media print { .print-btn { display: none; } body { background: #fff; } .header { background: none; border-bottom: 1px solid #c9a86c; } }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">保存PDF</button>
  <div class="header">
    <div class="title">${title}</div>
    ${scrollLabel ? `<div class="subtitle">${scrollLabel}</div>` : ''}
  </div>
  <div class="ornament">❀ ❀ ❀</div>
  <div class="content">${centeredHtml}</div>
  <div class="ornament">❀ ❀ ❀</div>
  <div class="footer">
    — ${title} ${scrollLabel} —<br>
    <span style="font-size: 8pt; color: #999;">Generated from xianmijingzang.com</span>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(fullHtml);
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
  console.log(`Scripture catalog: ${SCRIPTURE_CATALOG.length} entries loaded`);
});
