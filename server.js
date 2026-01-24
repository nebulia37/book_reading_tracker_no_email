import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import crypto from 'crypto';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

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

  // Validate phone number format (11 digits)
  if (!/^[0-9]{11}$/.test(phone)) {
    return res.status(400).json({ error: 'Phone number must be 11 digits.' });
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

    console.log("Saving to Supabase:", newClaim);
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.warn('Supabase not configured, claim saved locally only');
      return res.status(500).json({ error: 'Supabase not configured.' });
    }

    const { data, error } = await supabase
      .from('claims')
      .insert([newClaim])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert failed:', error.message);
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
      displayStatus: c.expectedCompletionDate && now >= new Date(c.expectedCompletionDate) ? '已完成' : '已认领'
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
    .subtitle { text-align: center; color: #8b7355; margin-bottom: 20px; font-size: 14px; }
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
    .refresh { text-align: center; margin-top: 20px; }
    .refresh a { color: #8b7355; text-decoration: none; padding: 10px 20px; border: 1px solid #8b7355; border-radius: 8px; display: inline-block; transition: all 0.2s; }
    .refresh a:hover { background: #8b7355; color: white; }
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
    <div class="refresh"><a href="/view?code=${code}">🔄 刷新数据</a></div>
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

app.listen(PORT, () => {
  console.log(`\nServer Active at http://localhost:${PORT}`);
  console.log(`View claims at http://localhost:${PORT}/view`);
  console.log(`CORS enabled for all origins`);
  console.log(`Supabase configured: ${!!(SUPABASE_URL && SUPABASE_ANON_KEY)}`);
});