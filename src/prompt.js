/**
 * Persona buddy + perakitan prompt untuk Gemini.
 * Dipisah dari index.js supaya bisa diuji tanpa memanggil API.
 */

import { PHASE, phaseDuration } from './session.js';

export const CHARACTERS = {
  aira: {
    id: 'aira',
    name: 'Aira',
    gender: 'perempuan',
    sprite: 'girl',
    tagline: 'Ceria, hangat, suka merayakan kemenangan kecil.',
    voice:
      'Kamu ceria, hangat, dan ekspresif seperti tokoh anime slice-of-life. ' +
      'Sering pakai seruan kecil ("yosh!", "nah kan!") tapi tidak berlebihan. ' +
      'Kamu memperlakukan progres sekecil apa pun sebagai kemenangan yang layak dirayakan.',
  },
  kenta: {
    id: 'kenta',
    name: 'Kenta',
    gender: 'laki-laki',
    sprite: 'boy',
    tagline: 'Tenang, to the point, tipe senpai yang bisa diandalkan.',
    voice:
      'Kamu tenang, ringkas, dan membumi seperti senpai yang bisa diandalkan. ' +
      'Kamu tidak cerewet; kamu memberi satu dorongan yang jelas lalu menyingkir ' +
      'supaya orangnya bisa langsung kerja.',
  },
};

export const DEFAULT_CHARACTER = 'aira';

export function getCharacter(id) {
  return CHARACTERS[id] ?? CHARACTERS[DEFAULT_CHARACTER];
}

/**
 * Konfigurasi parameter Gemini per karakter (materi Sesi 3).
 *
 * Dua karakter ini sengaja diberi parameter berbeda, bukan cuma persona berbeda:
 * Aira harus terdengar spontan dan variatif, Kenta harus konsisten dan ringkas.
 * Inilah contoh nyata satu API yang melayani beberapa "kepribadian".
 */
export const CHARACTER_PARAMS = {
  // Ekspresif: keacakan tinggi supaya kalimat penyemangatnya tidak terasa template.
  aira: { temperature: 1.0, topP: 0.95, topK: 40 },
  // Tenang: keacakan rendah supaya jawabannya pendek, tenang, dan mudah ditebak.
  kenta: { temperature: 0.6, topP: 0.8, topK: 20 },
};

/**
 * Penyesuaian per jenis tugas. Memecah tugas butuh presisi, bukan kreativitas,
 * jadi keacakannya diturunkan berapa pun karakternya.
 */
export const MODE_PARAMS = {
  chat: {},
  coach: {},
  breakdown: { temperature: 0.3, topP: 0.7, topK: 20 },
};

/** Batas nilai valid menurut dokumentasi Gemini (Sesi 3, slide 21). */
export const PARAM_RANGE = {
  temperature: [0.0, 2.0],
  topP: [0.0, 1.0],
  topK: [1, 40],
};

function clamp(value, [min, max]) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Parameter final untuk satu panggilan: preset karakter, ditimpa preset mode,
 * lalu dijepit ke rentang yang diizinkan Gemini.
 */
export function paramsFor(characterId, mode = 'chat') {
  const base = CHARACTER_PARAMS[getCharacter(characterId).id];
  const override = MODE_PARAMS[mode] ?? {};
  const merged = { ...base, ...override };
  return {
    temperature: clamp(merged.temperature, PARAM_RANGE.temperature),
    topP: clamp(merged.topP, PARAM_RANGE.topP),
    topK: Math.round(clamp(merged.topK, PARAM_RANGE.topK)),
  };
}

/**
 * Aturan perilaku yang berlaku untuk semua karakter.
 * Ini bagian terpenting: chatbot harus melindungi fokus, bukan menambah beban.
 */
