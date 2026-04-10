#!/usr/bin/env node
/**
 * bgb — BoardGameBuddy game pack developer CLI
 *
 * Commands:
 *   bgb new <game-id> [--name "Display Name"]   scaffold a new pack from the upstream template
 *   bgb serve [pack-dir]                         serve a pack with live reload on scorer.ts changes
 */

'use strict';

const { program } = require('commander');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '3000', 10);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Walk up from cwd to find the nearest directory containing a `games/` folder.
 * Returns the absolute path to that `games/` folder.
 */
function findGamesDir() {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, 'games');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      console.error('Error: could not find a games/ directory in any parent of the current working directory.');
      process.exit(1);
    }
    dir = parent;
  }
}

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function toTitleCase(str) {
  return str
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ─── bgb new ────────────────────────────────────────────────────────────────

program
  .command('new <game-id>')
  .description('Scaffold a new game pack from the upstream template')
  .option('-n, --name <displayName>', 'Display name for the game (defaults to title-cased game-id)')
  .action(async (gameId, opts) => {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(gameId)) {
      console.error(`Error: game-id must be lowercase alphanumeric and hyphens only (got: "${gameId}")`);
      process.exit(1);
    }

    const displayName = opts.name || toTitleCase(gameId);
    const gamesDir = findGamesDir();
    const targetDir = path.join(gamesDir, gameId);

    if (fs.existsSync(targetDir)) {
      console.error(`Error: directory already exists: ${targetDir}`);
      process.exit(1);
    }

    const templateDir = path.join(gamesDir, '_template');
    if (!fs.existsSync(templateDir)) {
      console.error(`Error: template directory not found: ${templateDir}`);
      process.exit(1);
    }

    console.log(`Copying template from ${path.relative(process.cwd(), templateDir)}...`);
    copyDirSync(templateDir, targetDir);

    // Patch game.json
    const gameJsonPath = path.join(targetDir, 'game.json');
    let gameJson = fs.readFileSync(gameJsonPath, 'utf8');
    gameJson = gameJson.replace(/"mygame"/g, `"${gameId}"`);
    gameJson = gameJson.replace(/"My Game"/g, `"${displayName}"`);
    fs.writeFileSync(gameJsonPath, gameJson);

    // Patch labels.txt (replace mygame: prefix with the actual game ID)
    const labelsPath = path.join(targetDir, 'labels.txt');
    if (fs.existsSync(labelsPath)) {
      let labels = fs.readFileSync(labelsPath, 'utf8');
      labels = labels.replace(/^mygame:/gm, `${gameId}:`);
      fs.writeFileSync(labelsPath, labels);
    }

    console.log(`\nCreated game pack: ${gameId}/`);
    console.log(`  Display name: ${displayName}`);

    console.log(`\nNext steps:`);
    console.log(`  # Edit games/${gameId}/scorer.ts to implement your scoring logic`);
    console.log(`  npm run build ${gameId}   # Compile scorer`);
    console.log(`  npm run serve ${gameId}   # Start dev server with live reload`);
    console.log(`  npm test -- --testPathPattern=${gameId}   # Run tests`);
    console.log('');
  });

// ─── bgb serve ──────────────────────────────────────────────────────────────

