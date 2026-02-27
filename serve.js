#!/usr/bin/env node
/**
 * BoardGameBuddy pack server — run from inside a game pack directory.
 *
 *   cd game-packs/wizard
 *   node ../serve.js
 *
 * Serves the current directory over HTTP, prints the URL, and displays
 * a QR code for easy import via the app's QR scanner.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.PORT || '3000', 10);
const dir = process.cwd();

const MIME = {
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.html': 'text/html',
  '.txt': 'text/plain',
};

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlPath = req.url.split('?')[0];
  const filePath = path.join(dir, urlPath === '/' ? '' : urlPath);

  if (!filePath.startsWith(dir)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  console.log(`${req.method} ${urlPath} ${filePath}`);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIp();
  const url = `http://${ip}:${PORT}/`;
  const packName = path.basename(dir);

  console.log(`\n📦  Serving pack: ${packName}`);
  console.log(`🌐  ${url}\n`);

  try {
    const qrcode = require('qrcode-terminal');
    qrcode.generate(url, { small: true }, (qr) => {
      console.log(qr);
      console.log(`In the app: Pack Store → QR-Code scannen → fertig.\n`);
      console.log('Press Ctrl+C to stop.\n');
    });
  } catch {
    console.log('(Install qrcode-terminal for QR display: npm install -D qrcode-terminal)\n');
    console.log(`In the app: Pack Store → Von URL importieren → ${url}\n`);
    console.log('Press Ctrl+C to stop.\n');
  }
});