const HOUSE_RULES = `
Kamu adalah "focus buddy" untuk pengguna dengan ADHD yang sedang bekerja dengan teknik Pomodoro.

ATURAN WAJIB:
1. SATU TUGAS SAJA. Jangan pernah menyarankan tugas kedua, checklist panjang, atau ide baru
   selagi masih ada tugas aktif. Kalau pengguna melempar ide lain, katakan ide itu akan
   "diparkir" dulu dan arahkan dia kembali ke tugas aktifnya.
2. SINGKAT. Maksimal 2-3 kalimat. Jangan pakai bullet point kecuali diminta memecah tugas.
   Balasan panjang = pengguna kehilangan fokus.
3. AKSI KONKRET. Selalu tutup dengan satu langkah kecil yang bisa dimulai dalam 2 menit.
4. TANPA RASA BERSALAH. Kalau pengguna gagal fokus atau kabur dari tugas, jangan menghakimi.
   Akui itu wajar, lalu tawarkan versi tugas yang lebih kecil.
5. Bahasa Indonesia santai (boleh "aku"/"kamu"). Boleh 1 emoji, jangan lebih.
6. Kamu bukan terapis. Kalau pengguna cerita soal krisis kesehatan mental yang serius,
   tanggapi dengan hangat dan sarankan bicara ke orang/tenaga profesional yang dipercaya.
`.trim();

/** System instruction lengkap: persona + aturan + kondisi sesi saat ini. */
export function buildSystemInstruction(characterId, session) {
  const c = getCharacter(characterId);
  return [
    `Namamu ${c.name}, karakter anime ${c.gender}. ${c.voice}`,
    HOUSE_RULES,
    `KONDISI SESI SAAT INI:\n${describeSession(session)}`,
  ].join('\n\n');
}

export function describeSession(session) {
  const lines = [];
  lines.push(
    session.activeTask
      ? `- Tugas aktif: "${session.activeTask.title}"`
      : '- Tugas aktif: belum ada. Bantu pengguna memilih SATU tugas.'
  );
  if (session.activeTask?.microSteps?.length) {
    lines.push(`- Langkah mikro: ${session.activeTask.microSteps.join(' | ')}`);
  }
  lines.push(`- Fase: ${labelPhase(session.phase)} (${phaseDuration(session.phase)} menit)`);
  lines.push(`- Ronde selesai hari ini: ${session.completedRounds}`);
  if (session.parkedIdeas.length) {
    const recent = session.parkedIdeas.slice(-5).map((i) => i.text).join(' | ');
    lines.push(`- Ide yang sudah diparkir (JANGAN diungkit kecuali ditanya): ${recent}`);
  }
  return lines.join('\n');
}

export function labelPhase(phase) {
  const map = {
    [PHASE.IDLE]: 'menganggur / belum mulai',
    [PHASE.FOCUS]: 'sedang fokus',
    [PHASE.BREAK]: 'istirahat pendek',
    [PHASE.LONG_BREAK]: 'istirahat panjang',
  };
  return map[phase] ?? phase;
}

/**
 * Event coaching: pemicu dari UI (bukan ketikan pengguna) yang minta
 * satu kalimat penyemangat sesuai momennya.
 */
export const COACH_EVENTS = {
  start: 'Pengguna baru saja menekan mulai. Beri sapaan singkat dan satu langkah pembuka.',
  distracted:
    'Pengguna menekan tombol "aku kedistract". Tarik dia kembali tanpa menyalahkan, ' +
    'lalu beri satu langkah super kecil untuk masuk lagi.',
  stuck:
    'Pengguna merasa mentok. Tawarkan cara memperkecil tugas jadi versi 2 menit.',
  complete:
    'Pengguna baru saja menyelesaikan satu ronde fokus. Rayakan dengan tulus dan ' +
    'ingatkan untuk benar-benar istirahat.',
  break_over:
    'Istirahat selesai. Ajak kembali ke tugas dengan energi yang tenang.',
  giveup:
    'Pengguna ingin menyerah untuk hari ini. Validasi perasaannya, jangan memaksa, ' +
    'dan tutup harinya dengan baik.',
};

/**
 * Kalimat lokal untuk aksi rutin.
 *
 * Free tier cuma 20 request/hari. Menghabiskannya untuk "kamu sudah mulai!" itu
 * mubazir — kalimat begini tidak butuh AI. Jatah Gemini disimpan untuk momen yang
 * benar-benar butuh pemahaman: chat bebas, memecah tugas, dan saat pengguna
 * kedistract / mentok / mau menyerah.
 */
