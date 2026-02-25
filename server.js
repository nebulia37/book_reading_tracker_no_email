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

// ============================================
// SCROLL-TO-BOOK-ID MAPPING (mirrors data.ts)
// ============================================
// 15 section prefaces in the upstream catalog — each is an extra book entry
// inserted before the scroll it introduces. Key = scroll number, value = preface bookId.
const PREFACE_FOR_SCROLL = {
  401: 2470,
  479: 2549,
  538: 2609,
  556: 2628,
  566: 2639,
  574: 2648,
  576: 2651,
  577: 2653,
  578: 2655,
  579: 2657,
  584: 2663,
  589: 2669,
  590: 2671,
  591: 2673,
  593: 2676
};


function getScrollMapping(scroll) {
  // Count how many prefaces appear before this scroll's position
  const prefacesBefore = Object.entries(PREFACE_FOR_SCROLL).reduce((count, [s]) => {
    return Number(s) < scroll ? count + 1 : count;
  }, 0);

  // The scroll's own preface (if any) is at bookId position, content is at bookId + 1
  const prefaceBookId = PREFACE_FOR_SCROLL[scroll];
  const hasPreface = !!prefaceBookId;

  // Content bookId: base (2069) + scroll + prefaces before this scroll + (1 if this scroll has a preface)
  const bookId = 2069 + scroll + prefacesBefore + (hasPreface ? 1 : 0);

  return { bookId, prefaceBookId: hasPreface ? prefaceBookId : undefined };
}

function getAudioMapping(scroll) {
  const { bookId, prefaceBookId } = getScrollMapping(scroll);
  if (prefaceBookId) {
    // Split scrolls use 1_{scroll}a.mp3 / 1_{scroll}b.mp3 naming
    return { audioSrc: `${scroll}a`, prefaceAudioSrc: undefined, secondaryAudioSrc: `${scroll}b` };
  }
  // Normal scrolls use 1_{index}.mp3 where index = bookId - 2069
  const audioIndex = bookId - 2069;
  return { audioSrc: String(audioIndex), prefaceAudioSrc: undefined, secondaryAudioSrc: undefined };
}

