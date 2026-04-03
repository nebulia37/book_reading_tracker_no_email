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
// + PARTS 538-674 (小乘阿含部, collection 47)
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
  // Parts 538-674: 小乘阿含部 (collection 47)
  { part: 538, title: '佛說甘露經陀羅尼', subid: 631, scrollCount: 60, firstBookId: 4415, collectionId: 47 },
  { part: 539, title: '大陀羅尼末法中一字心呪經', subid: 632, scrollCount: 50, firstBookId: 4475, collectionId: 47, has0aPreface: true, mergeFileCount: 2 },
  { part: 540, title: '佛說甚深大廻向經', subid: 633, scrollCount: 50, firstBookId: 4526, collectionId: 47 },
  { part: 541, title: '中阿含經', subid: 634, scrollCount: 22, firstBookId: 4576, collectionId: 47, has0aPreface: true, mergeFileCount: 2 },
  { part: 542, title: '増壹阿含經', subid: 635, scrollCount: 20, firstBookId: 4599, collectionId: 47 },
  { part: 543, title: '雜阿含經', subid: 636, scrollCount: 1, firstBookId: 4619, collectionId: 47 },
  { part: 544, title: '佛說長阿含經', subid: 637, scrollCount: 2, firstBookId: 4620, collectionId: 47 },
  { part: 545, title: '别譯雜阿含經', subid: 638, scrollCount: 10, firstBookId: 4622, collectionId: 47 },
  { part: 546, title: '雜阿含經', subid: 639, scrollCount: 10, firstBookId: 4632, collectionId: 47 },
  { part: 547, title: '長阿含十報法經', subid: 640, scrollCount: 6, firstBookId: 4642, collectionId: 47 },
  { part: 548, title: '起世因本經', subid: 641, scrollCount: 2, firstBookId: 4648, collectionId: 47 },
  { part: 549, title: '起世經', subid: 642, scrollCount: 1, firstBookId: 4650, collectionId: 47, has0aPreface: true, mergeFileCount: 2 },
  { part: 550, title: '佛說樓炭經', subid: 643, scrollCount: 1, firstBookId: 4652, collectionId: 47 },
  { part: 551, title: '佛般泥洹經', subid: 644, scrollCount: 1, firstBookId: 4653, collectionId: 47 },
  { part: 552, title: '佛說人本欲生經', subid: 645, scrollCount: 2, firstBookId: 4654, collectionId: 47 },
  { part: 553, title: '佛說梵網六十二見經', subid: 646, scrollCount: 1, firstBookId: 4656, collectionId: 47 },
  { part: 554, title: '佛說尸迦羅越六方禮經', subid: 647, scrollCount: 1, firstBookId: 4657, collectionId: 47 },
  { part: 555, title: '正法念處經', subid: 648, scrollCount: 1, firstBookId: 4658, collectionId: 47 },
  { part: 556, title: '中本起經', subid: 649, scrollCount: 1, firstBookId: 4659, collectionId: 47 },
  { part: 557, title: '佛說七知經', subid: 650, scrollCount: 1, firstBookId: 4660, collectionId: 47 },
  { part: 558, title: '佛說鹹水喻經', subid: 651, scrollCount: 1, firstBookId: 4661, collectionId: 47 },
  { part: 559, title: '佛說一切流攝守因經', subid: 652, scrollCount: 1, firstBookId: 4662, collectionId: 47 },
  { part: 560, title: '佛說閻羅王五天使者經', subid: 653, scrollCount: 1, firstBookId: 4663, collectionId: 47 },
  { part: 561, title: '佛說鐵城泥犂經', subid: 654, scrollCount: 1, firstBookId: 4664, collectionId: 47 },
  { part: 562, title: '佛說古來世時經', subid: 655, scrollCount: 1, firstBookId: 4665, collectionId: 47 },
  { part: 563, title: '佛說阿那律八念經', subid: 656, scrollCount: 1, firstBookId: 4666, collectionId: 47 },
  { part: 564, title: '佛說離睡經', subid: 657, scrollCount: 1, firstBookId: 4667, collectionId: 47 },
  { part: 565, title: '佛說是法非法經', subid: 658, scrollCount: 1, firstBookId: 4668, collectionId: 47 },
  { part: 566, title: '佛說樂想經', subid: 659, scrollCount: 1, firstBookId: 4669, collectionId: 47 },
  { part: 567, title: '佛說漏分布經', subid: 660, scrollCount: 1, firstBookId: 4670, collectionId: 47 },
  { part: 568, title: '佛說阿耨颰經', subid: 661, scrollCount: 1, firstBookId: 4671, collectionId: 47 },
  { part: 569, title: '佛說求欲經', subid: 662, scrollCount: 1, firstBookId: 4672, collectionId: 47 },
  { part: 570, title: '佛說受歳經', subid: 663, scrollCount: 1, firstBookId: 4673, collectionId: 47 },
  { part: 571, title: '佛說梵志計水淨經', subid: 664, scrollCount: 1, firstBookId: 4674, collectionId: 47 },
  { part: 572, title: '佛說伏婬經', subid: 665, scrollCount: 1, firstBookId: 4675, collectionId: 47 },
  { part: 573, title: '佛說魔嬈亂經', subid: 666, scrollCount: 1, firstBookId: 4676, collectionId: 47 },
  { part: 574, title: '佛說弊魔試目連', subid: 667, scrollCount: 1, firstBookId: 4677, collectionId: 47 },
  { part: 575, title: '佛說泥犂經', subid: 668, scrollCount: 1, firstBookId: 4678, collectionId: 47 },
  { part: 576, title: '佛說優婆夷墮舍迦經', subid: 669, scrollCount: 1, firstBookId: 4679, collectionId: 47 },
  { part: 577, title: '佛說齋經', subid: 670, scrollCount: 1, firstBookId: 4680, collectionId: 47 },
  { part: 578, title: '佛說苦隂經', subid: 671, scrollCount: 1, firstBookId: 4681, collectionId: 47 },
  { part: 579, title: '佛說苦隂因事經', subid: 672, scrollCount: 1, firstBookId: 4682, collectionId: 47 },
  { part: 580, title: '佛說釋摩男本經', subid: 673, scrollCount: 1, firstBookId: 4683, collectionId: 47 },
  { part: 581, title: '佛說鞞摩肅經', subid: 674, scrollCount: 1, firstBookId: 4684, collectionId: 47 },
  { part: 582, title: '佛說婆羅門子命終愛念不離經', subid: 675, scrollCount: 1, firstBookId: 4685, collectionId: 47 },
  { part: 583, title: '佛說十支居士八城人經', subid: 676, scrollCount: 1, firstBookId: 4686, collectionId: 47 },
  { part: 584, title: '佛說邪見經', subid: 677, scrollCount: 1, firstBookId: 4687, collectionId: 47 },
  { part: 585, title: '佛說箭喻經', subid: 678, scrollCount: 1, firstBookId: 4688, collectionId: 47 },
  { part: 586, title: '佛說普法義經', subid: 679, scrollCount: 1, firstBookId: 4689, collectionId: 47 },
  { part: 587, title: '大方等大集经', subid: 680, scrollCount: 1, firstBookId: 4690, collectionId: 47 },
  { part: 588, title: '大乘大方等日藏经', subid: 681, scrollCount: 1, firstBookId: 4691, collectionId: 47 },
  { part: 589, title: '大方等大集月藏经', subid: 682, scrollCount: 1, firstBookId: 4692, collectionId: 47 },
  { part: 590, title: '大乘大集地藏十轮经', subid: 683, scrollCount: 1, firstBookId: 4693, collectionId: 47 },
  { part: 591, title: '佛说大方广十轮经', subid: 684, scrollCount: 1, firstBookId: 4694, collectionId: 47 },
  { part: 592, title: '大集须弥藏经', subid: 685, scrollCount: 1, firstBookId: 4695, collectionId: 47 },
  { part: 593, title: '虚空孕菩萨经', subid: 686, scrollCount: 1, firstBookId: 4696, collectionId: 47 },
  { part: 594, title: '虚空藏菩萨经', subid: 687, scrollCount: 1, firstBookId: 4697, collectionId: 47 },
  { part: 595, title: '虚空藏菩萨神咒经', subid: 688, scrollCount: 1, firstBookId: 4698, collectionId: 47 },
  { part: 596, title: '宝星陀罗尼经', subid: 689, scrollCount: 1, firstBookId: 4699, collectionId: 47 },
  { part: 597, title: '佛說廣義法門經', subid: 690, scrollCount: 1, firstBookId: 4700, collectionId: 47 },
  { part: 598, title: '佛說戒德香經', subid: 691, scrollCount: 1, firstBookId: 4701, collectionId: 47 },
  { part: 599, title: '佛說四人出現世間經', subid: 692, scrollCount: 1, firstBookId: 4702, collectionId: 47 },
  { part: 600, title: '佛說諸法本經', subid: 693, scrollCount: 1, firstBookId: 4703, collectionId: 47 },
  { part: 601, title: '佛說瞿曇彌記果經', subid: 694, scrollCount: 1, firstBookId: 4704, collectionId: 47 },
  { part: 602, title: '佛說梵志阿颰經', subid: 695, scrollCount: 1, firstBookId: 4705, collectionId: 47 },
  { part: 603, title: '佛說寂志果經', subid: 696, scrollCount: 1, firstBookId: 4706, collectionId: 47 },
  { part: 604, title: '佛說賴吒和羅經', subid: 697, scrollCount: 1, firstBookId: 4707, collectionId: 47 },
  { part: 605, title: '佛說善生子經', subid: 698, scrollCount: 1, firstBookId: 4708, collectionId: 47 },
  { part: 606, title: '佛說數經', subid: 699, scrollCount: 1, firstBookId: 4709, collectionId: 47 },
  { part: 607, title: '佛說梵志頞波羅延問種尊經', subid: 700, scrollCount: 1, firstBookId: 4710, collectionId: 47 },
  { part: 608, title: '佛說四諦經', subid: 701, scrollCount: 1, firstBookId: 4711, collectionId: 47 },
  { part: 609, title: '佛說恒水經', subid: 702, scrollCount: 1, firstBookId: 4712, collectionId: 47 },
  { part: 610, title: '佛說瞻婆比丘經', subid: 703, scrollCount: 1, firstBookId: 4713, collectionId: 47 },
  { part: 611, title: '佛說本相倚致經', subid: 704, scrollCount: 1, firstBookId: 4714, collectionId: 47 },
  { part: 612, title: '佛說縁本致經', subid: 705, scrollCount: 1, firstBookId: 4715, collectionId: 47 },
  { part: 613, title: '佛說頂生王故事經', subid: 706, scrollCount: 1, firstBookId: 4716, collectionId: 47 },
  { part: 614, title: '佛說文陀竭王經', subid: 707, scrollCount: 1, firstBookId: 4717, collectionId: 47 },
  { part: 615, title: '三歸五戒慈心猒離功德經', subid: 708, scrollCount: 1, firstBookId: 4718, collectionId: 47 },
  { part: 616, title: '佛說須達經', subid: 709, scrollCount: 1, firstBookId: 4719, collectionId: 47 },
  { part: 617, title: '佛爲黄竹園老婆羅門說學經', subid: 710, scrollCount: 1, firstBookId: 4720, collectionId: 47 },
  { part: 618, title: '佛說梵摩喻經', subid: 711, scrollCount: 1, firstBookId: 4721, collectionId: 47 },
  { part: 619, title: '佛說尊上經', subid: 712, scrollCount: 1, firstBookId: 4722, collectionId: 47 },
  { part: 620, title: '佛說鸚鵡經', subid: 713, scrollCount: 1, firstBookId: 4723, collectionId: 47 },
  { part: 621, title: '佛說兜調經', subid: 714, scrollCount: 1, firstBookId: 4724, collectionId: 47 },
  { part: 622, title: '佛說意經', subid: 715, scrollCount: 1, firstBookId: 4725, collectionId: 47 },
  { part: 623, title: '佛說應法經', subid: 716, scrollCount: 1, firstBookId: 4726, collectionId: 47 },
  { part: 624, title: '佛說波斯匿王太后崩塵土坌身經', subid: 717, scrollCount: 1, firstBookId: 4727, collectionId: 47 },
  { part: 625, title: '須摩提女經', subid: 718, scrollCount: 1, firstBookId: 4728, collectionId: 47 },
  { part: 626, title: '佛說三摩竭經', subid: 719, scrollCount: 1, firstBookId: 4729, collectionId: 47 },
  { part: 627, title: '佛說婆羅門避死經', subid: 720, scrollCount: 1, firstBookId: 4730, collectionId: 47 },
  { part: 628, title: '食施獲五福報經', subid: 721, scrollCount: 1, firstBookId: 4731, collectionId: 47 },
  { part: 629, title: '頻毗娑羅王詣佛供養經', subid: 722, scrollCount: 1, firstBookId: 4732, collectionId: 47 },
  { part: 630, title: '佛說長者子六過出家', subid: 723, scrollCount: 1, firstBookId: 4733, collectionId: 47 },
  { part: 631, title: '佛說鴦崛摩經', subid: 724, scrollCount: 1, firstBookId: 4734, collectionId: 47 },
  { part: 632, title: '佛說鴦崛髻經', subid: 725, scrollCount: 1, firstBookId: 4735, collectionId: 47 },
  { part: 633, title: '佛說力士移山經', subid: 726, scrollCount: 1, firstBookId: 4736, collectionId: 47 },
  { part: 634, title: '佛說四未曽有法經', subid: 727, scrollCount: 1, firstBookId: 4737, collectionId: 47 },
  { part: 635, title: '佛說舍利弗目揵連遊四衢經', subid: 728, scrollCount: 1, firstBookId: 4738, collectionId: 47 },
  { part: 636, title: '七佛父母姓字經', subid: 729, scrollCount: 1, firstBookId: 4739, collectionId: 47 },
  { part: 637, title: '佛說放牛經', subid: 730, scrollCount: 1, firstBookId: 4740, collectionId: 47 },
  { part: 638, title: '縁起經', subid: 731, scrollCount: 1, firstBookId: 4741, collectionId: 47 },
  { part: 639, title: '佛說十一想思念如來經', subid: 732, scrollCount: 1, firstBookId: 4742, collectionId: 47 },
  { part: 640, title: '佛說四泥犂經', subid: 733, scrollCount: 1, firstBookId: 4743, collectionId: 47 },
  { part: 641, title: '舍衞國王夢見十事經', subid: 734, scrollCount: 2, firstBookId: 4744, collectionId: 47 },
  { part: 642, title: '佛說國王不黎先尼十夢經', subid: 735, scrollCount: 1, firstBookId: 4746, collectionId: 47 },
  { part: 643, title: '阿難同學經', subid: 736, scrollCount: 2, firstBookId: 4747, collectionId: 47 },
  { part: 644, title: '五藴皆空經', subid: 737, scrollCount: 2, firstBookId: 4749, collectionId: 47 },
  { part: 645, title: '阿難問事佛吉凶經', subid: 738, scrollCount: 1, firstBookId: 4751, collectionId: 47 },
  { part: 646, title: '慢法經', subid: 739, scrollCount: 1, firstBookId: 4752, collectionId: 47 },
  { part: 647, title: '阿難分别經', subid: 740, scrollCount: 1, firstBookId: 4753, collectionId: 47 },
  { part: 648, title: '五母子經', subid: 741, scrollCount: 1, firstBookId: 4754, collectionId: 47 },
  { part: 649, title: '沙彌羅經', subid: 742, scrollCount: 1, firstBookId: 4755, collectionId: 47 },
  { part: 650, title: '玉耶經', subid: 743, scrollCount: 1, firstBookId: 4756, collectionId: 47 },
  { part: 651, title: '玉耶女經', subid: 744, scrollCount: 1, firstBookId: 4757, collectionId: 47 },
  { part: 652, title: '阿遫逹經', subid: 745, scrollCount: 1, firstBookId: 4758, collectionId: 47 },
  { part: 653, title: '摩鄧女經', subid: 746, scrollCount: 1, firstBookId: 4759, collectionId: 47 },
  { part: 654, title: '摩登女解形中六事經', subid: 747, scrollCount: 1, firstBookId: 4760, collectionId: 47 },
  { part: 655, title: '摩登伽經', subid: 748, scrollCount: 1, firstBookId: 4761, collectionId: 47 },
  { part: 656, title: '舍頭諫經', subid: 749, scrollCount: 1, firstBookId: 4762, collectionId: 47 },
  { part: 657, title: '治禪病秘要經', subid: 750, scrollCount: 1, firstBookId: 4763, collectionId: 47 },
  { part: 658, title: '佛說七處三觀經', subid: 751, scrollCount: 1, firstBookId: 4764, collectionId: 47 },
  { part: 659, title: '阿那邠邸化七子經', subid: 752, scrollCount: 1, firstBookId: 4765, collectionId: 47 },
  { part: 660, title: '佛說大愛道般涅槃經', subid: 753, scrollCount: 2, firstBookId: 4766, collectionId: 47 },
  { part: 661, title: '佛母般泥洹經', subid: 754, scrollCount: 2, firstBookId: 4768, collectionId: 47 },
  { part: 662, title: '佛說聖法印經', subid: 755, scrollCount: 4, firstBookId: 4770, collectionId: 47 },
  { part: 663, title: '五隂譬喻經', subid: 756, scrollCount: 1, firstBookId: 4774, collectionId: 47 },
  { part: 664, title: '佛說水沫所漂經', subid: 757, scrollCount: 1, firstBookId: 4775, collectionId: 47 },
  { part: 665, title: '佛說不自守意經', subid: 758, scrollCount: 5, firstBookId: 4776, collectionId: 47 },
  { part: 666, title: '佛說滿願子經', subid: 759, scrollCount: 1, firstBookId: 4781, collectionId: 47 },
  { part: 667, title: '轉法輪經', subid: 760, scrollCount: 1, firstBookId: 4782, collectionId: 47 },
  { part: 668, title: '佛說三轉法輪經', subid: 761, scrollCount: 1, firstBookId: 4783, collectionId: 47 },
  { part: 669, title: '佛說八正道經', subid: 762, scrollCount: 1, firstBookId: 4784, collectionId: 47 },
  { part: 670, title: '難提釋經', subid: 763, scrollCount: 2, firstBookId: 4785, collectionId: 47 },
  { part: 671, title: '佛說馬有三相經', subid: 764, scrollCount: 1, firstBookId: 4787, collectionId: 47 },
  { part: 672, title: '佛說馬有八態譬人經', subid: 765, scrollCount: 1, firstBookId: 4788, collectionId: 47 },
  { part: 673, title: '佛說相應相可經', subid: 766, scrollCount: 1, firstBookId: 4789, collectionId: 47 },
  { part: 674, title: '修行本起經', subid: 767, scrollCount: 1, firstBookId: 4790, collectionId: 47, has0aPreface: true, mergeFileCount: 4 },
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
