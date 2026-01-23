import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
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

app.post('/api/claim', async (req, res) => {
  console.log("Received claim data:", req.body);
  const { volumeId, name, phone, plannedDays, readingUrl } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  try {
    const claimedAt = new Date();
    const expectedDate = new Date();
    expectedDate.setDate(claimedAt.getDate() + (plannedDays || 7));

    const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const newClaim = {
      volumeId, name, phone, plannedDays, readingUrl,
      claimedAt: claimedAt.toISOString(),
      expectedCompletionDate: expectedDate.toISOString(),
      status: 'claimed'
    };
    dbData.push(newClaim);
    fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2));

    res.json({ success: true, claim: newClaim });
  } catch (error) {
    console.error('Backend Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`\nServer Active at http://localhost:${PORT}`);
});