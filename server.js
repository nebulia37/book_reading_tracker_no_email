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
  const { volumeId, volumeNumber, volumeTitle, name, phone, plannedDays, readingUrl } = req.body;

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
      volumeNumber,
      volumeTitle,
      name, 
      phone, 
      plannedDays, 
      readingUrl,
      claimedAt,
      expectedCompletionDate: expectedDate.toISOString(),
      status: 'claimed'
    };

    console.log("Sending to SheetDB:", newClaim);

    // Send data to SheetDB (don't fail if SheetDB is not configured)
    try {
      if (process.env.SHEETDB_API_URL) {
        const headers = {
          'Content-Type': 'application/json'
        };

        // Add Authorization header only if API key is provided
        if (process.env.SHEETDB_API_KEY) {
          headers['Authorization'] = `Bearer ${process.env.SHEETDB_API_KEY}`;
        }

        console.log('Posting to SheetDB:', process.env.SHEETDB_API_URL);
        const sheetResponse = await fetch(process.env.SHEETDB_API_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify({ data: [newClaim] })
        });

        const responseText = await sheetResponse.text();
        console.log('SheetDB response status:', sheetResponse.status);
        console.log('SheetDB response:', responseText);

        if (sheetResponse.ok) {
          console.log("Success: Saved to Google Sheets!");
        } else {
          console.warn('SheetDB save failed:', sheetResponse.status, responseText);
        }
      } else {
        console.warn('SheetDB not configured, claim saved locally only');
      }
    } catch (sheetError) {
      console.warn('SheetDB error:', sheetError.message, '- claim saved locally only');
    }

    res.json({ success: true, claim: newClaim });
  } catch (error) {
    console.error('SheetDB Error:', error);
    res.status(500).json({ error: 'Failed to record claim.' });
  }
});

// server.js - Add this to let the frontend see the claims
app.get('/api/claims', async (req, res) => {
  try {
    if (!process.env.SHEETDB_API_URL) {
      return res.json({ data: [] }); // Return empty array if not configured
    }

    const headers = {
      'Content-Type': 'application/json'
    };

    if (process.env.SHEETDB_API_KEY) {
      headers['Authorization'] = `Bearer ${process.env.SHEETDB_API_KEY}`;
    }

    const response = await fetch(process.env.SHEETDB_API_URL, { headers });

    if (!response.ok) {
      throw new Error(`SheetDB responded with status: ${response.status}`);
    }

    const data = await response.json();
    res.json(data); // Send the Google Sheet data back to the frontend
  } catch (error) {
    console.error('Error fetching from SheetDB:', error);
    res.status(500).json({ error: "Failed to fetch from SheetDB", details: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`\nServer Active at http://localhost:${PORT}`);
  console.log(`CORS enabled for all origins`);
  console.log(`SheetDB configured: ${!!process.env.SHEETDB_API_URL}`);
});