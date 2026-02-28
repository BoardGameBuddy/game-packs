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
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '3000', 10);

const TEMPLATE_REPO = 'BoardGameBuddy/game-packs';
const TEMPLATE_PATH = 'games/_template';
const TEMPLATE_REF = 'main';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'bgb-cli' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(get(res.headers.location));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function githubContents(repoPath) {
  const url = `https://api.github.com/repos/${TEMPLATE_REPO}/contents/${repoPath}?ref=${TEMPLATE_REF}`;
  const { status, body } = await get(url);
  if (status !== 200) {
    throw new Error(`GitHub API returned ${status} for ${repoPath}:\n${body.toString()}`);
  }
  return JSON.parse(body.toString());
}

async function downloadTemplate(repoPath, localDir) {
  const entries = await githubContents(repoPath);
  fs.mkdirSync(localDir, { recursive: true });
  for (const entry of entries) {
    const dest = path.join(localDir, entry.name);
    if (entry.type === 'dir') {
      await downloadTemplate(entry.path, dest);
    } else if (entry.type === 'file') {
      const { status, body } = await get(entry.download_url);
      if (status !== 200) throw new Error(`Failed to download ${entry.path}: HTTP ${status}`);
      fs.writeFileSync(dest, body);
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
    const targetDir = path.join(process.cwd(), gameId);

    if (fs.existsSync(targetDir)) {
      console.error(`Error: directory already exists: ${targetDir}`);
      process.exit(1);
    }

    console.log(`Fetching template from ${TEMPLATE_REPO}...`);
    try {
      await downloadTemplate(TEMPLATE_PATH, targetDir);
    } catch (err) {
      console.error(`Error: failed to fetch template — ${err.message}`);
      process.exit(1);
    }

    // Patch game.json
    const gameJsonPath = path.join(targetDir, 'game.json');
    let gameJson = fs.readFileSync(gameJsonPath, 'utf8');
    gameJson = gameJson.replace(/"mygame"/g, `"${gameId}"`);
    gameJson = gameJson.replace(/"My Game"/g, `"${displayName}"`);
    fs.writeFileSync(gameJsonPath, gameJson);

    // Patch embeddings.json
    const embeddingsPath = path.join(targetDir, 'embeddings.json');
    if (fs.existsSync(embeddingsPath)) {
      let embeddings = fs.readFileSync(embeddingsPath, 'utf8');
      embeddings = embeddings.replace(/"mygame:/g, `"${gameId}:`);
      fs.writeFileSync(embeddingsPath, embeddings);
    }

    // Patch package.json name
    const packJsonPath = path.join(targetDir, 'package.json');
    if (fs.existsSync(packJsonPath)) {
      let packJson = fs.readFileSync(packJsonPath, 'utf8');
      packJson = packJson.replace(/"mygame"/, `"${gameId}"`);
      fs.writeFileSync(packJsonPath, packJson);
    }

    console.log(`\nCreated game pack: ${gameId}/`);
    console.log(`  Display name: ${displayName}`);
    console.log(`\nInstalling dependencies...`);

    await new Promise((resolve, reject) => {
      const proc = spawn('npm', ['install'], { cwd: targetDir, shell: true, stdio: 'inherit' });
      proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`npm install failed with code ${code}`)));
    }).catch((err) => {
      console.error(`Warning: ${err.message}`);
    });

    console.log(`\nNext steps:`);
    console.log(`  cd ${gameId}`);
    console.log(`  # Edit scorer.ts to implement your scoring logic`);
    console.log(`  bgb serve .    # Start dev server with live reload`);
    console.log('');
  });

// ─── bgb serve ──────────────────────────────────────────────────────────────

program
  .command('serve [pack-dir]')
  .description('Serve a game pack with live reload on scorer.ts changes')
  .action((packDirArg) => {
    const packDir = packDirArg ? path.resolve(packDirArg) : process.cwd();
    const gameJsonPath = path.join(packDir, 'game.json');

    if (!fs.existsSync(gameJsonPath)) {
      console.error(`Error: no game.json found in ${packDir}`);
      console.error('Run this command from a pack directory or pass the pack path as argument.');
      process.exit(1);
    }

    const packName = path.basename(packDir);

    const MIME = {
      '.json': 'application/json',
      '.js': 'application/javascript',
      '.html': 'text/html',
      '.txt': 'text/plain',
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
      const url = `http://${ip}:${PORT}/`;

      console.log(`\nServing pack: ${packName}`);
      console.log(`URL: ${url}\n`);

      try {
        const qrcode = require('qrcode-terminal');
        qrcode.generate(url, { small: true }, (qr) => {
          console.log(qr);
          console.log('In the app: Pack Store → QR-Code scannen → fertig.\n');
          console.log('Watching scorer.ts for changes... Press Ctrl+C to stop.\n');
        });
      } catch {
        console.log(`In the app: Pack Store → Von URL importieren → ${url}\n`);
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
        { cwd: packDir, shell: true }
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

// ─── Parse ───────────────────────────────────────────────────────────────────

program
  .name('bgb')
  .description('BoardGameBuddy game pack developer CLI')
  .version('1.0.0');

program.parse(process.argv);
