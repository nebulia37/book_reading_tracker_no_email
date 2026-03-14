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

// Fetch both HTML content and audio URL from upstream
// The upstream API returns audio links only when only_content is NOT set.
// When content=='ajax_url', a second request with only_content=1 is needed for HTML.
async function fetchBookWithAudio(bookId, menuid) {
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest'
  };

  // First request: get audio URL (without only_content)
  const metaResp = await fetch('https://w1.xianmijingzang.com/wapajax/tripitaka/', {
    method: 'POST', headers,
    body: `menuid=${menuid}&book=${bookId}&lang=zh`
  });
  if (!metaResp.ok) throw new Error(`Upstream returned ${metaResp.status}`);
  const metaBuffer = await metaResp.arrayBuffer();
  const metaJson = JSON.parse(iconv.decode(Buffer.from(metaBuffer), 'gbk'));
  const audioUrl = metaJson.links || metaJson.audiolinks || '';

  // Second request: get HTML content
  const html = await fetchBookHtml(bookId, menuid);

  return { html, audioUrl };
}

// ============================================
// CATALOG FOR PARTS 675-776 (collection 50)
// ============================================
const SCRIPTURE_CATALOG = [
  { part: 675, title: '正法念處經', subid: 648, scrollCount: 71, firstBookId: 4794, collectionId: 50, has0aPreface: true },
  { part: 676, title: '佛本行集經', subid: 782, scrollCount: 60, firstBookId: 4865, collectionId: 50 },
  { part: 677, title: '佛說大安般守意經', subid: 783, scrollCount: 3, firstBookId: 4925, collectionId: 50, has0aPreface: true },
  { part: 678, title: '佛說罵意經', subid: 784, scrollCount: 1, firstBookId: 4928, collectionId: 50 },
  { part: 679, title: '禪行法想經', subid: 785, scrollCount: 1, firstBookId: 4929, collectionId: 50 },
  { part: 680, title: '佛說處處經', subid: 786, scrollCount: 1, firstBookId: 4930, collectionId: 50 },
  { part: 681, title: '佛說分别善惡所起經', subid: 787, scrollCount: 1, firstBookId: 4931, collectionId: 50 },
  { part: 682, title: '佛說出家縁經', subid: 788, scrollCount: 1, firstBookId: 4932, collectionId: 50 },
  { part: 683, title: '佛說阿含正行經', subid: 789, scrollCount: 1, firstBookId: 4933, collectionId: 50 },
  { part: 684, title: '佛說十八泥犂經', subid: 790, scrollCount: 1, firstBookId: 4934, collectionId: 50 },
  { part: 685, title: '佛說法受塵經', subid: 791, scrollCount: 1, firstBookId: 4935, collectionId: 50 },
  { part: 686, title: '佛說進學經', subid: 792, scrollCount: 1, firstBookId: 4936, collectionId: 50 },
  { part: 687, title: '佛說得道梯隥錫杖經', subid: 793, scrollCount: 1, firstBookId: 4937, collectionId: 50 },
  { part: 688, title: '佛說貧窮老公經', subid: 794, scrollCount: 1, firstBookId: 4938, collectionId: 50 },
  { part: 689, title: '須摩提長者經', subid: 795, scrollCount: 1, firstBookId: 4939, collectionId: 50 },
  { part: 690, title: '長者懊惱三處經', subid: 796, scrollCount: 1, firstBookId: 4940, collectionId: 50 },
  { part: 691, title: '犍陀國王經', subid: 797, scrollCount: 1, firstBookId: 4941, collectionId: 50 },
  { part: 692, title: '阿難四事經', subid: 798, scrollCount: 1, firstBookId: 4942, collectionId: 50 },
  { part: 693, title: '分别經', subid: 799, scrollCount: 1, firstBookId: 4943, collectionId: 50 },
  { part: 694, title: '未生怨經', subid: 800, scrollCount: 1, firstBookId: 4944, collectionId: 50 },
  { part: 695, title: '四願經', subid: 801, scrollCount: 1, firstBookId: 4945, collectionId: 50 },
  { part: 696, title: '猘狗經', subid: 802, scrollCount: 1, firstBookId: 4946, collectionId: 50 },
  { part: 697, title: '八關齋經', subid: 803, scrollCount: 1, firstBookId: 4947, collectionId: 50 },
  { part: 698, title: '孝子經', subid: 804, scrollCount: 1, firstBookId: 4948, collectionId: 50 },
  { part: 699, title: '黒氏梵志經', subid: 805, scrollCount: 1, firstBookId: 4949, collectionId: 50 },
  { part: 700, title: '阿鳩留經', subid: 806, scrollCount: 1, firstBookId: 4950, collectionId: 50 },
  { part: 701, title: '佛爲阿支羅迦葉自化作苦經', subid: 807, scrollCount: 1, firstBookId: 4951, collectionId: 50 },
  { part: 702, title: '佛說罪業報應教化地獄經', subid: 808, scrollCount: 1, firstBookId: 4952, collectionId: 50 },
  { part: 703, title: '佛說龍王兄弟經', subid: 809, scrollCount: 1, firstBookId: 4953, collectionId: 50 },
  { part: 704, title: '佛說長者音恱經', subid: 810, scrollCount: 1, firstBookId: 4954, collectionId: 50 },
  { part: 705, title: '佛說七女經', subid: 811, scrollCount: 1, firstBookId: 4955, collectionId: 50 },
  { part: 706, title: '佛說八師經', subid: 812, scrollCount: 1, firstBookId: 4956, collectionId: 50 },
  { part: 707, title: '佛說越難經', subid: 813, scrollCount: 1, firstBookId: 4957, collectionId: 50 },
  { part: 708, title: '佛說所欲致患經', subid: 814, scrollCount: 1, firstBookId: 4958, collectionId: 50 },
  { part: 709, title: '阿闍世王問五逆經', subid: 815, scrollCount: 1, firstBookId: 4959, collectionId: 50 },
  { part: 710, title: '本事經', subid: 816, scrollCount: 7, firstBookId: 4960, collectionId: 50 },
  { part: 711, title: '佛說中心經', subid: 817, scrollCount: 1, firstBookId: 4967, collectionId: 50 },
  { part: 712, title: '佛說見正經', subid: 818, scrollCount: 1, firstBookId: 4968, collectionId: 50 },
  { part: 713, title: '佛說大魚事經', subid: 819, scrollCount: 1, firstBookId: 4969, collectionId: 50 },
  { part: 714, title: '佛說阿難七夢經', subid: 820, scrollCount: 1, firstBookId: 4970, collectionId: 50 },
  { part: 715, title: '佛說呵鵰阿那含經', subid: 821, scrollCount: 1, firstBookId: 4971, collectionId: 50 },
  { part: 716, title: '佛說燈指因縁經', subid: 822, scrollCount: 1, firstBookId: 4972, collectionId: 50 },
  { part: 717, title: '佛說婦人遇辜經', subid: 823, scrollCount: 1, firstBookId: 4973, collectionId: 50 },
  { part: 718, title: '佛說四天王經', subid: 824, scrollCount: 1, firstBookId: 4974, collectionId: 50 },
  { part: 719, title: '佛說摩訶迦葉度貧母經', subid: 825, scrollCount: 1, firstBookId: 4975, collectionId: 50 },
  { part: 720, title: '佛說禪行三十七品經', subid: 826, scrollCount: 1, firstBookId: 4976, collectionId: 50 },
  { part: 721, title: '比丘避女惡名欲自殺經', subid: 827, scrollCount: 1, firstBookId: 4977, collectionId: 50 },
  { part: 722, title: '佛說身觀經', subid: 828, scrollCount: 1, firstBookId: 4978, collectionId: 50 },
  { part: 723, title: '佛說無常經', subid: 829, scrollCount: 1, firstBookId: 4979, collectionId: 50 },
  { part: 724, title: '佛說八無暇有暇經', subid: 830, scrollCount: 1, firstBookId: 4980, collectionId: 50 },
  { part: 725, title: '五百弟子自說本起經', subid: 831, scrollCount: 1, firstBookId: 4981, collectionId: 50 },
  { part: 726, title: '佛說五苦章句經', subid: 832, scrollCount: 1, firstBookId: 4982, collectionId: 50 },
  { part: 727, title: '佛說堅意經', subid: 833, scrollCount: 1, firstBookId: 4983, collectionId: 50 },
  { part: 728, title: '佛說淨飯王般涅槃經', subid: 834, scrollCount: 1, firstBookId: 4984, collectionId: 50 },
  { part: 729, title: '佛說興起行經', subid: 835, scrollCount: 3, firstBookId: 4985, collectionId: 50, has0aPreface: true },
  { part: 730, title: '長爪梵志請問經', subid: 836, scrollCount: 1, firstBookId: 4988, collectionId: 50 },
  { part: 731, title: '佛說譬喻經', subid: 837, scrollCount: 1, firstBookId: 4989, collectionId: 50 },
  { part: 732, title: '佛說比丘聽施經', subid: 838, scrollCount: 1, firstBookId: 4990, collectionId: 50 },
  { part: 733, title: '佛說畧敎誡經', subid: 839, scrollCount: 1, firstBookId: 4991, collectionId: 50 },
  { part: 734, title: '佛說療痔病經', subid: 840, scrollCount: 1, firstBookId: 4992, collectionId: 50 },
  { part: 735, title: '佛說業報差别經', subid: 841, scrollCount: 1, firstBookId: 4993, collectionId: 50 },
  { part: 736, title: '佛說十二品生死經', subid: 842, scrollCount: 1, firstBookId: 4994, collectionId: 50 },
  { part: 737, title: '佛說輪轉五道罪福報應經', subid: 843, scrollCount: 1, firstBookId: 4995, collectionId: 50 },
  { part: 738, title: '佛說五無返復經', subid: 844, scrollCount: 2, firstBookId: 4996, collectionId: 50 },
  { part: 739, title: '佛說佛大僧大經', subid: 846, scrollCount: 1, firstBookId: 4998, collectionId: 50 },
  { part: 740, title: '佛說大迦葉本經', subid: 847, scrollCount: 1, firstBookId: 4999, collectionId: 50 },
  { part: 741, title: '佛說四自侵經', subid: 848, scrollCount: 1, firstBookId: 5000, collectionId: 50 },
  { part: 742, title: '佛說羅云忍辱經', subid: 849, scrollCount: 1, firstBookId: 5001, collectionId: 50 },
  { part: 743, title: '佛爲年少比丘說正事經', subid: 850, scrollCount: 1, firstBookId: 5002, collectionId: 50 },
  { part: 744, title: '佛說沙曷比丘功德經', subid: 851, scrollCount: 1, firstBookId: 5003, collectionId: 50 },
  { part: 745, title: '佛說時非時經', subid: 852, scrollCount: 1, firstBookId: 5004, collectionId: 50 },
  { part: 746, title: '佛說自愛經', subid: 853, scrollCount: 1, firstBookId: 5005, collectionId: 50 },
  { part: 747, title: '佛說賢者五福德經', subid: 854, scrollCount: 1, firstBookId: 5006, collectionId: 50 },
  { part: 748, title: '天請問經', subid: 855, scrollCount: 1, firstBookId: 5007, collectionId: 50 },
  { part: 749, title: '佛說護淨經', subid: 856, scrollCount: 1, firstBookId: 5008, collectionId: 50 },
  { part: 750, title: '佛說木槵經', subid: 857, scrollCount: 1, firstBookId: 5009, collectionId: 50 },
  { part: 751, title: '佛說無上處經', subid: 858, scrollCount: 1, firstBookId: 5010, collectionId: 50 },
  { part: 752, title: '盧至長者因縁經', subid: 859, scrollCount: 1, firstBookId: 5011, collectionId: 50 },
  { part: 753, title: '佛說普達王經', subid: 860, scrollCount: 1, firstBookId: 5012, collectionId: 50 },
  { part: 754, title: '佛說鬼子母經', subid: 861, scrollCount: 1, firstBookId: 5013, collectionId: 50 },
  { part: 755, title: '佛說梵摩難國王經', subid: 862, scrollCount: 1, firstBookId: 5014, collectionId: 50 },
  { part: 756, title: '佛說孫多耶致經', subid: 863, scrollCount: 1, firstBookId: 5015, collectionId: 50 },
  { part: 757, title: '佛說父母恩難報經', subid: 864, scrollCount: 1, firstBookId: 5016, collectionId: 50 },
  { part: 758, title: '佛說新歳經', subid: 865, scrollCount: 1, firstBookId: 5017, collectionId: 50 },
  { part: 759, title: '佛說群牛譬經', subid: 866, scrollCount: 1, firstBookId: 5018, collectionId: 50 },
  { part: 760, title: '佛說九横經', subid: 867, scrollCount: 1, firstBookId: 5019, collectionId: 50 },
  { part: 761, title: '佛說五恐怖世經', subid: 868, scrollCount: 1, firstBookId: 5020, collectionId: 50 },
  { part: 762, title: '佛說弟子死復生經', subid: 869, scrollCount: 1, firstBookId: 5021, collectionId: 50 },
  { part: 763, title: '佛說懈怠耕者經', subid: 870, scrollCount: 1, firstBookId: 5022, collectionId: 50 },
  { part: 764, title: '佛說辯意長者子所問經', subid: 871, scrollCount: 1, firstBookId: 5023, collectionId: 50 },
  { part: 765, title: '無垢優婆夷問經', subid: 872, scrollCount: 1, firstBookId: 5024, collectionId: 50 },
  { part: 766, title: '佛說耶祇經', subid: 873, scrollCount: 1, firstBookId: 5025, collectionId: 50 },
  { part: 767, title: '佛說末羅王經', subid: 874, scrollCount: 1, firstBookId: 5026, collectionId: 50 },
  { part: 768, title: '佛說摩達國王經', subid: 875, scrollCount: 1, firstBookId: 5027, collectionId: 50 },
  { part: 769, title: '佛說旃陀越國王經', subid: 876, scrollCount: 1, firstBookId: 5028, collectionId: 50 },
  { part: 770, title: '佛說五王經', subid: 877, scrollCount: 1, firstBookId: 5029, collectionId: 50 },
  { part: 771, title: '佛說出家功德經', subid: 878, scrollCount: 1, firstBookId: 5030, collectionId: 50 },
  { part: 772, title: '佛說栴檀樹經', subid: 879, scrollCount: 1, firstBookId: 5031, collectionId: 50 },
  { part: 773, title: '佛說頞多和多耆經', subid: 880, scrollCount: 1, firstBookId: 5032, collectionId: 50 },
  { part: 774, title: '禪秘要法經', subid: 881, scrollCount: 3, firstBookId: 5033, collectionId: 50 },
  { part: 775, title: '隂持入經', subid: 882, scrollCount: 2, firstBookId: 5036, collectionId: 50 },
  { part: 776, title: '佛說因縁僧護經', subid: 883, scrollCount: 1, firstBookId: 5038, collectionId: 50 }
];
function getCatalogEntry(part) {
  return SCRIPTURE_CATALOG.find(e => e.part === part);
}

