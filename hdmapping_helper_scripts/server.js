const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = parseInt(process.argv[2]);
const ROOT = process.argv[3];
const OPEN_URL = process.argv[4];

const MIME = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.bin': 'application/octet-stream',
    '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

function handleSaveFile(req, res) {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const savePath = parsed.searchParams.get('path') || '';

    if (!savePath.startsWith('data/') || !savePath.endsWith('.json') || savePath.includes('..')) {
        res.writeHead(400);
        res.end('Invalid path');
        return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        const filePath = path.join(ROOT, savePath);
        fs.writeFileSync(filePath, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
    });
}

const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);

    if (req.method === 'POST' && urlPath === '/save-file') {
        handleSaveFile(req, res);
        return;
    }

    const filePath = path.join(ROOT, urlPath);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        const index = path.join(filePath, 'index.html');
        if (fs.existsSync(index)) {
            return serveFile(index, req, res);
        }
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    serveFile(filePath, req, res);
});

function serveFile(filePath, req, res) {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
        const parts = range.replace('bytes=', '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = end - start + 1;
        const stream = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': mime,
        });
        stream.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': mime,
            'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(filePath).pipe(res);
    }
}

server.listen(PORT, () => {
    console.log(`[server] Serving from: ${ROOT}`);
    console.log(`[server] http://localhost:${PORT}/`);
    console.log(`[server] ${OPEN_URL}`);
    console.log('[server] Press Ctrl+C to stop.');
});
