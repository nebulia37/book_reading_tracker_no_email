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
  const { volumeId, name, phone, plannedDays, readingUrl } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required.' });
  }

  try {
    const claimedAt = new Date().toISOString();
    const expectedDate = new Date();
    expectedDate.setDate(new Date().getDate() + (plannedDays || 7));
    
    // Prepare the data to match your Google Sheet headers
    const newClaim = {
      volumeId, 
      name, 
      phone, 
      plannedDays, 
      readingUrl,
      claimedAt,
      expectedCompletionDate: expectedDate.toISOString(),
      status: 'claimed'
    };

    // Send data to SheetDB instead of saving to claims.json
    const response = await fetch(process.env.SHEETDB_API_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SHEETDB_API_KEY}`
      },
      body: JSON.stringify({ data: [newClaim] }) // SheetDB expects an array inside "data"
    });

    if (response.ok) {
      console.log("Success: Saved to Google Sheets!");
      res.json({ success: true, claim: newClaim });
    } else {
      const errorText = await response.text();
      console.error('SheetDB Error Response:', errorText);
      throw new Error('Failed to save to SheetDB');
    }
  } catch (error) {
    console.error('SheetDB Error:', error);
    res.status(500).json({ error: 'Failed to record claim.' });
  }
});

// server.js - Add this to let the frontend see the claims
app.get('/api/claims', async (req, res) => {
  try {
    const response = await fetch('YOUR_SHEETDB_API_URL');
    const data = await response.json();
    res.json(data); // Send the Google Sheet data back to the frontend
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch from SheetDB" });
  }
});


app.listen(PORT, () => {
  console.log(`\nServer Active at http://localhost:${PORT}`);
});

// Change this to your actual Netlify URL
app.use(cors({
  origin: 'https://your-site-name.netlify.app' 
}));

app.use(express.json());