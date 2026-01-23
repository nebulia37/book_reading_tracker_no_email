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
  const { volumeId, name, email, phone, plannedDays, readingUrl } = req.body;

  try {
    const claimedAt = new Date().toISOString();
    
    // Prepare the data to match your Google Sheet headers
    const newClaim = {
      volumeId, name, email, phone, plannedDays, readingUrl,
      claimedAt
    };

    // Send data to SheetDB instead of saving to claims.json
    const response = await fetch('YOUR_SHEETDB_API_URL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [newClaim] }) // SheetDB expects an array inside "data"
    });

    if (response.ok) {
      console.log("Success: Saved to Google Sheets!");
      res.json({ success: true, claim: newClaim });
    } else {
      throw new Error('Failed to save to SheetDB');
    }
  } catch (error) {
    console.error('SheetDB Error:', error);
    res.status(500).json({ error: 'Failed to record claim.' });
  }
});

app.listen(PORT, () => {
  console.log(`\nServer Active at http://localhost:${PORT}`);
});

app.use(cors({
  origin: 'https://resonant-faloodeh-ad9c48.netlify.app' // Replace with your actual Netlify URL
}));