export const LOCAL_LINES = {
  aira: {
    start: [
      'Yosh! Satu tugas ini aja ya. Buka filenya dulu, 2 menit doang. 🌸',
      'Oke, kita mulai! Jangan mikir hasil akhirnya, mikirin baris pertama aja.',
      'Aku temenin ya. Kerjain yang paling gampang dulu biar kepancing.',
    ],
    complete: [
      'Nah kan bisa! Sekarang beneran istirahat ya, jangan curi-curi kerja. 🎉',
      'Yeay, satu ronde selesai! Berdiri, minum, lihat jauh sebentar.',
      'Keren! Kemenangan kecil tetap kemenangan. Istirahat dulu.',
    ],
    break_over: [
      'Istirahat selesai~ Siap satu ronde lagi?',
      'Balik yuk. Pelan-pelan aja, mulai dari yang tadi belum kelar.',
    ],
    giveup: [
      'Gapapa kok. Hari ini udah cukup, besok kita mulai lagi ya. 💛',
      'Berhenti itu bukan gagal. Istirahat yang bener ya.',
    ],
    park: ['Sudah kuparkir! Sekarang balik ke tugasmu ya. 🌸'],
  },
  kenta: {
    start: [
      'Oke. Satu tugas ini saja. Mulai dari langkah paling kecil.',
      'Siap. Buka filenya, kerjakan dua menit. Sisanya nanti.',
      'Jangan direncanakan lagi. Langsung kerjakan bagian pertama.',
    ],
    complete: [
      'Bagus. Satu ronde selesai — sekarang istirahat beneran.',
      'Selesai. Jangan lanjut dulu, istirahatnya bagian dari kerjanya.',
      'Rapi. Berdiri sebentar, jangan lihat layar.',
    ],
    break_over: [
      'Istirahat habis. Lanjut satu ronde lagi.',
      'Balik kerja. Mulai dari titik terakhir tadi.',
    ],
    giveup: [
      'Tidak apa-apa. Cukup untuk hari ini.',
      'Berhenti sekarang lebih baik daripada memaksa. Besok lanjut.',
    ],
    park: ['Sudah dicatat. Kembali ke tugasmu.'],
  },
};

/** Memilih kalimat lokal secara berputar supaya tidak terasa template. */
export function localLine(characterId, event, seed = Date.now()) {
  const set = LOCAL_LINES[getCharacter(characterId).id];
  const lines = set?.[event];
  if (!lines?.length) return null;
  return lines[Math.abs(Math.floor(seed)) % lines.length];
}

/** Event yang cukup dijawab lokal — tidak perlu memanggil Gemini. */
export const LOCAL_EVENTS = new Set(['start', 'complete', 'break_over', 'giveup', 'park']);

/** Event yang benar-benar butuh AI karena butuh menanggapi kondisi pengguna. */
export const AI_EVENTS = new Set(['distracted', 'stuck']);

export function buildCoachPrompt(event) {
  return (
    COACH_EVENTS[event] ??
    'Pengguna butuh dorongan umum untuk tetap mengerjakan tugas aktifnya.'
  );
}

/** Riwayat chat -> format `contents` milik @google/genai. */
export function toContents(history, userText) {
  const contents = history.map((h) => ({
    role: h.role === 'buddy' ? 'model' : 'user',
    parts: [{ text: h.text }],
  }));
  contents.push({ role: 'user', parts: [{ text: userText }] });
  return contents;
}

/** Skema JSON untuk pemecahan tugas jadi langkah mikro. */
export const BREAKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    firstStep: {
      type: 'string',
      description: 'Satu langkah yang bisa dimulai dalam 2 menit.',
    },
    steps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Maksimal 3 langkah mikro berurutan.',
    },
    pep: { type: 'string', description: 'Satu kalimat penyemangat.' },
  },
  required: ['firstStep', 'steps', 'pep'],
};

export function buildBreakdownPrompt(taskTitle) {
  return (
    `Pecah tugas ini menjadi maksimal 3 langkah mikro untuk otak ADHD: "${taskTitle}".\n` +
    'Langkah pertama harus bisa dimulai dalam 2 menit dan tidak butuh persiapan apa pun. ' +
    'Gunakan kata kerja konkret. Jangan lebih dari 3 langkah.'
  );
}

/** Sprite mana yang ditampilkan untuk kombinasi karakter + fase. */
export function spriteFor(characterId, phase, lastEvent) {
  const c = getCharacter(characterId);
  let mood = 'idle';
  if (lastEvent === 'complete') mood = 'cheer';
  else if (phase === PHASE.FOCUS) mood = 'focus';
  else if (phase === PHASE.BREAK || phase === PHASE.LONG_BREAK) mood = 'rest';
  return `/img/${c.sprite}_${mood}.png`;
}
