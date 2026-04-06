#!/usr/bin/env node
// BoardGameBuddy Playground — scorer testing & debugging UI.
//   cd game-packs/playground && node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3333', 10);
const GAMES_DIR = path.join(__dirname, '..', 'games');

const MIME = {
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function listGames() {
  const games = [];
  for (const dir of fs.readdirSync(GAMES_DIR)) {
    if (dir.startsWith('_') || dir === 'img') continue;
    const p = path.join(GAMES_DIR, dir, 'game.json');
    if (fs.existsSync(p)) {
      try { games.push(JSON.parse(fs.readFileSync(p, 'utf8'))); } catch {}
    }
  }
  return games;
}


function readGameJson(gameId) {
  try { return JSON.parse(fs.readFileSync(path.join(GAMES_DIR, gameId, 'game.json'), 'utf8')); } catch { return {}; }
}

function getCardIds(gameId) {
  const gameDir = path.join(GAMES_DIR, gameId);
  const labelsPath = path.join(gameDir, 'labels.txt');
  if (fs.existsSync(labelsPath)) {
    const lines = fs.readFileSync(labelsPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    const prefix = readGameJson(gameId).liveTracking?.gamePrefix;
    return prefix ? lines.map(l => `${prefix}:${l}`) : lines;
  }
  return [];
}

// Resolve a label like "card:blue-01" to its ref image path relative to games/{gameId}/ref/
// Returns e.g. "card/blue-01.png" or null if not found.
function resolveRefImage(gameId, label) {
  const colonIdx = label.indexOf(':');
  if (colonIdx === -1) return null;
  const kind = label.slice(0, colonIdx);
  const name = label.slice(colonIdx + 1);
  const refDir = path.join(GAMES_DIR, gameId, 'ref', kind);
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    if (fs.existsSync(path.join(refDir, name + ext))) return `${kind}/${name}${ext}`;
  }
  return null;
}

// Build a cardId → image filename mapping for the client.
// For games with labels.txt the filename is a ref-relative path (e.g. "card/blue-01.png").
// For fallback games it is a flat filename served from IMG_DIR.
function getCardImageMapping(gameId) {
  const gameDir = path.join(GAMES_DIR, gameId);
  const labelsPath = path.join(gameDir, 'labels.txt');
  if (fs.existsSync(labelsPath)) {
    const lines = fs.readFileSync(labelsPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    const prefix = readGameJson(gameId).liveTracking?.gamePrefix;
    const result = {};
    for (const label of lines) {
      const cardId = prefix ? `${prefix}:${label}` : label;
      const rel = resolveRefImage(gameId, label);
      if (rel) result[cardId] = rel;
    }
    return result;
  }
  // Fallback: flat image directory (legacy, for games without labels.txt)
  const IMG_DIR = path.join(GAMES_DIR, 'img', 'ref');
  const dir = path.join(IMG_DIR, gameId);
  const flatMap = new Map();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (/\.(png|jpg|jpeg|webp|svg)$/i.test(f)) flatMap.set(f.replace(/[:\uF03A]/g, ''), f);
    }
  }
  const ids = getCardIds(gameId);
  const prefix = readGameJson(gameId).liveTracking?.gamePrefix;
  const result = {};
  for (const cardId of ids) {
    let label = cardId;
    if (prefix && cardId.startsWith(prefix + ':')) label = cardId.slice(prefix.length + 1);
    const key = label.replace(/[:\uF03A]/g, '');
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const f = flatMap.get(key + ext) || flatMap.get(label + ext);
      if (f) { result[cardId] = f; break; }
    }
  }
  return result;
}

function parseManifestYaml(text) {
  // Minimal parser for the fixed manifest.yaml shape:
  //   card_types:
  //     {kind}:
  //       target_size:
  //       - {w}
  //       - {h}
  const result = {};
  let currentType = null;
  let inSize = false;
  let dims = [];
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

function getCardSizes(gameId) {
  const manifestPath = path.join(GAMES_DIR, gameId, 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) return null;
  try { return parseManifestYaml(fs.readFileSync(manifestPath, 'utf8')); } catch { return null; }
}

function serveFile(filePath, res) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  if (url === '/' || url === '/index.html') {
    return serveFile(path.join(__dirname, 'index.html'), res);
  }

  if (url === '/api/games') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(listGames()));
  }

  let m;

  if ((m = url.match(/^\/api\/games\/([^/]+)\/card-ids$/))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getCardIds(m[1])));
  }

  if ((m = url.match(/^\/api\/games\/([^/]+)\/card-sizes$/))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getCardSizes(m[1])));
  }

  if ((m = url.match(/^\/api\/games\/([^/]+)\/image-map$/))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getCardImageMapping(m[1])));
  }

  if ((m = url.match(/^\/api\/games\/([^/]+)\/images\/(.+)$/))) {
    const gameId = m[1];
    const requested = decodeURIComponent(m[2]);
    // Primary: ref/ directory (filename is a relative path like "card/blue-01.png")
    const refPath = path.join(GAMES_DIR, gameId, 'ref', requested);
    if (refPath.startsWith(path.join(GAMES_DIR, gameId, 'ref')) && fs.existsSync(refPath) && fs.statSync(refPath).isFile()) {
      return serveFile(refPath, res);
    }
    // Fallback: legacy flat image directory
    const legacyPath = path.join(GAMES_DIR, 'img', 'ref', gameId, requested);
    if (legacyPath.startsWith(path.join(GAMES_DIR, 'img', 'ref', gameId)) && fs.existsSync(legacyPath) && fs.statSync(legacyPath).isFile()) {
      return serveFile(legacyPath, res);
    }
    res.writeHead(404); return res.end('Not found');
  }

  if ((m = url.match(/^\/api\/games\/([^/]+)\/file\/(.+)$/))) {
    const filePath = path.join(GAMES_DIR, m[1], decodeURIComponent(m[2]));
    if (!filePath.startsWith(path.join(GAMES_DIR, m[1]))) {
      res.writeHead(403); return res.end('Forbidden');
    }
    return serveFile(filePath, res);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\nPlayground running at http://localhost:${PORT}/\n`);
});
