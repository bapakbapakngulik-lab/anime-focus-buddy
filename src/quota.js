/**
 * Penghitung pemakaian Gemini per hari.
 *
 * Free tier Gemini (Agustus 2026) hanya memberi **20 request per hari** per model.
 * Aplikasi ini gampang menghabiskannya: satu sesi Pomodoro bisa memicu belasan
 * panggilan kalau setiap aksi dijawab AI. Karena itu:
 *
 *   1. Aksi rutin (mulai tugas, selesai, istirahat) dijawab kalimat lokal — 0 request.
 *   2. Hanya interaksi yang memang butuh AI yang memanggil Gemini.
 *   3. Sisa jatah ditampilkan di UI supaya tidak kehabisan tanpa sadar.
 */

export const FREE_TIER_DAILY_LIMIT = Number(process.env.GEMINI_DAILY_LIMIT ?? 20);

function today() {
  return new Date().toISOString().slice(0, 10);
}

const state = { date: today(), used: 0 };

function rollOverIfNeeded() {
  const now = today();
  if (state.date !== now) {
    state.date = now;
    state.used = 0;
  }
}

/** Dipanggil setiap kali satu request benar-benar dikirim ke Gemini. */
export function recordCall() {
  rollOverIfNeeded();
  state.used += 1;
  return usage();
}

export function usage() {
  rollOverIfNeeded();
  const remaining = Math.max(0, FREE_TIER_DAILY_LIMIT - state.used);
  return {
    used: state.used,
    limit: FREE_TIER_DAILY_LIMIT,
    remaining,
    exhausted: remaining === 0,
    date: state.date,
  };
}

/** Dipakai test agar tidak saling mempengaruhi. */
export function resetUsage() {
  state.date = today();
  state.used = 0;
}
