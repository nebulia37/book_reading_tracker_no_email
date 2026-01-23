
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


app.post('/api/claim', async (req, res) => {
  const { volumeId, name, phone, plannedDays, readingUrl } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
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
      phone,
      plannedDays,
      readingUrl,
      claimedAt: claimedAt.toISOString(),
      expectedCompletionDate: expectedDate.toISOString(),
      status: 'claimed'
    };
    dbData.push(newClaim);
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));

    res.json({ 
      success: true, 
      message: 'Claim recorded successfully.',
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
