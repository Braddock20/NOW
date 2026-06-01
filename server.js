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

if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

const activeSockets = new Map();

function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

app.post('/start-session', async (req, res) => {
  let { phoneNumber } = req.body;
  
  if (!phoneNumber) {
    return res.status(400).json({ error: 'Phone number is required' });
  }

  // Clean phone number
  phoneNumber = phoneNumber.replace(/\D/g, ''); // Remove non-digits
  
  if (phoneNumber.length < 10) {
    return res.status(400).json({ error: 'Invalid phone number' });
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
      browser: ['Ubuntu', 'Chrome', '20.0.04'], // More stable browser fingerprint
      markOnlineOnConnect: false,
    });

    activeSockets.set(sessionId, { sock, sessionPath });

    sock.ev.on('creds.update', saveCreds);

    let pairingRequested = false;

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        console.log(`✅ Session ${sessionId} connected!`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode !== DisconnectReason.loggedOut) {
          console.log('Reconnecting...');
        } else {
          activeSockets.delete(sessionId);
        }
      }
    });

    // Request pairing code with better timing and retry
    setTimeout(async () => {
      try {
        if (!sock.authState.creds.registered && !pairingRequested) {
          pairingRequested = true;
          
          console.log(`Requesting pairing code for ${phoneNumber}...`);
          const code = await sock.requestPairingCode(phoneNumber);
          
          console.log(`Pairing code generated: ${code}`);
          
          res.json({ 
            success: true, 
            sessionId, 
            pairingCode: code,
            message: 'Enter this code in WhatsApp → Linked Devices'
          });
        }
      } catch (err) {
        console.error('Pairing code error:', err);
        res.status(500).json({ 
          error: 'Failed to generate pairing code. Try a different number or wait 5 minutes.' 
        });
      }
    }, 1500);

  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Keep other routes same
app.get('/download-session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const sessionPath = path.join(SESSIONS_DIR, sessionId);

  if (!fs.existsSync(sessionPath)) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }

  const zipName = `${sessionId}.zip`;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename=${zipName}`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  archive.directory(sessionPath, false);
  archive.finalize();
});

app.get('/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  res.json({ 
    connected: activeSockets.has(sessionId),
    exists: fs.existsSync(path.join(SESSIONS_DIR, sessionId))
  });
});

app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Session Downloader running on port ${PORT}`);
});
