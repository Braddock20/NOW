const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const cors = require('cors');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const P = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const SESSIONS_DIR = path.join(__dirname, 'sessions');

// Ensure sessions dir exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// In-memory active sockets (for multiple users)
const activeSockets = new Map();

// Generate unique session ID
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

app.post('/start-session', async (req, res) => {
  const { phoneNumber } = req.body; // e.g., "254712345678" (no +)
  
  if (!phoneNumber || phoneNumber.length < 10) {
    return res.status(400).json({ error: 'Valid phone number required (country code, no +)' });
  }

  const sessionId = generateSessionId();
  const sessionPath = path.join(SESSIONS_DIR, sessionId);

  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: P({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Chrome', 'Linux', 'Desktop'], // Helps with pairing
    });

    activeSockets.set(sessionId, { sock, sessionPath });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (connection === 'open') {
        console.log(`Session ${sessionId} connected successfully!`);
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          // Optional: auto-reconnect logic
        } else {
          activeSockets.delete(sessionId);
        }
      }
    });

    // Request pairing code (updated method)
    setTimeout(async () => {
      try {
        if (!sock.authState.creds.registered) {
          const code = await sock.requestPairingCode(phoneNumber);
          res.json({ 
            success: true, 
            sessionId, 
            pairingCode: code 
          });
        }
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to generate pairing code' });
      }
    }, 2000);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/download-session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sessionPath = path.join(SESSIONS_DIR, sessionId);

  if (!fs.existsSync(sessionPath)) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const zipName = `${sessionId}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename=${zipName}`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  archive.directory(sessionPath, false);
  archive.finalize();

  // Optional: clean up after download (uncomment if wanted)
  // archive.on('end', () => {
  //   fs.rmSync(sessionPath, { recursive: true, force: true });
  // });
});

app.get('/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  res.json({ connected: activeSockets.has(sessionId) });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
