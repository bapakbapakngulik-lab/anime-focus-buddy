/**
 * State sesi kerja. Semua fungsi di sini murni (pure) dan tidak menyentuh
 * jaringan, supaya bisa diuji tanpa memanggil Gemini API.
 *
 * Aturan inti produk (lihat TDD.md):
 *   1. Hanya boleh ada SATU tugas aktif. Ide lain wajib diparkir.
 *   2. Timer Pomodoro: fokus -> istirahat -> fokus, istirahat panjang tiap 4 ronde.
 */

export const POMODORO = {
  focusMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  roundsBeforeLongBreak: 4,
};

export const MAX_PARKED_IDEAS = 20;

/** Fase yang mungkin dialami sesi, dipakai juga untuk memilih sprite buddy. */
export const PHASE = {
  IDLE: 'idle',
  FOCUS: 'focus',
  BREAK: 'break',
  LONG_BREAK: 'long_break',
};

export function createSession(id = 'default') {
  return {
    id,
    activeTask: null,
    parkedIdeas: [],
    completedRounds: 0,
    phase: PHASE.IDLE,
    history: [],
  };
}

/**
 * Menetapkan satu-satunya tugas aktif.
 * Kalau sudah ada tugas aktif, permintaan DITOLAK dan judulnya otomatis
 * masuk ke daftar ide yang diparkir — ini inti dari fitur anti-overwhelm.
 */
export function setActiveTask(session, title) {
  const clean = String(title ?? '').trim();
  if (!clean) {
    return { ok: false, reason: 'EMPTY_TASK', session };
  }
  if (session.activeTask) {
    const parked = parkIdea(session, clean);
    return {
      ok: false,
      reason: 'ACTIVE_TASK_EXISTS',
      activeTask: session.activeTask,
      parkedIdeas: parked.parkedIdeas,
      session,
    };
  }
  session.activeTask = { title: clean, startedAt: Date.now(), microSteps: [] };
  session.phase = PHASE.FOCUS;
  return { ok: true, activeTask: session.activeTask, session };
}

/** Menyimpan ide/distraksi untuk dikerjakan nanti, bukan sekarang. */
export function parkIdea(session, idea) {
  const clean = String(idea ?? '').trim();
  if (!clean) {
    return { ok: false, reason: 'EMPTY_IDEA', parkedIdeas: session.parkedIdeas };
  }
  session.parkedIdeas.push({ text: clean, at: Date.now() });
  if (session.parkedIdeas.length > MAX_PARKED_IDEAS) {
    session.parkedIdeas.shift();
  }
  return { ok: true, parkedIdeas: session.parkedIdeas };
}

/** Menyelesaikan tugas aktif; slot tugas jadi kosong lagi dan ronde bertambah. */
export function completeTask(session) {
  if (!session.activeTask) {
    return { ok: false, reason: 'NO_ACTIVE_TASK', session };
  }
  const finished = { ...session.activeTask, finishedAt: Date.now() };
  session.activeTask = null;
  session.completedRounds += 1;
  session.phase = isLongBreakDue(session) ? PHASE.LONG_BREAK : PHASE.BREAK;
  return { ok: true, finished, completedRounds: session.completedRounds, session };
}

/** Melepas tugas aktif tanpa menghitungnya sebagai ronde selesai. */
export function dropTask(session) {
  if (!session.activeTask) {
    return { ok: false, reason: 'NO_ACTIVE_TASK', session };
  }
  const dropped = session.activeTask;
  session.activeTask = null;
  session.phase = PHASE.IDLE;
  return { ok: true, dropped, session };
}

export function isLongBreakDue(session) {
  return (
    session.completedRounds > 0 &&
    session.completedRounds % POMODORO.roundsBeforeLongBreak === 0
  );
}

/** Durasi (menit) untuk fase saat ini. */
export function phaseDuration(phase) {
  if (phase === PHASE.FOCUS) return POMODORO.focusMinutes;
  if (phase === PHASE.BREAK) return POMODORO.breakMinutes;
  if (phase === PHASE.LONG_BREAK) return POMODORO.longBreakMinutes;
  return 0;
}

/** Beralih dari istirahat kembali ke siap-fokus. */
export function endBreak(session) {
  if (session.phase !== PHASE.BREAK && session.phase !== PHASE.LONG_BREAK) {
    return { ok: false, reason: 'NOT_ON_BREAK', session };
  }
  session.phase = PHASE.IDLE;
  return { ok: true, session };
}

/** Riwayat percakapan dipangkas supaya prompt tidak membengkak. */
export function pushHistory(session, role, text, maxTurns = 12) {
  session.history.push({ role, text });
  if (session.history.length > maxTurns) {
    session.history = session.history.slice(-maxTurns);
  }
  return session.history;
}

/** Ringkasan state yang dikirim ke klien dan diselipkan ke prompt Gemini. */
export function summarize(session) {
  return {
    id: session.id,
    activeTask: session.activeTask ? session.activeTask.title : null,
    microSteps: session.activeTask ? session.activeTask.microSteps : [],
    parkedIdeas: session.parkedIdeas.map((i) => i.text),
    completedRounds: session.completedRounds,
    phase: session.phase,
    durationMinutes: phaseDuration(session.phase),
  };
}

/** Penyimpanan sesi in-memory (cukup untuk MVP; lihat TDD.md bagian Non-Goals). */
export function createStore() {
  const map = new Map();
  return {
    get(id = 'default') {
      if (!map.has(id)) map.set(id, createSession(id));
      return map.get(id);
    },
    reset(id = 'default') {
      map.set(id, createSession(id));
      return map.get(id);
    },
    size: () => map.size,
  };
}
