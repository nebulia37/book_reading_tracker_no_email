import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import fs from 'fs';
import 'dotenv/config';

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

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.post('/api/claim', async (req, res) => {
  console.log("Received claim data:", req.body);
  const { volumeId, name, email, phone, plannedDays, readingUrl } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and Name are required.' });
  }

  try {
    const claimedAt = new Date();
    const expectedDate = new Date();
    expectedDate.setDate(claimedAt.getDate() + (plannedDays || 7));

    const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const newClaim = {
      volumeId, name, email, phone, plannedDays, readingUrl,
      claimedAt: claimedAt.toISOString(),
      expectedCompletionDate: expectedDate.toISOString(),
      status: 'claimed'
    };
    dbData.push(newClaim);
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));

    const emailBody = `尊敬的 ${name}：\n\n您已成功认领经文诵读。详情如下：\n经文链接：${readingUrl}\n预计完成天数：${plannedDays}天\n预计截止：${expectedDate.toLocaleDateString()}\n\n随喜赞叹。`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `【认领成功】大正新脩大藏經 诵读确认函 - ${name}`,
      text: emailBody,
    };

    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      await transporter.sendMail(mailOptions);
      console.log("Email sent successfully!");
    }

    res.json({ success: true, claim: newClaim });
  } catch (error) {
    console.error('Backend Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`\nServer Active at http://localhost:${PORT}`);
});