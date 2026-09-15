const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = parseInt(process.argv[2]);
const ROOT = path.resolve(process.argv[3]);
const OPEN_URL = process.argv[4];

// The viewer only persists flags. Everything else under data/ (metadata.json,
// trajectory.json, ...) must stay read-only for clients on the network.
const SAVE_PATH_RE = /^data\/[^/\\]+\/flags\.json$/;
const MAX_SAVE_BYTES = 1024 * 1024;

const MIME = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml', '.bin': 'application/octet-stream',
    '.wasm': 'application/wasm', '.ico': 'image/x-icon',
};

// Join a request path onto ROOT; null if the result escapes ROOT (e.g. "/..%2f").
function resolveInRoot(relPath) {
    const filePath = path.join(ROOT, relPath);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        return null;
    }
    return filePath;
}

function statOrNull(filePath) {
    try {
        return fs.statSync(filePath);
    } catch (err) {
        return null;
    }
}

function sendError(res, status, message, headers = {}) {
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.writeHead(status, { 'Content-Type': 'text/plain', ...headers });
    res.end(message);
}

function handleSaveFile(req, res) {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const savePath = parsed.searchParams.get('path') || '';

    const filePath = SAVE_PATH_RE.test(savePath) && !savePath.includes('..')
        ? resolveInRoot(savePath)
        : null;
    if (!filePath) {
        sendError(res, 400, 'Invalid path');
        return;
    }
    if (!statOrNull(path.dirname(filePath))) {
        sendError(res, 404, 'Dataset not found');
        return;
    }

    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
        size += chunk.length;
        if (size <= MAX_SAVE_BYTES) {
            chunks.push(chunk);
        }
    });
    req.on('end', () => {
        if (size > MAX_SAVE_BYTES) {
            sendError(res, 413, 'Payload too large');
            return;
        }
        fs.writeFile(filePath, Buffer.concat(chunks), err => {
            if (err) {
                console.error(`[server] Failed to save ${savePath}: ${err.message}`);
                sendError(res, 500, 'Write failed');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
        });
    });
}

// Parse a single "bytes=start-end" range, including the suffix form "bytes=-N".
// Returns {start, end}, 'unsatisfiable', or null to ignore the header and send
// the whole file (malformed or multi-range requests).
function parseRange(header, size) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
        return null;
    }

    let start, end;
    if (m[1] === '') {
        const suffixLength = parseInt(m[2], 10);
        start = Math.max(0, size - suffixLength);
        end = size - 1;
        if (suffixLength === 0) {
            return 'unsatisfiable';
        }
    } else {
        start = parseInt(m[1], 10);
        end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
    }

    if (start >= size || start > end) {
        return 'unsatisfiable';
    }
    return { start, end };
}

const server = http.createServer((req, res) => {
    try {
        let urlPath;
        try {
            urlPath = decodeURIComponent(req.url.split('?')[0]);
        } catch (err) {
            sendError(res, 400, 'Bad request');
            return;
        }

        if (req.method === 'POST' && urlPath === '/save-file') {
            handleSaveFile(req, res);
            return;
        }

        let filePath = resolveInRoot(urlPath);
        if (!filePath) {
            sendError(res, 403, 'Forbidden');
            return;
        }

        let stat = statOrNull(filePath);
        if (stat && stat.isDirectory()) {
            filePath = path.join(filePath, 'index.html');
            stat = statOrNull(filePath);
        }
        if (!stat || !stat.isFile()) {
            sendError(res, 404, 'Not found');
            return;
        }
        serveFile(filePath, stat, req, res);
    } catch (err) {
        console.error(`[server] ${req.method} ${req.url}: ${err.message}`);
        sendError(res, 500, 'Internal error');
    }
});

function serveFile(filePath, stat, req, res) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range ? parseRange(req.headers.range, stat.size) : null;

    if (range === 'unsatisfiable') {
        sendError(res, 416, 'Range not satisfiable', { 'Content-Range': `bytes */${stat.size}` });
        return;
    }

    let stream;
    if (range) {
        res.writeHead(206, {
            'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': range.end - range.start + 1,
            'Content-Type': mime,
        });
        stream = fs.createReadStream(filePath, range);
    } else {
        res.writeHead(200, {
            'Content-Length': stat.size,
            'Content-Type': mime,
            'Accept-Ranges': 'bytes',
        });
        stream = fs.createReadStream(filePath);
    }
    // An unhandled stream error (e.g. file deleted mid-read) would crash the server.
    stream.on('error', () => res.destroy());
    stream.pipe(res);
}

server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[server] Port ${PORT} is already in use. Is another viewer still running?`);
    } else {
        console.error(`[server] ${err.message}`);
    }
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`[server] Serving from: ${ROOT}`);
    console.log(`[server] http://localhost:${PORT}/`);
    console.log(`[server] ${OPEN_URL}`);
    console.log('[server] Press Ctrl+C to stop.');
});
