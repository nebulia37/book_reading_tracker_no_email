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
// CATALOG FOR PARTS 83-108 (大乘华严部, collection 43)
// ============================================
const SCRIPTURE_CATALOG = [
  { part: 83, title: '大方廣佛華嚴經', subid: 152, scrollCount: 60, firstBookId: 3136, collectionId: 43 },
  { part: 84, title: '大方廣佛華嚴經', subid: 153, scrollCount: 81, firstBookId: 3196, collectionId: 43, has0aPreface: true, mergeFileCount: 2 },
  { part: 85, title: '大方廣佛華嚴經', subid: 154, scrollCount: 41, firstBookId: 3277, collectionId: 43, trailingMergeCount: 2 },
  { part: 86, title: '信力入印法門經', subid: 155, scrollCount: 5, firstBookId: 3318, collectionId: 43 },
  { part: 87, title: '大方廣佛華嚴經', subid: 156, scrollCount: 1, firstBookId: 3323, collectionId: 43 },
  { part: 88, title: '佛說如來興顯經', subid: 157, scrollCount: 4, firstBookId: 3324, collectionId: 43 },
  { part: 89, title: '大方廣入如來智德不思議經', subid: 158, scrollCount: 1, firstBookId: 3328, collectionId: 43 },
  { part: 90, title: '大方廣佛華嚴經修慈分', subid: 159, scrollCount: 1, firstBookId: 3329, collectionId: 43 },
  { part: 91, title: '顯無邊佛土功徳經', subid: 160, scrollCount: 1, firstBookId: 3330, collectionId: 43 },
  { part: 92, title: '大方廣佛華嚴經不思議佛境界分', subid: 161, scrollCount: 1, firstBookId: 3331, collectionId: 43 },
  { part: 93, title: '大方廣如來不思議境界經', subid: 162, scrollCount: 1, firstBookId: 3332, collectionId: 43 },
  { part: 94, title: '大方廣普賢所說經', subid: 163, scrollCount: 1, firstBookId: 3333, collectionId: 43 },
  { part: 95, title: '莊嚴菩提心經', subid: 164, scrollCount: 1, firstBookId: 3334, collectionId: 43 },
  { part: 96, title: '佛說菩薩本業經', subid: 165, scrollCount: 1, firstBookId: 3335, collectionId: 43 },
  { part: 97, title: '大方廣佛華嚴經續入法界品', subid: 166, scrollCount: 1, firstBookId: 3336, collectionId: 43 },
  { part: 98, title: '佛說兠沙經', subid: 167, scrollCount: 1, firstBookId: 3337, collectionId: 43 },
  { part: 99, title: '大方廣菩薩十地經', subid: 168, scrollCount: 1, firstBookId: 3338, collectionId: 43 },
  { part: 100, title: '度世品經', subid: 169, scrollCount: 6, firstBookId: 3339, collectionId: 43 },
  { part: 101, title: '十住經', subid: 170, scrollCount: 6, firstBookId: 3345, collectionId: 43 },
  { part: 102, title: '佛說羅摩伽經', subid: 171, scrollCount: 4, firstBookId: 3351, collectionId: 43 },
  { part: 103, title: '諸菩薩求佛本業經', subid: 172, scrollCount: 1, firstBookId: 3355, collectionId: 43 },
  { part: 104, title: '菩薩十住行道品經', subid: 173, scrollCount: 1, firstBookId: 3356, collectionId: 43 },
  { part: 105, title: '佛說菩薩十住經', subid: 174, scrollCount: 1, firstBookId: 3357, collectionId: 43 },
  { part: 106, title: '漸備一切智德經', subid: 175, scrollCount: 5, firstBookId: 3358, collectionId: 43 },
  { part: 107, title: '等目菩薩所問三昧經', subid: 176, scrollCount: 3, firstBookId: 3363, collectionId: 43 },
  { part: 108, title: '文殊師利問菩薩署經', subid: 177, scrollCount: 1, firstBookId: 3366, collectionId: 43 },
];
function getCatalogEntry(part) {
  return SCRIPTURE_CATALOG.find(e => e.part === part);
}

/**
 * Returns the effective number of claimable scrolls for a catalog entry.
 * Accounts for leading 0x-prefix merges (has0aPreface/mergeFileCount)
 * and trailing Xa/Xb merges (trailingMergeCount).
 */
function getEffectiveScrollCount(entry) {
  if (entry.bookIdGroups) return entry.bookIdGroups.length;
  const leadMerge = entry.has0aPreface ? (entry.mergeFileCount || 2) - 1 : 0;
  const trailMerge = entry.trailingMergeCount ? entry.trailingMergeCount - 1 : 0;
  return entry.scrollCount - leadMerge - trailMerge;
}

/**
 * Returns the array of upstream bookIds to fetch and merge for a given scroll.
 * Most scrolls return a single-element array; merged scrolls return multiple.
 * Handles leading (0a+0b), trailing (40a+40b), and bookIdGroups entries.
 */
function getScrollBookIds(entry, scroll) {
  if (entry.bookIdGroups) return entry.bookIdGroups[scroll - 1] || null;
  const leadMerge = entry.has0aPreface ? (entry.mergeFileCount || 2) : 0;
  const trailMerge = entry.trailingMergeCount || 1;
  const effectiveScrolls = getEffectiveScrollCount(entry);

  // Leading merge: scroll 1 gets the first `leadMerge` bookIds
  if (entry.has0aPreface && scroll === 1) {
    return Array.from({ length: leadMerge }, (_, i) => entry.firstBookId + i);
  }
  // Trailing merge: last scroll gets the last `trailMerge` bookIds
  if (trailMerge > 1 && scroll === effectiveScrolls) {
    const offset = entry.has0aPreface ? leadMerge + (scroll - 2) : scroll - 1;
    return Array.from({ length: trailMerge }, (_, i) => entry.firstBookId + offset + i);
  }
  // Normal scroll
  const bookId = entry.has0aPreface
    ? entry.firstBookId + leadMerge + (scroll - 2)
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
