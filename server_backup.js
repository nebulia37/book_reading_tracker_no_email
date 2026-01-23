
/**
 * Taishō Tripiṭaka Backend Server
 * 
 * Features:
 * - REST API to handle claims
 * - Automated confirmation emails via Nodemailer
 * - JSON file persistence (claims.json)
 * - AI-powered confirmation message generation
 */

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Now your existing line will work:
const DB_FILE = path.join(__dirname, 'claims.json');

import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import fs from 'fs';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.VITE_GEMINI_API_KEY });

// Initialize Database File if it doesn't exist
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

// Transporter for sending emails
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Use App Password
  },
});

app.post('/api/claim', async (req, res) => {
  const { volumeId, name, email, phone, plannedDays, readingUrl } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: 'Email and Name are required.' });
  }

  try {
    // 1. Calculate dates
    const claimedAt = new Date();
    const expectedDate = new Date();
    expectedDate.setDate(claimedAt.getDate() + (plannedDays || 7));

    // 2. Persist to "Database" (JSON file)
    const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const newClaim = {
      volumeId,
      name,
      email,
      phone,
      plannedDays,
      readingUrl,
      claimedAt: claimedAt.toISOString(),
      expectedCompletionDate: expectedDate.toISOString(),
      status: 'claimed'
    };
    dbData.push(newClaim);
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));

    // 3. Generate Personalized Email Body using Gemini
    const geminiResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a formal, traditional, and respectful confirmation email in Chinese (Simplified) for a Buddhist scripture reading claim. 
      Details:
      - Claimer: ${name}
      - Scripture Link: ${readingUrl}
      - Target Days: ${plannedDays}
      - Completion Deadline: ${expectedDate.toLocaleDateString()}
      
      Ensure the tone is professional yet spiritual. Acknowledge the merit of reading the Taishō Tripiṭaka.`,
    });

    const emailBody = geminiResponse.text || `尊敬的 ${name}：\n\n您已成功认领经文诵读。详情如下：\n经文链接：${readingUrl}\n预计完成天数：${plannedDays}天\n预计截止：${expectedDate.toLocaleDateString()}\n\n随喜赞叹。`;

    // 4. Send the Email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `【认领成功】大正新脩大藏經 诵读确认函 - ${name}`,
      text: emailBody,
    };

    // Note: This requires EMAIL_USER and EMAIL_PASS to be valid in .env
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      await transporter.sendMail(mailOptions);
      console.log(`Success: Email sent and claim saved for ${email}`);
    } else {
      console.warn('Email credentials missing, skipped sending but saved record.');
    }

    res.json({ 
      success: true, 
      message: 'Claim recorded and confirmation queued.',
      claim: newClaim 
    });

  } catch (error) {
    console.error('Backend Error:', error);
    res.status(500).json({ error: 'Internal server error occurred while processing claim.' });
  }
});

app.listen(PORT, () => {
  console.log(`\n================================================`);
  console.log(`Taishō Tripiṭaka Backend Server Active`);
  console.log(`Endpoint: http://localhost:${PORT}/api/claim`);
  console.log(`Database: ${DB_FILE}`);
  console.log(`================================================\n`);
});
