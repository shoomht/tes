import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API_DIR = path.join(process.cwd(), 'api');
const ROOT_DIR = process.cwd();

// ── Telegram API ──────────────────────────────────────────────────────────────

function tgRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function sendMessage(text, chatId = CHAT_ID) {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await tgRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
  } catch (e) {
    console.error('[BOT] sendMessage error:', e.message);
  }
}

async function sendDocument(filePath, caption = '', chatId = CHAT_ID) {
  if (!BOT_TOKEN || !chatId) return;
  return new Promise((resolve, reject) => {
    const fileContent = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const boundary = '----Boundary' + Date.now();
    const meta = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const end = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([meta, fileContent, end]);
    const opts = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendDocument`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function downloadFile(fileId, destPath) {
  const res = await tgRequest('getFile', { file_id: fileId });
  if (!res.ok) throw new Error('Gagal getFile dari Telegram');
  return new Promise((resolve, reject) => {
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${res.result.file_path}`;
    const file = fs.createWriteStream(destPath);
    https.get(url, r => {
      r.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
  });
}

// ── Zip project ───────────────────────────────────────────────────────────────

function zipProject(outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `cd "${ROOT_DIR}" && zip -qr "${outputPath}" . -x "node_modules/*" -x ".git/*" -x ".vercel/*" -x "*.log" -x ".env"`;
    exec(cmd, err => err ? reject(err) : resolve());
  });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleHelp(chatId) {
  await sendMessage(
    `🤖 <b>REST API Manager Bot</b>\n\n` +
    `<b>Perintah:</b>\n` +
    `/list — Lihat semua endpoint aktif\n` +
    `/delete &lt;kategori/nama&gt; — Hapus endpoint\n` +
    `/backup — Kirim backup zip source code\n` +
    `/help — Tampilkan bantuan ini\n\n` +
    `<b>Tambah Endpoint:</b>\n` +
    `Kirim file <code>.js</code> langsung ke bot.\n` +
    `Format nama: <code>kategori_nama.js</code>\n` +
    `Contoh: <code>ai_gpt.js</code> → <code>api/ai/gpt.js</code>\n` +
    `Atau: <code>gpt.js</code> → <code>api/gpt.js</code>`,
    chatId
  );
}

async function handleList(chatId) {
  const categories = {};
  let total = 0;

  function scan(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.name.endsWith('.js')) {
        const cat = path.relative(API_DIR, dir) || 'root';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(entry.name.replace('.js', ''));
        total++;
      }
    }
  }

  scan(API_DIR);

  if (total === 0) return sendMessage('📭 Tidak ada endpoint aktif.', chatId);

  let msg = `📋 <b>Endpoint Aktif (${total} total)</b>\n\n`;
  for (const [cat, files] of Object.entries(categories)) {
    msg += `📁 <b>${cat}</b>\n`;
    files.forEach(f => { msg += `  • ${f}\n`; });
    msg += '\n';
  }
  await sendMessage(msg, chatId);
}

async function handleDelete(chatId, args) {
  if (!args) return sendMessage('❌ Format: /delete &lt;kategori/nama&gt;\nContoh: /delete ai/gpt', chatId);

  const target = args.endsWith('.js') ? args : args + '.js';
  const fullPath = path.join(API_DIR, target);

  if (!fs.existsSync(fullPath)) {
    return sendMessage(`❌ File tidak ditemukan: <code>${target}</code>`, chatId);
  }

  fs.unlinkSync(fullPath);
  await sendMessage(`✅ Endpoint <code>${target}</code> berhasil dihapus.\n⚠️ Redeploy untuk menerapkan perubahan.`, chatId);
}

async function handleBackup(chatId) {
  await sendMessage('⏳ Membuat backup...', chatId);
  const zipPath = `/tmp/backup-${Date.now()}.zip`;
  try {
    await zipProject(zipPath);
    const { size } = fs.statSync(zipPath);
    await sendDocument(zipPath, `📦 Backup REST API\n🕐 ${new Date().toISOString()}\n📦 ${(size / 1024 / 1024).toFixed(2)} MB`, chatId);
    fs.unlinkSync(zipPath);
  } catch (err) {
    await sendMessage(`❌ Backup gagal: ${err.message}`, chatId);
  }
}

async function handleAddFile(chatId, document) {
  const fileName = document.file_name;
  if (!fileName.endsWith('.js')) return sendMessage('❌ Hanya file .js yang diterima.', chatId);

  await sendMessage(`⏳ Mengunduh <code>${fileName}</code>...`, chatId);
  try {
    const nameNoExt = fileName.replace('.js', '');
    let destPath;

    if (nameNoExt.includes('_')) {
      const [cat, ...rest] = nameNoExt.split('_');
      const name = rest.join('_');
      const catDir = path.join(API_DIR, cat);
      if (!fs.existsSync(catDir)) fs.mkdirSync(catDir, { recursive: true });
      destPath = path.join(catDir, `${name}.js`);
    } else {
      destPath = path.join(API_DIR, fileName);
    }

    await downloadFile(document.file_id, destPath);
    const rel = path.relative(API_DIR, destPath);
    await sendMessage(
      `✅ Endpoint ditambahkan!\n\n` +
      `📄 <code>api/${rel}</code>\n\n` +
      `⚠️ Redeploy untuk menerapkan perubahan.`,
      chatId
    );
  } catch (err) {
    await sendMessage(`❌ Gagal: ${err.message}`, chatId);
  }
}

// ── Update processor ──────────────────────────────────────────────────────────

async function processUpdate(update) {
  const msg = update.message;
  if (!msg) return;

  const chatId = String(msg.chat.id);
  if (chatId !== String(CHAT_ID)) {
    return sendMessage('⛔ Tidak diizinkan.', chatId);
  }

  if (msg.document) return handleAddFile(chatId, msg.document);

  const text = msg.text || '';
  const [cmd, ...rest] = text.trim().split(' ');
  const args = rest.join(' ').trim();

  switch (cmd.toLowerCase()) {
    case '/start':
    case '/help': return handleHelp(chatId);
    case '/list': return handleList(chatId);
    case '/delete': return handleDelete(chatId, args);
    case '/backup': return handleBackup(chatId);
    default:
      if (text.startsWith('/')) await sendMessage('❓ Perintah tidak dikenal. Ketik /help.', chatId);
  }
}

// ── Polling ───────────────────────────────────────────────────────────────────

let offset = 0;

async function poll() {
  if (!BOT_TOKEN) return;
  try {
    const res = await tgRequest('getUpdates', { offset, timeout: 30, limit: 10 });
    if (res.ok && res.result.length > 0) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        processUpdate(update).catch(e => console.error('[BOT] error:', e.message));
      }
    }
  } catch (e) {
    console.error('[BOT] poll error:', e.message);
  }
  setTimeout(poll, 1000);
}

export function startBot() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[BOT] Bot tidak aktif — set TELEGRAM_BOT_TOKEN & TELEGRAM_CHAT_ID di .env');
    return;
  }
  console.log('[BOT] Bot Telegram aktif...');
  poll();
}