// Helper: fetch a single book's HTML from upstream
// menuid format: "collectionId|subid" e.g. "43|67" or "47|191"
async function fetchBookHtml(bookId, menuid = '43|67') {
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

// Fetch both HTML content and audio URL from upstream (for collection 47)
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
// CATALOG FOR PARTS 122-371 (collection 47)
// ============================================
const SCRIPTURE_CATALOG = [
  { part: 122, title: '金光明最勝王經', subid: 191, scrollCount: 11, firstBookId: 3470, collectionId: 47, has0aPreface: true },
  { part: 123, title: '金光明經', subid: 192, scrollCount: 5, firstBookId: 3481, collectionId: 47, has0aPreface: true },
  { part: 124, title: '等集衆德三昧經', subid: 193, scrollCount: 3, firstBookId: 3486, collectionId: 47 },
  { part: 125, title: '集一切福德三昧經', subid: 194, scrollCount: 3, firstBookId: 3489, collectionId: 47 },
  { part: 126, title: '合部金光明經', subid: 195, scrollCount: 9, firstBookId: 3492, collectionId: 47, has0aPreface: true },
  { part: 127, title: '入定不定印經', subid: 196, scrollCount: 2, firstBookId: 3501, collectionId: 47, has0aPreface: true },
  { part: 128, title: '不必定入定入印經', subid: 197, scrollCount: 2, firstBookId: 3503, collectionId: 47, has0aPreface: true },
  { part: 129, title: '無量義經', subid: 198, scrollCount: 2, firstBookId: 3505, collectionId: 47, has0aPreface: true },
  { part: 130, title: '妙法蓮華經', subid: 199, scrollCount: 9, firstBookId: 3507, collectionId: 47, has0aPreface: true },
  { part: 131, title: '法華三昧經', subid: 200, scrollCount: 1, firstBookId: 3516, collectionId: 47 },
  { part: 132, title: '薩曇芬陀利經', subid: 201, scrollCount: 1, firstBookId: 3517, collectionId: 47 },
  { part: 133, title: '妙法蓮華經觀世音菩薩普門品經', subid: 202, scrollCount: 2, firstBookId: 3518, collectionId: 47, has0aPreface: true },
  { part: 134, title: '正法華經', subid: 203, scrollCount: 10, firstBookId: 3520, collectionId: 47 },
  { part: 135, title: '妙法蓮華經', subid: 204, scrollCount: 9, firstBookId: 3530, collectionId: 47, has0aPreface: true },
  { part: 136, title: '分别縁起初勝法門經', subid: 205, scrollCount: 2, firstBookId: 3539, collectionId: 47 },
  { part: 137, title: '佛說縁生初勝分法本經', subid: 206, scrollCount: 3, firstBookId: 3541, collectionId: 47, has0aPreface: true },
  { part: 138, title: '悲華經', subid: 207, scrollCount: 10, firstBookId: 3544, collectionId: 47 },
  { part: 139, title: '六度集經', subid: 208, scrollCount: 8, firstBookId: 3554, collectionId: 47 },
  { part: 140, title: '大乗頂王經', subid: 209, scrollCount: 1, firstBookId: 3562, collectionId: 47 },
  { part: 141, title: '大方等頂王經', subid: 210, scrollCount: 1, firstBookId: 3563, collectionId: 47 },
  { part: 142, title: '維摩詰所說大乘經', subid: 211, scrollCount: 3, firstBookId: 3564, collectionId: 47 },
  { part: 143, title: '維摩詰經', subid: 212, scrollCount: 3, firstBookId: 3567, collectionId: 47 },
  { part: 144, title: '道神足無極變化經', subid: 213, scrollCount: 4, firstBookId: 3570, collectionId: 47 },
  { part: 145, title: '說無垢稱經', subid: 214, scrollCount: 6, firstBookId: 3574, collectionId: 47 },
  { part: 146, title: '阿惟越致遮經', subid: 215, scrollCount: 4, firstBookId: 3580, collectionId: 47 },
  { part: 147, title: '佛說寳雨經', subid: 216, scrollCount: 10, firstBookId: 3584, collectionId: 47 },
  { part: 148, title: '佛說寳雲經', subid: 217, scrollCount: 7, firstBookId: 3594, collectionId: 47 },
  { part: 149, title: '佛昇忉利天爲母說法經', subid: 218, scrollCount: 3, firstBookId: 3601, collectionId: 47 },
  { part: 150, title: '相續解脫地波羅蜜了義經', subid: 219, scrollCount: 1, firstBookId: 3604, collectionId: 47 },
  { part: 151, title: '相續解脫如來所作隨順處了義經', subid: 220, scrollCount: 1, firstBookId: 3605, collectionId: 47 },
  { part: 152, title: '佛說解節經', subid: 221, scrollCount: 1, firstBookId: 3606, collectionId: 47 },
  { part: 153, title: '不退轉法輪經', subid: 222, scrollCount: 4, firstBookId: 3607, collectionId: 47 },
  { part: 154, title: '廣博嚴淨不退轉法輪經', subid: 223, scrollCount: 4, firstBookId: 3611, collectionId: 47 },
  { part: 155, title: '方廣大莊嚴經', subid: 224, scrollCount: 13, firstBookId: 3615, collectionId: 47, has0aPreface: true },
  { part: 156, title: '普曜經', subid: 225, scrollCount: 8, firstBookId: 3628, collectionId: 47 },
  { part: 157, title: '伅眞陀羅所問寳如來三昧經', subid: 226, scrollCount: 3, firstBookId: 3636, collectionId: 47 },
  { part: 158, title: '大樹緊那羅王所問經', subid: 227, scrollCount: 4, firstBookId: 3639, collectionId: 47 },
  { part: 159, title: '諸法本無經', subid: 228, scrollCount: 3, firstBookId: 3643, collectionId: 47 },
  { part: 160, title: '諸法無行經', subid: 229, scrollCount: 2, firstBookId: 3646, collectionId: 47 },
  { part: 161, title: '持人菩薩所問經', subid: 230, scrollCount: 4, firstBookId: 3648, collectionId: 47 },
  { part: 162, title: '持世經', subid: 231, scrollCount: 4, firstBookId: 3652, collectionId: 47 },
  { part: 163, title: '佛說大灌頂神呪經', subid: 232, scrollCount: 12, firstBookId: 3656, collectionId: 47 },
  { part: 164, title: '佛說文殊師利現寳藏經', subid: 233, scrollCount: 2, firstBookId: 3668, collectionId: 47 },
  { part: 165, title: '大方廣寳篋經', subid: 234, scrollCount: 2, firstBookId: 3670, collectionId: 47 },
  { part: 166, title: '佛說藥師如來本願經', subid: 235, scrollCount: 2, firstBookId: 3672, collectionId: 47, has0aPreface: true },
  { part: 167, title: '藥師瑠璃光如來本願功徳經', subid: 236, scrollCount: 1, firstBookId: 3674, collectionId: 47 },
  { part: 168, title: '藥師瑠璃光七佛本願功徳經', subid: 237, scrollCount: 2, firstBookId: 3675, collectionId: 47 },
  { part: 169, title: '番字藥師七佛本願功徳經', subid: 238, scrollCount: 1, firstBookId: 3677, collectionId: 47 },
  { part: 170, title: '佛說阿闍世王經', subid: 239, scrollCount: 2, firstBookId: 3678, collectionId: 47 },
  { part: 171, title: '楞伽阿跋多羅寳經', subid: 240, scrollCount: 4, firstBookId: 3680, collectionId: 47 },
  { part: 172, title: '入楞伽經', subid: 241, scrollCount: 10, firstBookId: 3684, collectionId: 47 },
  { part: 173, title: '大乗入楞伽經', subid: 242, scrollCount: 8, firstBookId: 3694, collectionId: 47, has0aPreface: true },
  { part: 174, title: '菩薩行方便境界神通變化經', subid: 243, scrollCount: 3, firstBookId: 3702, collectionId: 47 },
  { part: 175, title: '大薩遮尼乾子受記經', subid: 244, scrollCount: 11, firstBookId: 3705, collectionId: 47 },
  { part: 176, title: '大乗大悲分陀利經', subid: 245, scrollCount: 8, firstBookId: 3716, collectionId: 47 },
  { part: 177, title: '善思童子經', subid: 246, scrollCount: 2, firstBookId: 3724, collectionId: 47 },
  { part: 178, title: '普超三昧經', subid: 247, scrollCount: 4, firstBookId: 3726, collectionId: 47 },
  { part: 179, title: '佛說放鉢經', subid: 248, scrollCount: 1, firstBookId: 3730, collectionId: 47 },
  { part: 180, title: '佛說大淨法門品經', subid: 249, scrollCount: 1, firstBookId: 3731, collectionId: 47 },
  { part: 181, title: '大莊嚴法門經', subid: 250, scrollCount: 2, firstBookId: 3732, collectionId: 47 },
  { part: 182, title: '佛說大方等大雲請雨經', subid: 251, scrollCount: 1, firstBookId: 3734, collectionId: 47 },
  { part: 183, title: '大雲請雨經', subid: 252, scrollCount: 1, firstBookId: 3735, collectionId: 47 },
  { part: 184, title: '大雲輪請雨經', subid: 253, scrollCount: 2, firstBookId: 3736, collectionId: 47 },
  { part: 185, title: '勝思惟梵天所問經', subid: 254, scrollCount: 6, firstBookId: 3738, collectionId: 47 },
  { part: 186, title: '思益梵天所問經', subid: 255, scrollCount: 4, firstBookId: 3744, collectionId: 47 },
  { part: 187, title: '月燈三昧經', subid: 256, scrollCount: 11, firstBookId: 3748, collectionId: 47 },
  { part: 188, title: '月燈三昧經', subid: 257, scrollCount: 1, firstBookId: 3759, collectionId: 47 },
  { part: 189, title: '佛說象腋經', subid: 258, scrollCount: 1, firstBookId: 3760, collectionId: 47 },
  { part: 190, title: '佛說無所希望經', subid: 259, scrollCount: 1, firstBookId: 3761, collectionId: 47 },
  { part: 191, title: '佛說大乗同性經', subid: 260, scrollCount: 2, firstBookId: 3762, collectionId: 47 },
  { part: 192, title: '佛說證契大乗經', subid: 261, scrollCount: 3, firstBookId: 3764, collectionId: 47, has0aPreface: true },
  { part: 193, title: '持心梵天所問經', subid: 262, scrollCount: 4, firstBookId: 3767, collectionId: 47 },
  { part: 194, title: '佛說觀無量壽佛經', subid: 263, scrollCount: 2, firstBookId: 3771, collectionId: 47, has0aPreface: true },
  { part: 195, title: '稱讃淨土佛攝受經', subid: 264, scrollCount: 1, firstBookId: 3773, collectionId: 47 },
  { part: 196, title: '佛說阿彌陀經', subid: 265, scrollCount: 1, firstBookId: 3774, collectionId: 47 },
  { part: 197, title: '拔一切業障根本得生淨土神呪', subid: 266, scrollCount: 1, firstBookId: 3775, collectionId: 47 },
  { part: 198, title: '後出阿彌陀佛偈經', subid: 267, scrollCount: 1, firstBookId: 3776, collectionId: 47 },
  { part: 199, title: '佛說大阿彌陀經', subid: 268, scrollCount: 3, firstBookId: 3777, collectionId: 47, has0aPreface: true },
  { part: 200, title: '佛說觀彌勒菩薩上生兠率陀天經', subid: 269, scrollCount: 1, firstBookId: 3780, collectionId: 47 },
  { part: 201, title: '佛說彌勒下生經', subid: 270, scrollCount: 1, firstBookId: 3781, collectionId: 47 },
  { part: 202, title: '佛說彌勒來時經', subid: 272, scrollCount: 1, firstBookId: 3782, collectionId: 47 },
  { part: 203, title: '佛說彌勒下生成佛經', subid: 274, scrollCount: 1, firstBookId: 3783, collectionId: 47 },
  { part: 204, title: '佛說觀彌勒菩薩下生經', subid: 275, scrollCount: 1, firstBookId: 3784, collectionId: 47 },
  { part: 205, title: '佛說彌勒成佛經', subid: 276, scrollCount: 1, firstBookId: 3785, collectionId: 47 },
  { part: 206, title: '佛說第一義法勝經', subid: 278, scrollCount: 2, firstBookId: 3786, collectionId: 47, has0aPreface: true },
  { part: 207, title: '佛說大威燈光仙人問疑經', subid: 281, scrollCount: 1, firstBookId: 3788, collectionId: 47 },
  { part: 208, title: '一切法高王經', subid: 284, scrollCount: 1, firstBookId: 3789, collectionId: 47 },
  { part: 209, title: '佛說諸法勇王經', subid: 285, scrollCount: 1, firstBookId: 3790, collectionId: 47 },
  { part: 210, title: '順權方便經', subid: 288, scrollCount: 2, firstBookId: 3791, collectionId: 47 },
  { part: 211, title: '佛說樂瓔珞莊嚴方便經', subid: 291, scrollCount: 1, firstBookId: 3793, collectionId: 47 },
  { part: 212, title: '菩薩睒子經', subid: 292, scrollCount: 1, firstBookId: 3794, collectionId: 47 },
  { part: 213, title: '佛說睒子經', subid: 294, scrollCount: 1, firstBookId: 3795, collectionId: 47 },
  { part: 214, title: '佛說九色鹿經', subid: 295, scrollCount: 1, firstBookId: 3796, collectionId: 47 },
  { part: 215, title: '佛說太子沐魄經', subid: 297, scrollCount: 1, firstBookId: 3797, collectionId: 47 },
  { part: 216, title: '太子慕魄經', subid: 298, scrollCount: 1, firstBookId: 3798, collectionId: 47 },
  { part: 217, title: '無字寳篋經', subid: 299, scrollCount: 1, firstBookId: 3799, collectionId: 47 },
  { part: 218, title: '大乗離文字普光明藏經', subid: 300, scrollCount: 1, firstBookId: 3800, collectionId: 47 },
  { part: 219, title: '大乗徧照光明藏無字法門經', subid: 301, scrollCount: 1, firstBookId: 3801, collectionId: 47 },
  { part: 220, title: '佛說老女人經', subid: 302, scrollCount: 1, firstBookId: 3802, collectionId: 47 },
  { part: 221, title: '佛說老母經', subid: 303, scrollCount: 1, firstBookId: 3803, collectionId: 47 },
  { part: 222, title: '佛說老母女六英經', subid: 304, scrollCount: 1, firstBookId: 3804, collectionId: 47 },
  { part: 223, title: '佛說長者子制經', subid: 305, scrollCount: 1, firstBookId: 3805, collectionId: 47 },
  { part: 224, title: '佛說菩薩逝經', subid: 306, scrollCount: 1, firstBookId: 3806, collectionId: 47 },
  { part: 225, title: '佛說逝童子經', subid: 307, scrollCount: 1, firstBookId: 3807, collectionId: 47 },
  { part: 226, title: '佛說月光童子經', subid: 309, scrollCount: 1, firstBookId: 3808, collectionId: 47 },
  { part: 227, title: '佛說申日兒本經', subid: 310, scrollCount: 1, firstBookId: 3809, collectionId: 47 },
  { part: 228, title: '佛說德護長者經', subid: 311, scrollCount: 2, firstBookId: 3811, collectionId: 47 },
  { part: 229, title: '佛說犢子經', subid: 312, scrollCount: 1, firstBookId: 3812, collectionId: 47 },
  { part: 230, title: '佛說乳光佛經', subid: 313, scrollCount: 1, firstBookId: 3813, collectionId: 47 },
  { part: 231, title: '佛說無垢賢女經', subid: 314, scrollCount: 1, firstBookId: 3814, collectionId: 47 },
  { part: 232, title: '佛說腹中女聽經', subid: 315, scrollCount: 1, firstBookId: 3815, collectionId: 47 },
  { part: 233, title: '佛說轉女身經', subid: 316, scrollCount: 1, firstBookId: 3816, collectionId: 47 },
  { part: 234, title: '文殊師利問菩提經', subid: 317, scrollCount: 1, firstBookId: 3817, collectionId: 47 },
  { part: 235, title: '伽耶山頂經', subid: 318, scrollCount: 1, firstBookId: 3818, collectionId: 47 },
  { part: 236, title: '佛說象頭精舍經', subid: 319, scrollCount: 1, firstBookId: 3819, collectionId: 47 },
  { part: 237, title: '大乗伽耶山頂經', subid: 320, scrollCount: 1, firstBookId: 3820, collectionId: 47 },
  { part: 238, title: '佛說決定緫持經', subid: 321, scrollCount: 1, firstBookId: 3821, collectionId: 47 },
  { part: 239, title: '佛說謗佛經', subid: 322, scrollCount: 1, firstBookId: 3822, collectionId: 47 },
  { part: 240, title: '大方等大雲經', subid: 323, scrollCount: 4, firstBookId: 3823, collectionId: 47 },
  { part: 241, title: '如來莊嚴智慧光明入一切佛境界經', subid: 325, scrollCount: 2, firstBookId: 3827, collectionId: 47 },
  { part: 242, title: '深宻解脫經', subid: 327, scrollCount: 6, firstBookId: 3829, collectionId: 47, has0aPreface: true },
  { part: 243, title: '解深宻經', subid: 329, scrollCount: 5, firstBookId: 3835, collectionId: 47 },
  { part: 244, title: '佛說諫王經', subid: 331, scrollCount: 1, firstBookId: 3840, collectionId: 47 },
  { part: 245, title: '如來示敎勝軍王經', subid: 333, scrollCount: 1, firstBookId: 3841, collectionId: 47 },
  { part: 246, title: '佛爲勝光天子說王法經', subid: 334, scrollCount: 1, firstBookId: 3842, collectionId: 47 },
  { part: 247, title: '寶積三昧文殊師利菩薩問法身經', subid: 335, scrollCount: 1, firstBookId: 3843, collectionId: 47 },
  { part: 248, title: '佛說濟諸方等學經', subid: 336, scrollCount: 1, firstBookId: 3844, collectionId: 47 },
  { part: 249, title: '大乗方廣緫持經', subid: 337, scrollCount: 1, firstBookId: 3845, collectionId: 47 },
  { part: 250, title: '太子須大拏經', subid: 338, scrollCount: 1, firstBookId: 3846, collectionId: 47 },
  { part: 251, title: '佛說如來智印經', subid: 339, scrollCount: 1, firstBookId: 3847, collectionId: 47 },
  { part: 252, title: '佛說慧印三昧經', subid: 340, scrollCount: 1, firstBookId: 3848, collectionId: 47 },
  { part: 253, title: '佛說無極寶三昧經', subid: 341, scrollCount: 2, firstBookId: 3849, collectionId: 47 },
  { part: 254, title: '寳如來三昧經', subid: 342, scrollCount: 2, firstBookId: 3851, collectionId: 47 },
  { part: 255, title: '無上依經', subid: 343, scrollCount: 2, firstBookId: 3853, collectionId: 47 },
  { part: 256, title: '佛說未曽有經', subid: 344, scrollCount: 1, firstBookId: 3855, collectionId: 47 },
  { part: 257, title: '佛說甚希有經', subid: 345, scrollCount: 1, firstBookId: 3856, collectionId: 47 },
  { part: 258, title: '佛說如來師子吼經', subid: 346, scrollCount: 1, firstBookId: 3857, collectionId: 47 },
  { part: 259, title: '佛說大方廣師子吼經', subid: 347, scrollCount: 1, firstBookId: 3858, collectionId: 47 },
  { part: 260, title: '佛說大乗百福相經', subid: 348, scrollCount: 1, firstBookId: 3859, collectionId: 47 },
  { part: 261, title: '佛說大乗百福莊嚴相經', subid: 349, scrollCount: 1, firstBookId: 3860, collectionId: 47 },
  { part: 262, title: '佛說大乗四法經', subid: 350, scrollCount: 1, firstBookId: 3861, collectionId: 47 },
  { part: 263, title: '佛說菩薩修行四法經', subid: 351, scrollCount: 1, firstBookId: 3862, collectionId: 47 },
  { part: 264, title: '佛說希有校量功德經', subid: 353, scrollCount: 1, firstBookId: 3863, collectionId: 47 },
  { part: 265, title: '佛說最無比經', subid: 354, scrollCount: 1, firstBookId: 3864, collectionId: 47 },
  { part: 266, title: '佛說前世三轉經', subid: 355, scrollCount: 1, firstBookId: 3865, collectionId: 47 },
  { part: 267, title: '佛說銀色女經', subid: 356, scrollCount: 1, firstBookId: 3866, collectionId: 47 },
  { part: 268, title: '佛說阿闍世王受決經', subid: 357, scrollCount: 1, firstBookId: 3867, collectionId: 47 },
  { part: 269, title: '採華違王上佛授決經', subid: 358, scrollCount: 1, firstBookId: 3868, collectionId: 47 },
  { part: 270, title: '佛說正恭敬經', subid: 359, scrollCount: 1, firstBookId: 3869, collectionId: 47 },
  { part: 271, title: '佛說善恭敬經', subid: 361, scrollCount: 1, firstBookId: 3870, collectionId: 47 },
  { part: 272, title: '稱讃大乗功德經', subid: 362, scrollCount: 1, firstBookId: 3871, collectionId: 47 },
  { part: 273, title: '妙法決定業障經', subid: 363, scrollCount: 1, firstBookId: 3872, collectionId: 47 },
  { part: 274, title: '佛說貝多樹下思惟十二因縁經', subid: 364, scrollCount: 1, firstBookId: 3873, collectionId: 47 },
  { part: 275, title: '佛說縁起聖道經', subid: 365, scrollCount: 1, firstBookId: 3874, collectionId: 47 },
  { part: 276, title: '佛說稻稈經', subid: 366, scrollCount: 1, firstBookId: 3875, collectionId: 47 },
  { part: 277, title: '佛說了本生死經', subid: 367, scrollCount: 1, firstBookId: 3876, collectionId: 47 },
  { part: 278, title: '佛說自誓三昧經', subid: 368, scrollCount: 1, firstBookId: 3877, collectionId: 47 },
  { part: 279, title: '如來獨證自誓三昧經', subid: 369, scrollCount: 1, firstBookId: 3878, collectionId: 47 },
  { part: 280, title: '佛說轉有經', subid: 370, scrollCount: 1, firstBookId: 3879, collectionId: 47 },
  { part: 281, title: '大方等修多羅王經', subid: 372, scrollCount: 1, firstBookId: 3880, collectionId: 47 },
  { part: 282, title: '佛說文殊師利廵行經', subid: 373, scrollCount: 1, firstBookId: 3881, collectionId: 47 },
  { part: 283, title: '佛說文殊尸利行經', subid: 374, scrollCount: 1, firstBookId: 3882, collectionId: 47 },
  { part: 284, title: '大乗造像功德經', subid: 376, scrollCount: 2, firstBookId: 3883, collectionId: 47 },
  { part: 285, title: '佛說作佛形像經', subid: 377, scrollCount: 1, firstBookId: 3885, collectionId: 47 },
  { part: 286, title: '佛說造立形像福報經', subid: 378, scrollCount: 1, firstBookId: 3886, collectionId: 47 },
  { part: 287, title: '佛說灌佛經', subid: 379, scrollCount: 1, firstBookId: 3887, collectionId: 47 },
  { part: 288, title: '佛說灌洗佛經', subid: 380, scrollCount: 1, firstBookId: 3888, collectionId: 47 },
  { part: 289, title: '佛說浴像功德經', subid: 381, scrollCount: 1, firstBookId: 3889, collectionId: 47 },
  { part: 290, title: '浴像功德經', subid: 382, scrollCount: 1, firstBookId: 3890, collectionId: 47 },
  { part: 291, title: '佛說校量數珠功德經', subid: 383, scrollCount: 1, firstBookId: 3891, collectionId: 47 },
  { part: 292, title: '曼殊室利呪藏中校量數珠功德經', subid: 384, scrollCount: 1, firstBookId: 3892, collectionId: 47 },
  { part: 293, title: '佛說龍施女經', subid: 385, scrollCount: 1, firstBookId: 3893, collectionId: 47 },
  { part: 294, title: '佛說龍施菩薩本起經', subid: 386, scrollCount: 1, firstBookId: 3894, collectionId: 47 },
  { part: 295, title: '佛說八吉祥神呪經', subid: 387, scrollCount: 1, firstBookId: 3895, collectionId: 47 },
  { part: 296, title: '佛說八陽神呪經', subid: 388, scrollCount: 1, firstBookId: 3896, collectionId: 47 },
  { part: 297, title: '佛說八吉祥經', subid: 389, scrollCount: 1, firstBookId: 3897, collectionId: 47 },
  { part: 298, title: '佛說八佛名號經', subid: 390, scrollCount: 1, firstBookId: 3898, collectionId: 47 },
  { part: 299, title: '佛說盂蘭盆經', subid: 391, scrollCount: 1, firstBookId: 3899, collectionId: 47 },
  { part: 300, title: '佛說報恩奉盆經', subid: 392, scrollCount: 1, firstBookId: 3900, collectionId: 47 },
  { part: 301, title: '佛說觀藥王藥上二菩薩經', subid: 393, scrollCount: 1, firstBookId: 3901, collectionId: 47 },
  { part: 302, title: '佛說大孔雀呪王經', subid: 394, scrollCount: 3, firstBookId: 3902, collectionId: 47 },
  { part: 303, title: '佛母大孔雀明王經', subid: 395, scrollCount: 4, firstBookId: 3905, collectionId: 47, has0aPreface: true },
  { part: 304, title: '佛說孔雀王呪經', subid: 396, scrollCount: 2, firstBookId: 3909, collectionId: 47 },
  { part: 305, title: '佛說大孔雀王神呪經', subid: 397, scrollCount: 1, firstBookId: 3911, collectionId: 47 },
  { part: 306, title: '佛說大孔雀王雜神呪經', subid: 398, scrollCount: 1, firstBookId: 3912, collectionId: 47 },
  { part: 307, title: '大金色孔雀王呪經', subid: 399, scrollCount: 1, firstBookId: 3913, collectionId: 47 },
  { part: 308, title: '佛說不空羂索呪經', subid: 400, scrollCount: 1, firstBookId: 3914, collectionId: 47 },
  { part: 309, title: '不空羂索心呪王經', subid: 401, scrollCount: 3, firstBookId: 3915, collectionId: 47 },
  { part: 310, title: '不空羂索陀羅尼經', subid: 402, scrollCount: 3, firstBookId: 3918, collectionId: 47, has0aPreface: true },
  { part: 311, title: '不空羂索呪心經', subid: 403, scrollCount: 1, firstBookId: 3921, collectionId: 47 },
  { part: 312, title: '不空羂索神呪心經', subid: 404, scrollCount: 2, firstBookId: 3922, collectionId: 47, has0aPreface: true },
  { part: 313, title: '不空羂索神變眞言經', subid: 405, scrollCount: 30, firstBookId: 3924, collectionId: 47 },
  { part: 314, title: '千眼千臂觀世音菩薩陀羅尼神呪經', subid: 406, scrollCount: 3, firstBookId: 3954, collectionId: 47, has0aPreface: true },
  { part: 315, title: '千手千眼觀世音菩薩姥陀羅尼身經', subid: 407, scrollCount: 1, firstBookId: 3957, collectionId: 47 },
  { part: 316, title: '千手千眼觀世音菩薩廣大圎滿無礙大悲心陀羅尼經', subid: 408, scrollCount: 2, firstBookId: 3958, collectionId: 47, has0aPreface: true },
  { part: 317, title: '觀世音菩薩祕密藏神呪經', subid: 409, scrollCount: 1, firstBookId: 3960, collectionId: 47 },
  { part: 318, title: '觀世音菩薩如意摩尼陀羅尼經', subid: 410, scrollCount: 1, firstBookId: 3961, collectionId: 47 },
  { part: 319, title: '觀自在菩薩如意心陀羅尼呪經', subid: 411, scrollCount: 1, firstBookId: 3962, collectionId: 47 },
  { part: 320, title: '如意輪陀羅尼經', subid: 412, scrollCount: 1, firstBookId: 3963, collectionId: 47 },
  { part: 321, title: '觀自在菩薩怛嚩多唎隨心陀羅尼經', subid: 413, scrollCount: 1, firstBookId: 3964, collectionId: 47 },
  { part: 322, title: '請觀世音菩薩消伏毒害陀羅尼呪經', subid: 414, scrollCount: 1, firstBookId: 3965, collectionId: 47 },
  { part: 323, title: '佛說十一面觀世音神呪經', subid: 415, scrollCount: 1, firstBookId: 3966, collectionId: 47 },
  { part: 324, title: '十一面神呪心經', subid: 416, scrollCount: 1, firstBookId: 3967, collectionId: 47 },
  { part: 325, title: '千轉陀羅尼觀世音菩薩呪經', subid: 418, scrollCount: 1, firstBookId: 3968, collectionId: 47 },
  { part: 326, title: '呪五首經', subid: 419, scrollCount: 1, firstBookId: 3969, collectionId: 47 },
  { part: 327, title: '六字神呪經', subid: 420, scrollCount: 1, firstBookId: 3970, collectionId: 47 },
  { part: 328, title: '呪三首經', subid: 421, scrollCount: 1, firstBookId: 3971, collectionId: 47 },
  { part: 329, title: '大方廣菩薩藏經中文殊師利根本一字陀羅尼法', subid: 422, scrollCount: 1, firstBookId: 3972, collectionId: 47 },
  { part: 330, title: '曼殊室利菩薩呪藏中一字呪王經', subid: 423, scrollCount: 1, firstBookId: 3973, collectionId: 47 },
  { part: 331, title: '十二佛名神呪校量功德除障滅罪經', subid: 424, scrollCount: 1, firstBookId: 3974, collectionId: 47 },
  { part: 332, title: '佛說稱讃如來功德神呪經', subid: 425, scrollCount: 1, firstBookId: 3975, collectionId: 47 },
  { part: 333, title: '華積陀羅尼神呪經', subid: 426, scrollCount: 1, firstBookId: 3976, collectionId: 47 },
  { part: 334, title: '師子奮迅菩薩所問經', subid: 427, scrollCount: 1, firstBookId: 3977, collectionId: 47 },
  { part: 335, title: '佛說華聚陀羅尼呪經', subid: 428, scrollCount: 1, firstBookId: 3978, collectionId: 47 },
  { part: 336, title: '六字呪王經', subid: 429, scrollCount: 1, firstBookId: 3979, collectionId: 47 },
  { part: 337, title: '六字神呪王經', subid: 430, scrollCount: 1, firstBookId: 3980, collectionId: 47 },
  { part: 338, title: '梵女首意經', subid: 431, scrollCount: 1, firstBookId: 3981, collectionId: 47 },
  { part: 339, title: '有德女所問大乗經', subid: 432, scrollCount: 1, firstBookId: 3982, collectionId: 47 },
  { part: 340, title: '佛說七俱胝佛母心大准提陀羅尼經', subid: 433, scrollCount: 1, firstBookId: 3983, collectionId: 47 },
  { part: 341, title: '佛說七俱胝佛母准提大明陀羅尼經', subid: 434, scrollCount: 1, firstBookId: 3984, collectionId: 47 },
  { part: 342, title: '七俱胝佛母所說准提陀羅尼經', subid: 435, scrollCount: 1, firstBookId: 3985, collectionId: 47 },
  { part: 343, title: '種種雜呪經', subid: 436, scrollCount: 1, firstBookId: 3986, collectionId: 47 },
  { part: 344, title: '佛頂尊勝陀羅尼經', subid: 437, scrollCount: 1, firstBookId: 3987, collectionId: 47 },
  { part: 345, title: '佛頂尊勝陀羅尼經', subid: 438, scrollCount: 3, firstBookId: 3988, collectionId: 47, has0aPreface: true, mergeFileCount: 3 },
  { part: 346, title: '佛說佛頂尊勝陀羅尼經', subid: 439, scrollCount: 1, firstBookId: 3991, collectionId: 47 },
  { part: 347, title: '最勝佛頂陀羅尼淨除業障經', subid: 440, scrollCount: 1, firstBookId: 3992, collectionId: 47 },
  { part: 348, title: '佛頂最勝陀羅尼經', subid: 441, scrollCount: 2, firstBookId: 3993, collectionId: 47, has0aPreface: true },
  { part: 349, title: '舍利弗陁羅尼經', subid: 442, scrollCount: 1, firstBookId: 3995, collectionId: 47 },
  { part: 350, title: '佛說無量門破魔陀羅尼經', subid: 443, scrollCount: 1, firstBookId: 3996, collectionId: 47 },
  { part: 351, title: '佛說無量門微宻持經', subid: 444, scrollCount: 1, firstBookId: 3997, collectionId: 47 },
  { part: 352, title: '佛說出生無量門持經', subid: 445, scrollCount: 1, firstBookId: 3998, collectionId: 47 },
  { part: 353, title: '阿難陀目佉尼訶離陀隣尼經', subid: 446, scrollCount: 1, firstBookId: 3999, collectionId: 47 },
  { part: 354, title: '阿難陀目佉尼訶離陀經', subid: 447, scrollCount: 1, firstBookId: 4000, collectionId: 47 },
  { part: 355, title: '佛說一向出生菩薩經', subid: 448, scrollCount: 1, firstBookId: 4001, collectionId: 47 },
  { part: 356, title: '出生無邊門陀羅尼經', subid: 449, scrollCount: 1, firstBookId: 4002, collectionId: 47 },
  { part: 357, title: '勝幢臂印陀羅尼經', subid: 450, scrollCount: 1, firstBookId: 4003, collectionId: 47 },
  { part: 358, title: '妙臂印幢陀羅尼經', subid: 451, scrollCount: 1, firstBookId: 4004, collectionId: 47 },
  { part: 359, title: '佛說陀羅尼集經', subid: 452, scrollCount: 14, firstBookId: 4005, collectionId: 47, has0aPreface: true },
  { part: 360, title: '佛說持句神呪經', subid: 453, scrollCount: 1, firstBookId: 4019, collectionId: 47 },
  { part: 361, title: '佛說陀鄰尼鉢經', subid: 454, scrollCount: 1, firstBookId: 4020, collectionId: 47 },
  { part: 362, title: '東方最勝燈王如來助護持世間神呪經', subid: 455, scrollCount: 1, firstBookId: 4021, collectionId: 47 },
  { part: 363, title: '如來方便善巧呪經', subid: 456, scrollCount: 1, firstBookId: 4022, collectionId: 47 },
  { part: 364, title: '虚空藏菩薩問七佛陀羅尼呪經', subid: 457, scrollCount: 1, firstBookId: 4023, collectionId: 47 },
  { part: 365, title: '善法方便陀羅尼呪經', subid: 458, scrollCount: 1, firstBookId: 4024, collectionId: 47 },
  { part: 366, title: '金剛秘密善門陀羅尼經', subid: 459, scrollCount: 1, firstBookId: 4025, collectionId: 47 },
  { part: 367, title: '護命法門神呪經', subid: 460, scrollCount: 1, firstBookId: 4026, collectionId: 47 },
  { part: 368, title: '金剛場陀羅尼經', subid: 461, scrollCount: 1, firstBookId: 4027, collectionId: 47 },
  { part: 369, title: '金剛上味陀羅尼經', subid: 462, scrollCount: 1, firstBookId: 4028, collectionId: 47 },
  { part: 370, title: '佛說無崖際緫持法門經', subid: 463, scrollCount: 1, firstBookId: 4029, collectionId: 47 },
  { part: 371, title: '尊勝菩薩所問一切諸法入無量法門陀羅尼經', subid: 464, scrollCount: 1, firstBookId: 4030, collectionId: 47 },
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

// Scripture text proxy endpoint (avoids CORS issues)
app.get('/api/scripture/:scroll', async (req, res) => {
  const scroll = parseInt(req.params.scroll);
  if (isNaN(scroll) || scroll < 1 || scroll > 600) {
    return res.status(400).json({ error: 'Invalid scroll number (1-600)' });
  }

  const { bookId, prefaceBookId } = getScrollMapping(scroll);
  const cacheKey = `scripture_v3_${scroll}`;

  // Check cache first
  const cached = scriptureCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
    console.log(`Returning cached scripture for scroll ${scroll}`);
    return res.json({ ...cached.data, cached: true });
  }

  console.log(`Fetching scripture for scroll ${scroll}, book ID ${bookId}`);

  try {
    const html = await fetchBookHtml(bookId);

    let prefaceHtml = undefined;
    if (prefaceBookId) {
      prefaceHtml = await fetchBookHtml(prefaceBookId);
    }

    const { audioSrc, secondaryAudioSrc } = getAudioMapping(scroll);

    const data = {
      html,
      prefaceHtml,
      scroll,
      bookId,
      audioSrc,
      secondaryAudioSrc
    };
    scriptureCache.set(cacheKey, { data, timestamp: Date.now() });

    res.json({ ...data, cached: false });
  } catch (error) {
    console.error('Failed to fetch scripture:', error);
    res.status(500).json({ error: 'Failed to fetch scripture text: ' + error.message });
  }
});

// MP3 audio proxy (same-origin download for WeChat compatibility)
app.get('/api/scripture/:scroll/mp3', async (req, res) => {
  const scroll = parseInt(req.params.scroll);
  if (isNaN(scroll) || scroll < 1 || scroll > 600) {
    return res.status(400).json({ error: 'Invalid scroll number (1-600)' });
  }
  try {
    const { audioSrc } = getAudioMapping(scroll);
    const upstream = `https://w1.xianmijingzang.com/fojing/1/1/1/1_${audioSrc}.mp3?_mt=`;
    const response = await fetch(upstream);
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="scroll_${scroll}.mp3"`);
    const { Readable } = await import('stream');
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    console.error('Failed to proxy MP3:', error);
    res.status(500).json({ error: 'Failed to download audio' });
  }
});

// Text file download endpoint (reliable Chinese support)
app.get('/api/scripture/:scroll/txt', async (req, res) => {
  const scroll = parseInt(req.params.scroll);
  if (isNaN(scroll) || scroll < 1 || scroll > 600) {
    return res.status(400).json({ error: 'Invalid scroll number (1-600)' });
  }

  const { bookId, prefaceBookId } = getScrollMapping(scroll);
  console.log(`Generating TXT for scroll ${scroll}, book ID ${bookId}`);

  try {
    const cacheKey = `scripture_v3_${scroll}`;
    let scriptureHtml;

    const cached = scriptureCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
      scriptureHtml = cached.data.html;
    } else {
      scriptureHtml = await fetchBookHtml(bookId);
      const prefaceHtml = prefaceBookId ? await fetchBookHtml(prefaceBookId) : undefined;
      const { audioSrc, secondaryAudioSrc } = getAudioMapping(scroll);
      scriptureCache.set(cacheKey, {
        data: { html: scriptureHtml, prefaceHtml, scroll, bookId, audioSrc, secondaryAudioSrc },
        timestamp: Date.now()
      });
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

    const fullText = `大般若波罗蜜多经 卷${scroll}\n唐三藏法师玄奘 奉詔译\n${'='.repeat(40)}\n\n${plainText}`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const txtFilename = `大般若波罗蜜多经_卷${scroll}.txt`;
    const encodedTxtFilename = encodeURIComponent(txtFilename);
    res.setHeader('Content-Disposition', `attachment; filename="${scroll}.txt"; filename*=UTF-8''${encodedTxtFilename}`);
    res.send(fullText);
  } catch (error) {
    console.error('Failed to generate TXT:', error);
    res.status(500).json({ error: 'Failed to generate text file: ' + error.message });
  }
});

// PDF generation endpoint (styled HTML page with print button)
app.get('/api/scripture/:scroll/pdf', async (req, res) => {
  const scroll = parseInt(req.params.scroll);
  if (isNaN(scroll) || scroll < 1 || scroll > 600) {
    return res.status(400).json({ error: 'Invalid scroll number (1-600)' });
  }

  const { bookId, prefaceBookId } = getScrollMapping(scroll);
  console.log(`Generating PDF for scroll ${scroll}, book ID ${bookId}`);

  try {
    // First fetch the scripture content (check cache)
    const cacheKey = `scripture_v3_${scroll}`;
    let scriptureHtml;

    const cached = scriptureCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION) {
      scriptureHtml = cached.data.html;
    } else {
      scriptureHtml = await fetchBookHtml(bookId);
      const prefaceHtml = prefaceBookId ? await fetchBookHtml(prefaceBookId) : undefined;
      const { audioSrc, secondaryAudioSrc } = getAudioMapping(scroll);
      scriptureCache.set(cacheKey, {
        data: { html: scriptureHtml, prefaceHtml, scroll, bookId, audioSrc, secondaryAudioSrc },
        timestamp: Date.now()
      });
    }

    // Upstream nests punctuation inside the hanzi span:
    //   <i><span>pinyin</span><span>hanzi<span class=dou>，</span></span></i>
    // Extract punctuation out of the hanzi span, place after </i>
    let cleanedHtml = scriptureHtml;
    cleanedHtml = cleanedHtml.replace(
      /<span class=(?:["'])?(?:dou|dian)(?:["'])?>([^<]*)<\/span>(<\/span><\/i>)/gi,
      '$2$1'
    );
    // Convert all <i><span>pinyin</span><span>hanzi</span></i> to <ruby> tags
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

    // Generate styled HTML for PDF - matching xianmijingzang.com style with ruby annotations
    const fullHtml = `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&display=swap" rel="stylesheet">
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
      font-family: "Noto Serif SC", "PingFang SC", "Microsoft YaHei", "SimSun", serif;
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
      text-align: left;
      background: #fff;
      border: 1px solid #e8e0d0;
      border-radius: 4px;
      margin: 0 10px;
    }
    .content p {
      margin-bottom: 1em;
      text-indent: 2em;
    }
    .content p.center {
      text-align: center;
      text-indent: 0;
    }

    /* Pinyin above Chinese characters using native ruby */
    ruby {
      ruby-align: center;
    }
    rt {
      font-size: 8pt;
      color: #888;
      font-family: Arial, "Helvetica Neue", sans-serif;
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
    .print-btn {
      position: fixed;
      top: 16px;
      right: 16px;
      padding: 10px 24px;
      background: #8b7355;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14pt;
      font-weight: bold;
      cursor: pointer;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .print-btn:hover { background: #5c4033; }
    @media print {
      .print-btn { display: none; }
      body { background: #fff; }
      .header { background: none; border-bottom: 1px solid #c9a86c; }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">保存PDF</button>
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

    // Serve print-friendly HTML page (works in any browser including WeChat)
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(fullHtml);

  } catch (error) {
    console.error('Failed to generate PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF: ' + error.message });
  }
});

// ============================================
// MULTI-SCRIPTURE ROUTES (parts 122-371, collection 47)
// ============================================

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
  const menuid = `${entry.collectionId}|${entry.subid}`;
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
      const audioSrc = results[0]?.audioUrl || '';
      const secondaryAudioSrc = results[1]?.audioUrl || null;
      const tertiaryAudioSrc = results[2]?.audioUrl || null;
      const data = { html, scroll, part, bookId, audioSrc, secondaryAudioSrc, tertiaryAudioSrc, prefaceHtml: null };
      scriptureCache.set(cacheKey, { data, timestamp: Date.now() });
      res.json({ ...data, cached: false });
    } else {
      const { html, audioUrl } = await fetchBookWithAudio(bookId, menuid);
      const audioSrc = audioUrl || '';
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
  const menuid = `${entry.collectionId}|${entry.subid}`;

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
  const menuid = `${entry.collectionId}|${entry.subid}`;
  try {
    // Get the audio URL from cache or upstream API
    const cacheKey = `scripture_cat_${part}_${scroll}`;
    let audioUrl;
    const cached = scriptureCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < SCRIPTURE_CACHE_DURATION && cached.data.audioSrc) {
      audioUrl = cached.data.audioSrc;
    } else {
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
    }
    if (!audioUrl) throw new Error('No audio URL found');

    const upstream = `https://w1.xianmijingzang.com${audioUrl}${audioUrl.includes('?') ? '' : '?_mt='}`;
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
