import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
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

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

// Cache for Supabase data to reduce API calls
let sheetCache = { data: null, timestamp: 0 };
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

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
  const { volumeId, volumeNumber, volumeTitle, name, phone, plannedDays, readingUrl, remarks } = req.body;

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

    // Check cache first
    const now = Date.now();
    if (sheetCache.data && (now - sheetCache.timestamp) < CACHE_DURATION) {
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


app.listen(PORT, () => {
  console.log(`\nServer Active at http://localhost:${PORT}`);
  console.log(`CORS enabled for all origins`);
  console.log(`Supabase configured: ${!!(SUPABASE_URL && SUPABASE_ANON_KEY)}`);
});