program
  .command('serve [pack]')
  .description('Serve a game pack with live reload on scorer.ts changes')
  .action((packArg) => {
    let packDir;
    if (packArg) {
      // Accept a pack name (e.g. "wizard") or a path (e.g. "games/wizard")
      const asGamesSubdir = path.resolve('games', packArg);
      packDir = fs.existsSync(path.join(asGamesSubdir, 'game.json')) ? asGamesSubdir : path.resolve(packArg);
    } else {
      packDir = process.cwd();
    }
    const gameJsonPath = path.join(packDir, 'game.json');

    if (!fs.existsSync(gameJsonPath)) {
      console.error(`Error: no game.json found in ${packDir}`);
      console.error('Pass a pack name (e.g. npm run serve wizard) or run from a pack directory.');
      process.exit(1);
    }

    const packName = path.basename(packDir);

    let gameJson;
    try {
      gameJson = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
    } catch (err) {
      console.error(`Error: could not parse game.json — ${err.message}`);
      process.exit(1);
    }
    const gameId = gameJson.id;

    const playgroundHtmlPath = path.join(__dirname, 'playground', 'index.html');
    const hasPlayground = fs.existsSync(playgroundHtmlPath);

    // ── Playground helpers (scoped to the current pack) ──────────────────────

    function pgGetCardIds() {
      const labelsPath = path.join(packDir, 'labels.txt');
      if (!fs.existsSync(labelsPath)) return [];
      const lines = fs.readFileSync(labelsPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
      const gamePrefix = gameJson.liveTracking?.gamePrefix;
      return gamePrefix ? lines.map(l => `${gamePrefix}:${l}`) : lines;
    }

    function pgResolveRefImage(label) {
      const colonIdx = label.indexOf(':');
      if (colonIdx === -1) return null;
      const kind = label.slice(0, colonIdx);
      const name = label.slice(colonIdx + 1);
      const refDir = path.join(packDir, 'ref', kind);
      for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
        if (fs.existsSync(path.join(refDir, name + ext))) return `${kind}/${name}${ext}`;
      }
      return null;
    }

    function pgGetCardImageMapping() {
      const labelsPath = path.join(packDir, 'labels.txt');
      if (!fs.existsSync(labelsPath)) return {};
      const lines = fs.readFileSync(labelsPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
      const gamePrefix = gameJson.liveTracking?.gamePrefix;
      const result = {};
      for (const label of lines) {
        const cardId = gamePrefix ? `${gamePrefix}:${label}` : label;
        const rel = pgResolveRefImage(label);
        if (rel) result[cardId] = rel;
      }
      return result;
    }

    function pgParseManifestYaml(text) {
      const result = {};
      let currentType = null, inSize = false, dims = [];
      for (const raw of text.split('\n')) {
        const line = raw.trimEnd();
        const indent = line.search(/\S/);
        if (indent === -1) continue;
        const content = line.trim();
        if (indent === 2 && content.endsWith(':')) {
          if (currentType && dims.length === 2) result[currentType] = dims;
          currentType = content.slice(0, -1); inSize = false; dims = [];
        } else if (indent === 4 && content === 'target_size:') {
          inSize = true;
        } else if (inSize && content.startsWith('- ')) {
          dims.push(parseInt(content.slice(2), 10));
        }
      }
      if (currentType && dims.length === 2) result[currentType] = dims;
      return result;
    }

    function pgGetCardSizes() {
      const manifestPath = path.join(packDir, 'manifest.yaml');
      if (!fs.existsSync(manifestPath)) return null;
      try { return pgParseManifestYaml(fs.readFileSync(manifestPath, 'utf8')); } catch { return null; }
    }

    const MIME = {
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.html': 'text/html',
      '.txt': 'text/plain',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };

    const sseClients = new Set();

    function broadcast(data) {
      const msg = `data: ${JSON.stringify(data)}\n\n`;
      for (const res of sseClients) res.write(msg);
    }

    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      const urlPath = req.url.split('?')[0];

      if (urlPath === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
        sseClients.add(res);

        const heartbeat = setInterval(() => res.write(': ping\n\n'), 30000);
        req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
        return;
      }

      // ── Playground routes (same port, current game only) ──────────────────

      if (hasPlayground && (urlPath === '/playground' || urlPath === '/playground/')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(playgroundHtmlPath).pipe(res);
        return;
      }

      if (urlPath === '/api/games') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([gameJson]));
        return;
      }

      let m;

      if ((m = urlPath.match(/^\/api\/games\/([^/]+)\/card-ids$/))) {
        if (m[1] !== gameId) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pgGetCardIds()));
        return;
      }

      if ((m = urlPath.match(/^\/api\/games\/([^/]+)\/card-sizes$/))) {
        if (m[1] !== gameId) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pgGetCardSizes()));
        return;
      }

      if ((m = urlPath.match(/^\/api\/games\/([^/]+)\/image-map$/))) {
        if (m[1] !== gameId) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pgGetCardImageMapping()));
        return;
      }

      if ((m = urlPath.match(/^\/api\/games\/([^/]+)\/images\/(.+)$/))) {
        if (m[1] !== gameId) { res.writeHead(404); res.end('Not found'); return; }
        const requested = decodeURIComponent(m[2]);
        const refPath = path.join(packDir, 'ref', requested);
        if (refPath.startsWith(path.join(packDir, 'ref')) && fs.existsSync(refPath) && fs.statSync(refPath).isFile()) {
          const ext = path.extname(refPath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
          fs.createReadStream(refPath).pipe(res);
          return;
        }
        res.writeHead(404); res.end('Not found'); return;
      }

      if ((m = urlPath.match(/^\/api\/games\/([^/]+)\/file\/(.+)$/))) {
        if (m[1] !== gameId) { res.writeHead(404); res.end('Not found'); return; }
        const reqFile = path.join(packDir, decodeURIComponent(m[2]));
        if (!reqFile.startsWith(packDir + path.sep)) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
        if (fs.existsSync(reqFile) && fs.statSync(reqFile).isFile()) {
          const ext = path.extname(reqFile).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
          fs.createReadStream(reqFile).pipe(res);
        } else {
          res.writeHead(404); res.end('Not found');
        }
        return;
      }

      // ── Pack file serving ─────────────────────────────────────────────────

      const filePath = path.join(packDir, urlPath === '/' ? '' : urlPath);

      if (!filePath.startsWith(packDir)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      console.log(`${req.method} ${urlPath}`);

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
      const httpUrl = `http://${ip}:${PORT}/`;
      const deeplink = `bgb://install?url=${encodeURIComponent(httpUrl)}`;

      console.log(`\nServing pack: ${packName}`);
      console.log(`URL: ${httpUrl}`);
      if (hasPlayground) {
        console.log(`Playground: http://localhost:${PORT}/playground/`);
      }
      console.log('');

      try {
        const qrcode = require('qrcode-terminal');
        qrcode.generate(deeplink, { small: true }, (qr) => {
          console.log(qr);
          console.log('Kamera-App → QR-Code scannen → Pack wird installiert.\n');
          console.log('Watching scorer.ts for changes... Press Ctrl+C to stop.\n');
        });
      } catch {
        console.log(`Kamera-App → QR-Code scannen → ${deeplink}\n`);
        console.log('Watching scorer.ts for changes... Press Ctrl+C to stop.\n');
      }
    });

    const scorerTs = path.join(packDir, 'scorer.ts');
    if (!fs.existsSync(scorerTs)) {
      console.warn('Warning: scorer.ts not found — live reload disabled.');
      return;
    }

    let debounceTimer = null;

    function recompile() {
      console.log('scorer.ts changed — recompiling...');
      const proc = spawn(
        'npx',
        ['esbuild', 'scorer.ts', '--bundle', '--platform=node', '--target=es2017', '--outfile=scorer.js'],
        { cwd: packDir }
      );

      let stderr = '';
      proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
      proc.stdout.on('data', chunk => { process.stdout.write(chunk); });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log('Recompile OK — broadcasting reload.');
          broadcast({ type: 'reload' });
        } else {
          const msg = stderr.trim() || 'Compilation failed (see above)';
          console.error(`Recompile failed:\n${msg}`);
          broadcast({ type: 'error', message: msg });
        }
      });
    }

    fs.watch(scorerTs, { persistent: true }, () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(recompile, 300);
    });
  });

