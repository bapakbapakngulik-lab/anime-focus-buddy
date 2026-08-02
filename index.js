/**
 * Anime Focus Buddy — server Express + Gemini API.
 * Final Project Hacktiv8: AI Productivity and AI API Integration for Developers.
 *
 * Pola konfigurasi (dotenv + express + cors + @google/genai) mengikuti materi
 * Sesi 2 & 3. Nama model tidak lagi dipaku ke `gemini-2.5-flash` seperti di slide
 * karena model itu sudah ditolak untuk API key baru — lihat src/gemini.js.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createStore,
  setActiveTask,
  parkIdea,
  completeTask,
  dropTask,
  endBreak,
  pushHistory,
  summarize,
} from './src/session.js';
import {
  CHARACTERS,
  DEFAULT_CHARACTER,
  buildSystemInstruction,
  buildCoachPrompt,
  buildBreakdownPrompt,
  BREAKDOWN_SCHEMA,
  toContents,
  spriteFor,
  paramsFor,
  localLine,
  LOCAL_EVENTS,
} from './src/prompt.js';
import { usage } from './src/quota.js';
import {
  generateText,
  generateJson,
  isLive,
  getModel,
  describeError,
  inspectKey,
} from './src/gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const store = createStore();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/** Sesi diambil dari header/body; MVP memakai satu sesi default per browser. */
function sessionFrom(req) {
  const id = req.body?.sessionId || req.query?.sessionId || 'default';
  return store.get(String(id));
}

function characterFrom(req) {
  const id = req.body?.character || req.query?.character || DEFAULT_CHARACTER;
  return CHARACTERS[id] ? id : DEFAULT_CHARACTER;
}

/**
 * Payload standar yang dikembalikan hampir semua endpoint.
 * `params` ikut dikirim supaya konfigurasi Gemini yang sedang dipakai
 * terlihat langsung di UI — bukan tersembunyi di dalam kode.
 */
function statePayload(session, characterId, lastEvent, mode = 'chat') {
  return {
    state: summarize(session),
    sprite: spriteFor(characterId, session.phase, lastEvent),
    character: CHARACTERS[characterId],
    params: paramsFor(characterId, mode),
    quota: usage(),
  };
}

// ---------------------------------------------------------------- meta

app.get('/api/health', (req, res) => {
  const key = inspectKey();
  res.json({
    ok: true,
    model: getModel(),
    mode: isLive() ? 'gemini' : 'demo',
    keyOk: key.ok,
    keyHint: key.ok ? (key.warning ?? null) : key.hint,
    keyFormat: key.format ?? null,
    quota: usage(),
  });
});

app.get('/api/characters', (req, res) => {
  res.json({ characters: Object.values(CHARACTERS), default: DEFAULT_CHARACTER });
});

app.get('/api/state', (req, res) => {
  const session = sessionFrom(req);
  res.json(statePayload(session, characterFrom(req)));
});

// ---------------------------------------------------------------- tugas

/**
 * Menetapkan SATU tugas aktif.
 * Kalau sudah ada yang aktif, request ditolak (409) dan judul barunya
 * otomatis diparkir — buddy lalu menjelaskan kenapa.
 */
app.post('/api/task', async (req, res) => {
  const session = sessionFrom(req);
  const characterId = characterFrom(req);
  const result = setActiveTask(session, req.body?.title);

  if (!result.ok && result.reason === 'EMPTY_TASK') {
    return res.status(400).json({ error: 'Judul tugas tidak boleh kosong.' });
  }

  if (!result.ok && result.reason === 'ACTIVE_TASK_EXISTS') {
    const { text, source } = await safeGenerate({
      characterId,
      session,
      prompt:
        `Pengguna mencoba menambah tugas baru "${String(req.body.title).trim()}" ` +
        `padahal masih ada tugas aktif. Ide barunya sudah kuparkir. ` +
        `Tolak dengan hangat dan arahkan dia kembali ke tugas aktif.`,
    });
    return res.status(409).json({
      error: 'ACTIVE_TASK_EXISTS',
      reply: text,
      source,
      ...statePayload(session, characterId),
    });
  }

  const { text, source } = await safeGenerate({
    characterId,
    session,
    prompt: buildCoachPrompt('start'),
    event: 'start',
  });
  res.json({ reply: text, source, ...statePayload(session, characterId) });
});

app.post('/api/task/complete', async (req, res) => {
  const session = sessionFrom(req);
  const characterId = characterFrom(req);
  const result = completeTask(session);
  if (!result.ok) {
    return res.status(400).json({ error: 'Belum ada tugas aktif untuk diselesaikan.' });
  }
  const { text, source } = await safeGenerate({
    characterId,
    session,
    prompt: buildCoachPrompt('complete'),
    event: 'complete',
  });
  res.json({ reply: text, source, ...statePayload(session, characterId, 'complete') });
});

app.post('/api/task/drop', async (req, res) => {
  const session = sessionFrom(req);
  const characterId = characterFrom(req);
  const result = dropTask(session);
  if (!result.ok) {
    return res.status(400).json({ error: 'Belum ada tugas aktif.' });
  }
  const { text, source } = await safeGenerate({
    characterId,
    session,
    prompt: buildCoachPrompt('giveup'),
    event: 'giveup',
  });
  res.json({ reply: text, source, ...statePayload(session, characterId) });
});

