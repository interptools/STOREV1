/**
 * MyStore POS - Owner Dashboard Backend Server
 *
 * Features:
 * - SQLite database for persistence
 * - JWT authentication for owner login
 * - REST API for dashboard operations
 * - Server-Sent Events (SSE) for real-time POS sync
 * - Multi-store support with namespace isolation
 *
 * Run: node server.js
 * Default port: 3000
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mystore-pos-secret-change-in-production';
const DB_PATH = process.env.DB_PATH || './mystore.db';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ============================================
// DATABASE INITIALIZATION
// ============================================

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB Error:', err);
  else console.log('Connected to SQLite database');
});

// Initialize tables
function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Stores table
      db.run(`CREATE TABLE IF NOT EXISTS stores (
        store_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT,
        owner_password_hash TEXT,
        owner_salt TEXT,
        sync_token TEXT,
        settings TEXT DEFAULT '{}',
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )`);

      // Owner sessions
      db.run(`CREATE TABLE IF NOT EXISTS owner_sessions (
        token TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(store_id) REFERENCES stores(store_id)
      )`);

      // Shared data per store
      db.run(`CREATE TABLE IF NOT EXISTS store_shared_data (
        store_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s','now')),
        PRIMARY KEY(store_id, key),
        FOREIGN KEY(store_id) REFERENCES stores(store_id)
      )`);

      // Till-specific data per store
      db.run(`CREATE TABLE IF NOT EXISTS store_till_data (
        store_id TEXT NOT NULL,
        till_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s','now')),
        PRIMARY KEY(store_id, till_id, key),
        FOREIGN KEY(store_id) REFERENCES stores(store_id)
      )`);

      // Sync events log for SSE
      db.run(`CREATE TABLE IF NOT EXISTS sync_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        FOREIGN KEY(store_id) REFERENCES stores(store_id)
      )`);

      // Create indexes
      db.run(`CREATE INDEX IF NOT EXISTS idx_sync_events_store_time ON sync_events(store_id, created_at)`);

      console.log('Database tables initialized');
      resolve();
    });
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSyncToken() {
  return crypto.randomBytes(24).toString('hex');
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function createToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
}

// ============================================
// SSE CONNECTION MANAGEMENT
// ============================================

const sseClients = new Map(); // storeId -> Set of response objects

function addSSEClient(storeId, res) {
  if (!sseClients.has(storeId)) sseClients.set(storeId, new Set());
  sseClients.get(storeId).add(res);

  res.on('close', () => {
    const clients = sseClients.get(storeId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(storeId);
    }
  });
}

function broadcastToStore(storeId, event, data) {
  const clients = sseClients.get(storeId);
  if (!clients) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(message); } catch (e) { clients.delete(res); }
  }
}

// Log sync event and broadcast
function logSyncEvent(storeId, eventType, payload) {
  const stmt = db.prepare('INSERT INTO sync_events (store_id, event_type, payload) VALUES (?, ?, ?)');
  stmt.run(storeId, eventType, JSON.stringify(payload));
  stmt.finalize();

  broadcastToStore(storeId, eventType, payload);
}

// ============================================
// AUTH MIDDLEWARE
// ============================================

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Check session in DB
  db.get('SELECT * FROM owner_sessions WHERE token = ? AND expires_at > ?',
    [token, Date.now()], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: 'Session expired' });
    }
    req.storeId = decoded.storeId;
    req.ownerId = decoded.ownerId;
    next();
  });
}

// ============================================
// API ROUTES
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Owner login
app.post('/api/auth/login', (req, res) => {
  const { storeId, password } = req.body;
  if (!storeId || !password) {
    return res.status(400).json({ error: 'storeId and password required' });
  }

  db.get('SELECT * FROM stores WHERE store_id = ?', [storeId], (err, store) => {
    if (err || !store) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!store.owner_password_hash) {
      return res.status(401).json({ error: 'No owner account configured' });
    }

    const hash = hashPassword(password, store.owner_salt);
    if (hash !== store.owner_password_hash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const sessionToken = generateToken();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days

    db.run('INSERT INTO owner_sessions (token, store_id, expires_at) VALUES (?, ?, ?)',
      [sessionToken, storeId, expiresAt], (err) => {
      if (err) return res.status(500).json({ error: 'Session creation failed' });

      const jwtToken = createToken({ storeId, ownerId: storeId, type: 'owner' });

      res.json({
        token: jwtToken,
        store: {
          storeId: store.store_id,
          name: store.name,
          syncToken: store.sync_token
        }
      });
    });
  });
});

// Owner logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader.slice(7);

  db.run('DELETE FROM owner_sessions WHERE token = ?', [token], (err) => {
    res.json({ success: true });
  });
});

// Get store info
app.get('/api/store', authMiddleware, (req, res) => {
  db.get('SELECT store_id, name, settings, created_at FROM stores WHERE store_id = ?',
    [req.storeId], (err, store) => {
    if (err || !store) return res.status(404).json({ error: 'Store not found' });
    res.json({ ...store, settings: JSON.parse(store.settings || '{}') });
  });
});

// Update store settings
app.put('/api/store', authMiddleware, (req, res) => {
  const { settings, name } = req.body;
  const updates = [];
  const params = [];

  if (name) { updates.push('name = ?'); params.push(name); }
  if (settings) { updates.push('settings = ?'); params.push(JSON.stringify(settings)); }

  if (updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

  params.push(req.storeId);
  db.run(`UPDATE stores SET ${updates.join(', ')} WHERE store_id = ?`, params, (err) => {
    if (err) return res.status(500).json({ error: 'Update failed' });

    logSyncEvent(req.storeId, 'store-change', { storeId: req.storeId });
    res.json({ success: true });
  });
});

// ============================================
// SHARED DATA API (users, products, customers, etc.)
// ============================================

// Get all shared data for a store
app.get('/api/shared', authMiddleware, (req, res) => {
  db.all('SELECT key, value FROM store_shared_data WHERE store_id = ?', [req.storeId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    const data = {};
    for (const row of rows) {
      try { data[row.key] = JSON.parse(row.value); }
      catch { data[row.key] = row.value; }
    }
    res.json(data);
  });
});

// Get specific shared key
app.get('/api/shared/:key', authMiddleware, (req, res) => {
  db.get('SELECT value FROM store_shared_data WHERE store_id = ? AND key = ?',
    [req.storeId, req.params.key], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Not found' });

    try { res.json(JSON.parse(row.value)); }
    catch { res.send(row.value); }
  });
});

// Update shared key
app.put('/api/shared/:key', authMiddleware, (req, res) => {
  const value = JSON.stringify(req.body);

  db.run(`INSERT OR REPLACE INTO store_shared_data (store_id, key, value, updated_at)
          VALUES (?, ?, ?, ?)`,
    [req.storeId, req.params.key, value, Date.now()], (err) => {
    if (err) return res.status(500).json({ error: 'Update failed' });

    logSyncEvent(req.storeId, 'shared-update', { key: req.params.key, value: req.body });
    res.json({ success: true });
  });
});

// Delete shared key
app.delete('/api/shared/:key', authMiddleware, (req, res) => {
  db.run('DELETE FROM store_shared_data WHERE store_id = ? AND key = ?',
    [req.storeId, req.params.key], (err) => {
    if (err) return res.status(500).json({ error: 'Delete failed' });

    logSyncEvent(req.storeId, 'shared-update', { key: req.params.key, deleted: true });
    res.json({ success: true });
  });
});

// ============================================
// TILL DATA API
// ============================================

// Get all tills for a store
app.get('/api/tills', authMiddleware, (req, res) => {
  db.all(`SELECT DISTINCT till_id FROM store_till_data WHERE store_id = ?`, [req.storeId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows.map(r => r.till_id));
  });
});

// Get till data
app.get('/api/tills/:tillId', authMiddleware, (req, res) => {
  db.all('SELECT key, value FROM store_till_data WHERE store_id = ? AND till_id = ?',
    [req.storeId, req.params.tillId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    const data = {};
    for (const row of rows) {
      try { data[row.key] = JSON.parse(row.value); }
      catch { data[row.key] = row.value; }
    }
    res.json(data);
  });
});

// Update till data
app.put('/api/tills/:tillId/:key', authMiddleware, (req, res) => {
  const value = JSON.stringify(req.body);

  db.run(`INSERT OR REPLACE INTO store_till_data (store_id, till_id, key, value, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
    [req.storeId, req.params.tillId, req.params.key, value, Date.now()], (err) => {
    if (err) return res.status(500).json({ error: 'Update failed' });

    logSyncEvent(req.storeId, 'till-update', {
      tillId: req.params.tillId,
      key: req.params.key,
      value: req.body
    });
    res.json({ success: true });
  });
});

// ============================================
// POS SYNC ENDPOINTS (matching existing SYNC engine)
// ============================================

// POS pushes data to server
app.post('/sync', (req, res) => {
  const { storeId, shared, till, timestamp } = req.body;
  if (!storeId) return res.status(400).json({ error: 'storeId required' });

  // Verify store exists
  db.get('SELECT * FROM stores WHERE store_id = ?', [storeId], (err, store) => {
    if (err || !store) return res.status(404).json({ error: 'Store not found' });

    const ops = [];

    // Save shared data
    if (shared) {
      for (const [key, value] of Object.entries(shared)) {
        ops.push(new Promise((resolve) => {
          db.run(`INSERT OR REPLACE INTO store_shared_data (store_id, key, value, updated_at)
                  VALUES (?, ?, ?, ?)`,
            [storeId, key, JSON.stringify(value), timestamp || Date.now()], resolve);
        }));
      }
    }

    // Save till data
    if (till && till.tillId) {
      for (const [key, value] of Object.entries(till)) {
        if (key === 'tillId') continue;
        ops.push(new Promise((resolve) => {
          db.run(`INSERT OR REPLACE INTO store_till_data (store_id, till_id, key, value, updated_at)
                  VALUES (?, ?, ?, ?, ?)`,
            [storeId, till.tillId, key, JSON.stringify(value), timestamp || Date.now()], resolve);
        }));
      }
    }

    Promise.all(ops).then(() => {
      // Broadcast to dashboard
      if (shared) {
        for (const key of Object.keys(shared)) {
          logSyncEvent(storeId, 'shared-update', { key, value: shared[key] });
        }
      }
      if (till && till.tillId) {
        for (const key of Object.keys(till)) {
          if (key !== 'tillId') {
            logSyncEvent(storeId, 'till-update', {
              tillId: till.tillId, key, value: till[key]
            });
          }
        }
      }
      res.json({ success: true });
    }).catch(() => res.status(500).json({ error: 'Sync failed' }));
  });
});

// POS pulls data from server
app.get('/sync/:storeId', (req, res) => {
  const { storeId } = req.params;

  db.get('SELECT * FROM stores WHERE store_id = ?', [storeId], (err, store) => {
    if (err || !store) return res.status(404).json({ error: 'Store not found' });

    // Get shared data
    db.all('SELECT key, value FROM store_shared_data WHERE store_id = ?', [storeId], (err, sharedRows) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      const shared = {};
      for (const row of sharedRows) {
        try { shared[row.key] = JSON.parse(row.value); }
        catch { shared[row.key] = row.value; }
      }

      // Get all till data
      db.all('SELECT till_id, key, value FROM store_till_data WHERE store_id = ?', [storeId], (err, tillRows) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        const tills = {};
        for (const row of tillRows) {
          if (!tills[row.till_id]) tills[row.till_id] = {};
          try { tills[row.till_id][row.key] = JSON.parse(row.value); }
          catch { tills[row.till_id][row.key] = row.value; }
        }

        res.json({ storeId, shared, tills, timestamp: Date.now() });
      });
    });
  });
});

// ============================================
// SSE ENDPOINT FOR REAL-TIME UPDATES
// ============================================

app.get('/api/events', authMiddleware, (req, res) => {
  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ storeId: req.storeId })}\n\n`);

  // Add to SSE clients
  addSSEClient(req.storeId, res);
});

// ============================================
// OWNER ACCOUNT MANAGEMENT (for builder)
// ============================================

// Create owner account (called by builder during deployment)
app.post('/api/admin/create-owner', (req, res) => {
  const { storeId, storeName, email, password } = req.body;
  if (!storeId || !storeName || !password) {
    return res.status(400).json({ error: 'storeId, storeName, password required' });
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);
  const syncToken = generateSyncToken();

  db.run(`INSERT OR REPLACE INTO stores (store_id, name, owner_email, owner_password_hash, owner_salt, sync_token)
          VALUES (?, ?, ?, ?, ?, ?)`,
    [storeId, storeName, email || '', passwordHash, salt, syncToken], (err) => {
    if (err) return res.status(500).json({ error: 'Failed to create owner account' });

    res.json({
      success: true,
      storeId,
      syncToken,
      ownerCredentials: { email: email || storeId, password }
    });
  });
});

// Reset owner password
app.post('/api/admin/reset-password', (req, res) => {
  const { storeId, newPassword } = req.body;
  if (!storeId || !newPassword) {
    return res.status(400).json({ error: 'storeId and newPassword required' });
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(newPassword, salt);

  db.run('UPDATE stores SET owner_password_hash = ?, owner_salt = ? WHERE store_id = ?',
    [passwordHash, salt, storeId], (err) => {
    if (err) return res.status(500).json({ error: 'Password reset failed' });
    res.json({ success: true });
  });
});

// Get sync token for POS configuration
app.get('/api/admin/sync-token/:storeId', (req, res) => {
  db.get('SELECT sync_token FROM stores WHERE store_id = ?', [req.params.storeId], (err, row) => {
    if (err || !row) return res.status(404).json({ error: 'Store not found' });
    res.json({ syncToken: row.sync_token });
  });
});

// ============================================
// REPORTS / ANALYTICS
// ============================================

// Consolidated sales across all tills
app.get('/api/reports/consolidated', authMiddleware, (req, res) => {
  const { startDate, endDate } = req.query;

  db.all(`SELECT till_id, key, value FROM store_till_data
          WHERE store_id = ? AND key IN ('history', 'today_sales', 'today_txns', 'today_profit')`,
    [req.storeId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    const result = { tills: {}, totals: { sales: 0, txns: 0, profit: 0 } };

    for (const row of rows) {
      if (!result.tills[row.till_id]) result.tills[row.till_id] = {};
      try { result.tills[row.till_id][row.key] = JSON.parse(row.value); }
      catch { result.tills[row.till_id][row.key] = row.value; }
    }

    // Calculate totals from history
    for (const [tillId, data] of Object.entries(result.tills)) {
      if (data.history) {
        for (const txn of data.history) {
          if (txn.type === 'sale') {
            result.totals.sales += txn.total || 0;
            result.totals.txns += 1;
            result.totals.profit += (txn.total || 0) - (txn.cost || 0);
          }
        }
      }
    }

    res.json(result);
  });
});

// Employee management
app.get('/api/employees', authMiddleware, (req, res) => {
  db.get('SELECT value FROM store_shared_data WHERE store_id = ? AND key = ?',
    [req.storeId, 'users'], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    try { res.json(JSON.parse(row?.value || '[]')); }
    catch { res.json([]); }
  });
});

app.put('/api/employees', authMiddleware, (req, res) => {
  const users = req.body;
  if (!Array.isArray(users)) return res.status(400).json({ error: 'users must be array' });

  db.run(`INSERT OR REPLACE INTO store_shared_data (store_id, key, value, updated_at)
          VALUES (?, ?, ?, ?)`,
    [req.storeId, 'users', JSON.stringify(users), Date.now()], (err) => {
    if (err) return res.status(500).json({ error: 'Update failed' });

    logSyncEvent(req.storeId, 'user-change', { users });
    res.json({ success: true });
  });
});

// ============================================
// START SERVER
// ============================================

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`MyStore POS Dashboard Server running on http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/health`);
    console.log(`Sync endpoint: http://localhost:${PORT}/sync`);
  });
}).catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  db.close(() => process.exit(0));
});