// ─── bgb receive-embeddings ──────────────────────────────────────────────────

program
  .command('receive-embeddings [pack-dir]')
  .description('Start a server to receive embeddings.bin + labels.txt from the app via QR code')
  .action((packDirArg) => {
    const packDir = packDirArg ? path.resolve(packDirArg) : process.cwd();
    const gameJsonPath = path.join(packDir, 'game.json');

    if (!fs.existsSync(gameJsonPath)) {
      console.error(`Error: no game.json found in ${packDir}`);
      console.error('Run this command from a pack directory or pass the pack path as argument.');
      process.exit(1);
    }

    let gameJson;
    try {
      gameJson = JSON.parse(fs.readFileSync(gameJsonPath, 'utf8'));
    } catch (err) {
      console.error(`Error: could not parse game.json — ${err.message}`);
      process.exit(1);
    }
    const packId = gameJson.id;

    // Track received files so we can report completion when both arrive.
    let receivedLabels = false;
    let receivedBin = false;

    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      const urlPath = req.url.split('?')[0];

      if (req.method === 'GET' && urlPath === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ type: 'receive-embeddings', packId }));
        return;
      }

      // POST /upload/labels — receives labels.txt content (text/plain)
      if (req.method === 'POST' && urlPath === '/upload/labels') {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const lines = body.split('\n').filter(l => l.trim());
          if (lines.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Empty labels' }));
            return;
          }
          const outputPath = path.join(packDir, 'labels.txt');
          fs.writeFileSync(outputPath, body);
          receivedLabels = true;
          console.log(`Received labels.txt: ${lines.length} labels`);
          if (receivedLabels && receivedBin) console.log('\nAll embeddings files received. Ready to use.\n');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, labels: lines.length }));
        });
        return;
      }

      // POST /upload/bin — receives embeddings.bin content (application/octet-stream)
      if (req.method === 'POST' && urlPath === '/upload/bin') {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          const body = Buffer.concat(chunks);
          const outputPath = path.join(packDir, 'embeddings.bin');
          fs.writeFileSync(outputPath, body);
          receivedBin = true;

          // Auto-generate labels.txt from embedding count.
          // Format: N × 130 float32 values (little-endian), so N = byteLength / (130 * 4).
          const EMBEDDING_DIM = 130;
          const count = Math.floor(body.length / (EMBEDDING_DIM * 4));
          const labels = Array.from({ length: count }, (_, i) =>
            `${packId}:${String(i + 1).padStart(3, '0')}`
          ).join('\n') + '\n';
          fs.writeFileSync(path.join(packDir, 'labels.txt'), labels);

          console.log(`Received embeddings.bin: ${body.length} bytes (${count} embeddings)`);
          console.log(`Generated labels.txt: ${count} labels (${packId}:001 … ${packId}:${String(count).padStart(3, '0')})`);
          console.log(`\nEdit labels.txt to replace the auto-generated IDs with your real card IDs.\n`);
          if (receivedLabels && receivedBin) console.log('All embeddings files received. Ready to use.\n');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, bytes: body.length, count }));
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(PORT, '0.0.0.0', () => {
      const ip = getLocalIp();
      const httpUrl = `http://${ip}:${PORT}/`;
      const deeplink = `bgb://capture?packId=${encodeURIComponent(packId)}&url=${encodeURIComponent(httpUrl)}`;

      console.log(`\nWaiting for card capture session for pack: ${packId}`);
      console.log(`URL: ${httpUrl}\n`);

      try {
        const qrcode = require('qrcode-terminal');
        qrcode.generate(deeplink, { small: true }, (qr) => {
          console.log(qr);
          console.log('Kamera-App → QR-Code scannen → Karten erfassen → Hochladen.\n');
          console.log('Press Ctrl+C to stop.\n');
        });
      } catch {
        console.log(`Kamera-App → QR-Code scannen → ${deeplink}\n`);
        console.log('Press Ctrl+C to stop.\n');
      }
    });
  });

// ─── Parse ───────────────────────────────────────────────────────────────────

program
  .name('bgb')
  .description('BoardGameBuddy game pack developer CLI')
  .version('1.0.0');

program.parse(process.argv);
