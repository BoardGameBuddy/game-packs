#!/usr/bin/env node
/**
 * bgb — BoardGameBuddy game pack developer CLI
 *
 * Commands:
 *   bgb new <game-id> [--name "Display Name"]   scaffold a new pack from _template
 *   bgb serve [pack-dir]                         serve a pack with live reload on scorer.ts changes
 */

'use strict';

const { program } = require('commander');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '3000', 10);

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

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ─── bgb new ────────────────────────────────────────────────────────────────

program
  .command('new <game-id>')
  .description('Scaffold a new game pack from the _template directory')
  .option('-n, --name <displayName>', 'Display name for the game (defaults to title-cased game-id)')
  .action((gameId, opts) => {
    // Validate game-id
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(gameId)) {
      console.error(`Error: game-id must be lowercase alphanumeric and hyphens only (got: "${gameId}")`);
      process.exit(1);
    }

    const displayName = opts.name || toTitleCase(gameId);
    const templateDir = path.join(__dirname, 'games', '_template');
    const targetDir = path.join(process.cwd(), 'games', gameId);

    if (!fs.existsSync(templateDir)) {
      console.error(`Error: template directory not found at ${templateDir}`);
      process.exit(1);
    }

    if (fs.existsSync(targetDir)) {
      console.error(`Error: directory already exists: ${targetDir}`);
      process.exit(1);
    }

    // Copy template
    copyDirRecursive(templateDir, targetDir);

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

    console.log(`\nCreated game pack: games/${gameId}/`);
    console.log(`  Display name: ${displayName}`);
    console.log(`\nNext steps:`);
    console.log(`  cd games/${gameId}`);
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

    // SSE clients
    const sseClients = new Set();

    function broadcast(data) {
      const msg = `data: ${JSON.stringify(data)}\n\n`;
      for (const res of sseClients) {
        res.write(msg);
      }
    }

    // HTTP server
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

      const urlPath = req.url.split('?')[0];

      // SSE endpoint
      if (urlPath === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
        sseClients.add(res);

        const heartbeat = setInterval(() => {
          res.write(': ping\n\n');
        }, 30000);

        req.on('close', () => {
          clearInterval(heartbeat);
          sseClients.delete(res);
        });
        return;
      }

      // Static file serving
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
        console.log('(Install qrcode-terminal for QR display: npm install -D qrcode-terminal)\n');
        console.log(`In the app: Pack Store → Von URL importieren → ${url}\n`);
        console.log('Watching scorer.ts for changes... Press Ctrl+C to stop.\n');
      }
    });

    // TypeScript watch + recompile
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
        ['tsc', 'scorer.ts', '--outDir', '.', '--target', 'ES2017', '--module', 'commonjs', '--skipLibCheck'],
        { cwd: packDir, shell: true }
      );

      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.stdout.on('data', (chunk) => { process.stdout.write(chunk); });

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