app.post('/api/break/end', async (req, res) => {
  const session = sessionFrom(req);
  const characterId = characterFrom(req);
  const result = endBreak(session);
  if (!result.ok) {
    return res.status(400).json({ error: 'Sesi sedang tidak dalam mode istirahat.' });
  }
  const { text, source } = await safeGenerate({
    characterId,
    session,
    prompt: buildCoachPrompt('break_over'),
    event: 'break_over',
  });
  res.json({ reply: text, source, ...statePayload(session, characterId) });
});

/** Menyimpan distraksi/ide ke "parkiran" tanpa mengganggu tugas aktif. */
app.post('/api/park', (req, res) => {
  const session = sessionFrom(req);
  const result = parkIdea(session, req.body?.idea);
  if (!result.ok) {
    return res.status(400).json({ error: 'Ide tidak boleh kosong.' });
  }
  const characterId = characterFrom(req);
  res.json({
    reply: localLine(characterId, 'park') ?? 'Sudah kuparkir. Balik ke tugasmu ya.',
    source: 'local',
    ...statePayload(session, characterId),
  });
});

// ---------------------------------------------------------------- AI

/** Chat bebas dengan buddy. */
app.post('/api/chat', async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
  }
  const session = sessionFrom(req);
  const characterId = characterFrom(req);

  try {
    const { text, source } = await generateText({
      systemInstruction: buildSystemInstruction(characterId, session),
      contents: toContents(session.history, message),
      params: paramsFor(characterId, 'chat'),
    });
    pushHistory(session, 'user', message);
    pushHistory(session, 'buddy', text);
    res.json({ reply: text, source, ...statePayload(session, characterId) });
  } catch (err) {
    res.status(502).json({ error: describeError(err), detail: err.message });
  }
});

/** Dorongan singkat yang dipicu tombol UI, bukan ketikan pengguna. */
app.post('/api/coach', async (req, res) => {
  const session = sessionFrom(req);
  const characterId = characterFrom(req);
  const event = String(req.body?.event ?? 'start');
  const { text, source } = await safeGenerate({
    characterId,
    session,
    prompt: buildCoachPrompt(event),
    event,
  });
  res.json({ reply: text, source, ...statePayload(session, characterId, event) });
});

/** Memecah tugas aktif jadi maksimal 3 langkah mikro (output JSON terstruktur). */
app.post('/api/breakdown', async (req, res) => {
  const session = sessionFrom(req);
  const characterId = characterFrom(req);
  const title = String(req.body?.title ?? session.activeTask?.title ?? '').trim();
  if (!title) {
    return res.status(400).json({ error: 'Belum ada tugas untuk dipecah.' });
  }

  try {
    const { data, source } = await generateJson({
      systemInstruction: buildSystemInstruction(characterId, session),
      prompt: buildBreakdownPrompt(title),
      schema: BREAKDOWN_SCHEMA,
      params: paramsFor(characterId, 'breakdown'),
    });
    if (session.activeTask) {
      session.activeTask.microSteps = (data.steps ?? []).slice(0, 3);
    }
    res.json({ breakdown: data, source, ...statePayload(session, characterId, null, 'breakdown') });
  } catch (err) {
    res.status(502).json({ error: describeError(err), detail: err.message });
  }
});

app.post('/api/reset', (req, res) => {
  const id = req.body?.sessionId || 'default';
  const session = store.reset(String(id));
  res.json(statePayload(session, characterFrom(req)));
});

/**
 * Panggilan Gemini yang tidak boleh menjatuhkan aksi utama:
 * kalau AI gagal, state tugas/timer tetap benar dan pengguna dapat pesan cadangan.
 */
async function safeGenerate({ characterId, session, prompt, event }) {
  // Hemat kuota: aksi rutin dijawab kalimat lokal, tanpa memanggil Gemini.
  // Free tier cuma 20 request/hari — lihat src/quota.js.
  if (event && LOCAL_EVENTS.has(event)) {
    const line = localLine(characterId, event);
    if (line) return { text: line, source: 'local' };
  }
  try {
    return await generateText({
      systemInstruction: buildSystemInstruction(characterId, session),
      contents: toContents([], prompt),
      params: paramsFor(characterId, 'coach'),
    });
  } catch (err) {
    // Aksinya sendiri sudah berhasil; yang gagal cuma kalimat penyemangatnya.
    // Alasannya tetap ditampilkan supaya tombol tidak terasa "tidak berfungsi".
    return {
      text: `Kamu jalan terus ya. 💪 (buddy lagi bisu: ${describeError(err)})`,
      source: 'error',
    };
  }
}

app.listen(PORT, () => {
  console.log(`Anime Focus Buddy ready on http://localhost:${PORT}`);
  console.log(`Mode: ${isLive() ? `Gemini (${getModel()})` : 'DEMO (GEMINI_API_KEY belum diisi)'}`);

  // Deteksi dini: lebih baik ketahuan di terminal daripada baru terasa
  // saat pengguna mengetik pesan pertama.
  const key = inspectKey();
  if (isLive() && !key.ok) {
    console.warn(`\n⚠  MASALAH API KEY: ${key.hint}\n`);
  } else if (isLive() && key.warning) {
    console.warn(`\n⚠  CATATAN API KEY: ${key.warning}\n`);
  }
});

export default app;
