/**
 * Pembungkus tipis di atas @google/genai.
 *
 * Kalau GEMINI_API_KEY tidak diisi, modul ini masuk ke MODE DEMO: server tetap
 * jalan dan menjawab dengan kalimat cadangan. Tujuannya supaya UI bisa
 * didemokan / diuji tanpa kuota API. Mode ini ditandai di setiap respons
 * (`source: "fallback"`) supaya tidak menyamar sebagai jawaban Gemini.
 */

import { GoogleGenAI } from '@google/genai';
import { recordCall, usage } from './quota.js';

/**
 * Model default.
 *
 * Materi pelatihan memakai `gemini-2.5-flash`, tetapi per Agustus 2026 Google
 * menolaknya untuk API key baru: "This model is no longer available to new users".
 * `gemini-flash-latest` adalah alias yang selalu menunjuk model Flash terbaru,
 * jadi tidak ikut mati saat versi tertentu dipensiunkan.
 *
 * Bisa ditimpa lewat GEMINI_MODEL di .env. Lihat daftar yang tersedia untuk
 * API key-mu dengan: npm run models
 */
export const DEFAULT_MODEL = 'gemini-flash-latest';

/** Dibaca sebagai fungsi supaya tidak bergantung pada urutan pemuatan dotenv. */
export function getModel() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

let ai = null;
export function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}

export function isLive() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * Format API key yang dikenal.
 *
 * Google memindahkan Gemini dari "Standard key" (AIza..., 39 karakter) ke
 * "Auth key" (AQ.Ab...) pada 2026. Key AIza tanpa restriction sudah ditolak
 * sejak 19 Juni 2026 dan dimatikan total pada September 2026.
 *
 * Pelajaran yang membentuk desain di bawah: format key bukan sesuatu yang boleh
 * ditebak dari pengetahuan lama. Karena itu pemeriksaan ini hanya MEMBERI SARAN —
 * yang berhak memutuskan sah atau tidak cuma server Google (lihat `pingKey`).
 */
export const KEY_FORMATS = [
  { prefix: 'AQ.', label: 'Auth key (format baru)', deprecated: false },
  { prefix: 'AIza', label: 'Standard key (format lama)', deprecated: true },
];

/** Di bawah ini hampir pasti hasil salin yang kepotong, bukan key sungguhan. */
const MIN_PLAUSIBLE_LENGTH = 20;

/**
 * Pemeriksaan bentuk API key sebelum request pertama dikirim.
 * Hanya menolak hal-hal yang pasti salah (kosong, ada spasi/kutip, jelas kepotong).
 * Prefix tak dikenal TIDAK diblokir — cukup diberi catatan, karena format baru
 * bisa muncul kapan saja.
 */