// ============================================
// SCRIPTURE TEXT AND PDF ENDPOINTS
// ============================================

// Cache for scripture content to reduce upstream requests
let scriptureCache = new Map();
const SCRIPTURE_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Scripture content for catalog entries
// Only merge 0a+0b/01 into scroll 1 if has0aPreface flag is set
app.get('/api/scripture/:part/:scroll', async (req, res) => {
  const part = parseInt(req.params.part);
  const scroll = parseInt(req.params.scroll);
  const entry = getCatalogEntry(part);

  if (!entry) {
    return res.status(400).json({ error: `Unknown part ${part}` });
  }
  const has0aPreface = entry.has0aPreface === true;
  const mergeCount = entry.mergeFileCount || 2; // Default: merge 2 files (0a+0b), but can be 3 for (0a+0b+1)
  const effectiveScrolls = has0aPreface ? entry.scrollCount - (mergeCount - 1) : entry.scrollCount;
  if (isNaN(scroll) || scroll < 1 || scroll > effectiveScrolls) {
    return res.status(400).json({ error: `Invalid scroll ${scroll} for part ${part} (1-${effectiveScrolls})` });
  }

  // If has0aPreface: scroll 1 → firstBookId (0a), scroll S>1 → firstBookId + mergeCount + (S-2)
  // Otherwise: scroll N → firstBookId + (N-1)
  const bookId = has0aPreface
    ? (scroll === 1 ? entry.firstBookId : entry.firstBookId + mergeCount + (scroll - 2))
    : entry.firstBookId + scroll - 1;
  // Use subid override if available for this scroll
  const subid = (entry.subidOverrides && entry.subidOverrides[scroll]) || entry.subid;
  const menuid = `${entry.collectionId}|${subid}`;
  const cacheKey = `scripture_cat_${part}_${scroll}`;

  const cached = scriptureCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
    return res.json({ ...cached.data, cached: true });
  }

  console.log(`Fetching scripture for part ${part} scroll ${scroll}, bookId ${bookId}, menuid ${menuid}`);

  try {
    if (has0aPreface && scroll === 1) {
      // Merge multiple files (0a, 0b, 1, etc.) into scroll 1
      const bookIdsToFetch = [];
      for (let i = 0; i < mergeCount; i++) {
        bookIdsToFetch.push(entry.firstBookId + i);
      }
      const results = await Promise.all(
        bookIdsToFetch.map(id => fetchBookWithAudio(id, menuid))
      );
      const html = results.map(r => r.html).join('');
      // Use local proxy URL for catalog volumes to avoid SSL certificate issues
      const audioSrc = `/api/scripture/${part}/${scroll}/mp3`;
      const secondaryAudioSrc = results[1]?.audioUrl || null;
      const tertiaryAudioSrc = results[2]?.audioUrl || null;
      const data = { html, scroll, part, bookId, audioSrc, secondaryAudioSrc, tertiaryAudioSrc, prefaceHtml: null };
      scriptureCache.set(cacheKey, { data, timestamp: Date.now() });
      res.json({ ...data, cached: false });
    } else {
      const { html } = await fetchBookWithAudio(bookId, menuid);
      // Use local proxy URL for catalog volumes to avoid SSL certificate issues
      const audioSrc = `/api/scripture/${part}/${scroll}/mp3`;
      const data = { html, scroll, part, bookId, audioSrc, secondaryAudioSrc: null, prefaceHtml: null };
      scriptureCache.set(cacheKey, { data, timestamp: Date.now() });
      res.json({ ...data, cached: false });
    }
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
  const has0aPreface = entry.has0aPreface === true;
  const mergeCount = entry.mergeFileCount || 2;
  const effectiveScrolls = has0aPreface ? entry.scrollCount - (mergeCount - 1) : entry.scrollCount;
  if (isNaN(scroll) || scroll < 1 || scroll > effectiveScrolls) {
    return res.status(400).json({ error: `Invalid scroll ${scroll}` });
  }

  const bookId = has0aPreface
    ? (scroll === 1 ? entry.firstBookId : entry.firstBookId + mergeCount + (scroll - 2))
    : entry.firstBookId + scroll - 1;
  const subid = (entry.subidOverrides && entry.subidOverrides[scroll]) || entry.subid;
  const menuid = `${entry.collectionId}|${subid}`;

  try {
    const cacheKey = `scripture_cat_${part}_${scroll}`;
    let scriptureHtml;
    const cached = scriptureCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
      scriptureHtml = cached.data.html;
    } else if (has0aPreface && scroll === 1) {
      // Merge multiple files (0a, 0b, 1, etc.)
      const htmlPromises = [];
      for (let i = 0; i < mergeCount; i++) {
        htmlPromises.push(fetchBookHtml(entry.firstBookId + i, menuid));
      }
      const htmlResults = await Promise.all(htmlPromises);
      scriptureHtml = htmlResults.join('');
    } else {
      scriptureHtml = await fetchBookHtml(bookId, menuid);
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
  const has0aPreface = entry.has0aPreface === true;
  const mergeCount = entry.mergeFileCount || 2;
  const effectiveScrolls = has0aPreface ? entry.scrollCount - (mergeCount - 1) : entry.scrollCount;
  if (isNaN(scroll) || scroll < 1 || scroll > effectiveScrolls) {
    return res.status(400).json({ error: `Invalid scroll ${scroll}` });
  }

  const bookId = has0aPreface
    ? (scroll === 1 ? entry.firstBookId : entry.firstBookId + mergeCount + (scroll - 2))
    : entry.firstBookId + scroll - 1;
  const subid = (entry.subidOverrides && entry.subidOverrides[scroll]) || entry.subid;
  const menuid = `${entry.collectionId}|${subid}`;
  try {
    // Always fetch fresh audio URL from upstream API (don't use cache since cache now contains local proxy URLs)
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
    const audioUrl = metaJson.links || metaJson.audiolinks || '';
    if (!audioUrl) throw new Error('No audio URL found');

    // Handle full URLs vs path-only URLs
    const upstream = audioUrl.startsWith('http') ? audioUrl : `https://w1.xianmijingzang.com${audioUrl}${audioUrl.includes('?') ? '' : '?_mt='}`;
    const response = await fetch(upstream);
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="part${part}_scroll${scroll}.mp3"`);
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
  const isMulti = entry.scrollCount > 1;
  const effectiveScrolls = isMulti ? entry.scrollCount - 1 : 1;
  if (isNaN(scroll) || scroll < 1 || scroll > effectiveScrolls) {
    return res.status(400).json({ error: `Invalid scroll ${scroll}` });
  }

  const bookId = isMulti ? (scroll === 1 ? entry.firstBookId : entry.firstBookId + scroll) : entry.firstBookId;
  const menuid = `${entry.collectionId}|${entry.subid}`;

  try {
    const cacheKey = `scripture_cat_${part}_${scroll}`;
    let scriptureHtml;
    const cached = scriptureCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
      scriptureHtml = cached.data.html;
    } else if (isMulti && scroll === 1) {
      const [html1, html2] = await Promise.all([
        fetchBookHtml(entry.firstBookId, menuid),
        fetchBookHtml(entry.firstBookId + 1, menuid)
      ]);
      scriptureHtml = html1 + html2;
    } else {
      scriptureHtml = await fetchBookHtml(bookId, menuid);
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