export function inspectKey(key = process.env.GEMINI_API_KEY ?? '') {
  if (!key) {
    return { ok: false, reason: 'MISSING', hint: 'GEMINI_API_KEY belum diisi di file .env' };
  }
  if (/[\s"']/.test(key)) {
    return {
      ok: false,
      reason: 'HAS_QUOTES_OR_SPACES',
      hint: 'API key mengandung spasi atau tanda kutip. Tulis polos tanpa tanda kutip.',
    };
  }
  if (key.length < MIN_PLAUSIBLE_LENGTH) {
    return {
      ok: false,
      reason: 'TOO_SHORT',
      hint:
        `API key cuma ${key.length} karakter — hampir pasti ke-copy sebagian. ` +
        'Salin ulang pakai tombol copy di AI Studio.',
    };
  }

  const format = KEY_FORMATS.find((f) => key.startsWith(f.prefix));
  if (!format) {
    return {
      ok: true,
      reason: 'UNKNOWN_PREFIX',
      format: null,
      warning:
        `Awalan key ("${key.slice(0, 3)}...") tidak dikenal aplikasi ini. ` +
        'Mungkin format baru dari Google — tetap dicoba. Jalankan "npm run check-key" untuk tes sungguhan.',
    };
  }
  if (format.deprecated) {
    return {
      ok: true,
      reason: 'DEPRECATED_FORMAT',
      format: format.label,
      warning:
        'Key ini format lama (AIza / Standard key). Google menolak key tanpa restriction ' +
        'sejak 19 Juni 2026 dan mematikannya total pada September 2026. ' +
        'Buat key baru di AI Studio — yang baru diawali "AQ.".',
    };
  }
  return { ok: true, format: format.label };
}

/**
 * Satu-satunya pemeriksaan yang benar-benar berwenang: kirim satu request kecil
 * ke Gemini dan lihat jawabannya. Dipakai `npm run check-key`.
 */
export async function pingKey() {
  const client = getClient();
  if (!client) return { ok: false, message: 'GEMINI_API_KEY belum diisi di file .env' };
  try {
    const r = await client.models.generateContent({
      model: getModel(),
      contents: 'ping',
      config: { maxOutputTokens: 800 },
    });
    return { ok: true, message: `Gemini menjawab. Model ${getModel()} siap dipakai.`, sample: r.text };
  } catch (err) {
    return { ok: false, message: describeError(err) };
  }
}

/**
 * Menerjemahkan error dari Gemini jadi pesan yang bisa ditindaklanjuti.
 * Pesan generik seperti "gagal menghubungi API" membuat pengguna menebak-nebak.
 */
export function describeError(err) {
  const raw = String(err?.message ?? err ?? '');
  if (/API_KEY_INVALID|API key not valid/i.test(raw)) {
    const check = inspectKey();
    if (!check.ok) return `API key ditolak Google. ${check.hint}`;
    if (check.warning) return `API key ditolak Google. ${check.warning}`;
    return (
      'API key ditolak Google. Pastikan key masih aktif di AI Studio, ' +
      'dan gunakan key format baru (diawali "AQ.").'
    );
  }
  if (/PERMISSION_DENIED|403/.test(raw)) {
    return 'API key tidak punya akses ke Gemini API. Aktifkan Generative Language API di project Google Cloud-mu.';
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(raw)) {
    return 'Kuota Gemini habis atau terlalu banyak request. Tunggu sebentar lalu coba lagi.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(raw)) {
    return 'Tidak bisa menjangkau server Google. Cek koneksi internet atau proxy.';
  }
  if (/NOT_FOUND|404/.test(raw)) {
    return `Model "${getModel()}" tidak tersedia untuk API key ini. Jalankan "npm run models" untuk melihat daftar model yang bisa dipakai, lalu set GEMINI_MODEL di .env.`;
  }
  return `Gemini menolak request: ${raw.slice(0, 200)}`;
}

/** Nilai aman kalau pemanggil tidak menyertakan parameter. */
const DEFAULT_PARAMS = { temperature: 0.9, topP: 0.95, topK: 40 };

/**
 * Menghasilkan teks bebas dari buddy.
 * `params` berisi temperature / topP / topK dari `paramsFor()`.
 */
export async function generateText({ systemInstruction, contents, params = {} }) {
  const { temperature, topP, topK } = { ...DEFAULT_PARAMS, ...params };
  const client = getClient();
  if (!client) {
    return { text: fallbackLine(contents), source: 'fallback', params: { temperature, topP, topK } };
  }
  if (usage().exhausted) {
    // Dihentikan di sini supaya tidak menabrak 429 dari Google.
    return {
      text: `Jatah Gemini hari ini habis (${usage().limit} request/hari di free tier). Aku tetap nemenin kamu — timernya jalan terus. 💪`,
      source: 'quota',
      params: { temperature, topP, topK },
    };
  }
  recordCall();
  const response = await client.models.generateContent({
    model: getModel(),
    contents,
    config: {
      systemInstruction,
      temperature,
      topP,
      topK,
      // Gemini 3.x menyalakan "thinking" secara default dan token berpikirnya
      // ikut memakan maxOutputTokens (±600 token) — dengan batas 300 balasan
      // terpotong di tengah kalimat. Mematikannya lewat thinkingBudget: 0 ditolak
      // model ini, jadi cara yang benar adalah memberi jatah yang cukup.
      maxOutputTokens: 1200,
    },
  });
  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error(
      `Gemini tidak mengembalikan teks (finishReason: ${response.candidates?.[0]?.finishReason ?? 'tidak diketahui'}).`
    );
  }
  return {
    text,
    source: 'gemini',
    params: { temperature, topP, topK },
  };
}

/** Menghasilkan JSON terstruktur (dipakai endpoint /api/breakdown). */
export async function generateJson({ systemInstruction, prompt, schema, params = {} }) {
  const { temperature, topP, topK } = { ...DEFAULT_PARAMS, ...params };
  const client = getClient();
  if (!client) {
    return { data: fallbackBreakdown(prompt), source: 'fallback', params: { temperature, topP, topK } };
  }
  if (usage().exhausted) {
    return { data: fallbackBreakdown(prompt), source: 'quota', params: { temperature, topP, topK } };
  }
  recordCall();
  const response = await client.models.generateContent({
    model: getModel(),
    contents: prompt,
    config: {
      systemInstruction,
      temperature,
      topP,
      topK,
      responseMimeType: 'application/json',
      responseSchema: schema,
      maxOutputTokens: 1500,
    },
  });
  return {
    data: JSON.parse(response.text),
    source: 'gemini',
    params: { temperature, topP, topK },
  };
}

const FALLBACK_LINES = [
  'Mode demo aktif (API key belum diisi). Tapi tetap: buka file-nya sekarang, kerjakan 2 menit saja. 💪',
  'Mode demo aktif. Satu langkah kecil dulu ya — sisanya urusan nanti.',
  'Mode demo aktif. Tarik napas, lalu lanjutkan dari baris terakhir yang kamu tulis.',
];

function fallbackLine(contents) {
  const i = JSON.stringify(contents ?? '').length % FALLBACK_LINES.length;
  return FALLBACK_LINES[i];
}

function fallbackBreakdown(prompt) {
  const task = String(prompt).match(/"([^"]+)"/)?.[1] ?? 'tugasmu';
  return {
    firstStep: `Buka apa pun yang dibutuhkan untuk "${task}" dan kerjakan 2 menit.`,
    steps: [
      `Siapkan satu hal untuk "${task}"`,
      'Kerjakan bagian paling gampang',
      'Berhenti di titik yang gampang dilanjut',
    ],
    pep: 'Mode demo aktif — isi GEMINI_API_KEY untuk jawaban asli dari Gemini.',
  };
}
