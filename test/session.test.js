import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSession,
  createStore,
  setActiveTask,
  parkIdea,
  completeTask,
  dropTask,
  endBreak,
  isLongBreakDue,
  phaseDuration,
  pushHistory,
  summarize,
  PHASE,
  POMODORO,
  MAX_PARKED_IDEAS,
} from '../src/session.js';

test('sesi baru dimulai tanpa tugas dan dalam fase idle', () => {
  const s = createSession('t1');
  assert.equal(s.activeTask, null);
  assert.equal(s.phase, PHASE.IDLE);
  assert.equal(s.completedRounds, 0);
});

test('menetapkan tugas pertama berhasil dan langsung masuk fase fokus', () => {
  const s = createSession();
  const r = setActiveTask(s, '  Nulis draft laporan  ');
  assert.equal(r.ok, true);
  assert.equal(s.activeTask.title, 'Nulis draft laporan');
  assert.equal(s.phase, PHASE.FOCUS);
});

test('judul kosong ditolak', () => {
  const s = createSession();
  const r = setActiveTask(s, '   ');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'EMPTY_TASK');
  assert.equal(s.activeTask, null);
});

test('ATURAN INTI: tugas kedua ditolak dan otomatis diparkir', () => {
  const s = createSession();
  setActiveTask(s, 'Tugas A');
  const r = setActiveTask(s, 'Tugas B');

  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ACTIVE_TASK_EXISTS');
  assert.equal(s.activeTask.title, 'Tugas A', 'tugas aktif tidak boleh tergeser');
  assert.equal(s.parkedIdeas.at(-1).text, 'Tugas B', 'tugas kedua harus masuk parkiran');
  assert.equal(s.parkedIdeas.length, 1);
});

test('menyelesaikan tugas mengosongkan slot, menambah ronde, dan pindah ke istirahat', () => {
  const s = createSession();
  setActiveTask(s, 'Tugas A');
  const r = completeTask(s);

  assert.equal(r.ok, true);
  assert.equal(s.activeTask, null);
  assert.equal(s.completedRounds, 1);
  assert.equal(s.phase, PHASE.BREAK);
  assert.ok(r.finished.finishedAt >= r.finished.startedAt);
});

test('menyelesaikan saat tidak ada tugas aktif ditolak', () => {
  const s = createSession();
  const r = completeTask(s);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NO_ACTIVE_TASK');
  assert.equal(s.completedRounds, 0);
});

test('istirahat panjang muncul setelah 4 ronde', () => {
  const s = createSession();
  for (let i = 0; i < POMODORO.roundsBeforeLongBreak; i++) {
    setActiveTask(s, `Tugas ${i}`);
    completeTask(s);
    endBreak(s);
  }
  // Ronde ke-4 barusan selesai lalu endBreak dipanggil; cek langsung aturannya.
  assert.equal(s.completedRounds, 4);
  assert.equal(isLongBreakDue(s), true);
});

test('ronde ke-4 memicu fase long_break', () => {
  const s = createSession();
  for (let i = 0; i < 3; i++) {
    setActiveTask(s, `Tugas ${i}`);
    completeTask(s);
    endBreak(s);
  }
  setActiveTask(s, 'Tugas 4');
  completeTask(s);
  assert.equal(s.phase, PHASE.LONG_BREAK);
});

test('nyerah melepas tugas tanpa menghitung ronde', () => {
  const s = createSession();
  setActiveTask(s, 'Tugas A');
  const r = dropTask(s);
  assert.equal(r.ok, true);
  assert.equal(s.activeTask, null);
  assert.equal(s.completedRounds, 0, 'nyerah tidak boleh dihitung sebagai ronde selesai');
  assert.equal(s.phase, PHASE.IDLE);
});

test('endBreak ditolak kalau sedang tidak istirahat', () => {
  const s = createSession();
  const r = endBreak(s);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NOT_ON_BREAK');
});

test('setelah istirahat selesai, tugas baru boleh dimulai lagi', () => {
  const s = createSession();
  setActiveTask(s, 'Tugas A');
  completeTask(s);
  endBreak(s);
  const r = setActiveTask(s, 'Tugas B');
  assert.equal(r.ok, true);
  assert.equal(s.activeTask.title, 'Tugas B');
});

test('ide kosong tidak diparkir', () => {
  const s = createSession();
  const r = parkIdea(s, '  ');
  assert.equal(r.ok, false);
  assert.equal(s.parkedIdeas.length, 0);
});

test('parkiran dibatasi supaya tidak tumbuh tanpa batas', () => {
  const s = createSession();
  for (let i = 0; i < MAX_PARKED_IDEAS + 5; i++) parkIdea(s, `ide-${i}`);
  assert.equal(s.parkedIdeas.length, MAX_PARKED_IDEAS);
  assert.equal(s.parkedIdeas.at(-1).text, `ide-${MAX_PARKED_IDEAS + 4}`, 'ide terbaru dipertahankan');
  assert.equal(s.parkedIdeas[0].text, 'ide-5', 'ide terlama dibuang');
});

test('durasi fase mengikuti konfigurasi Pomodoro', () => {
  assert.equal(phaseDuration(PHASE.FOCUS), POMODORO.focusMinutes);
  assert.equal(phaseDuration(PHASE.BREAK), POMODORO.breakMinutes);
  assert.equal(phaseDuration(PHASE.LONG_BREAK), POMODORO.longBreakMinutes);
  assert.equal(phaseDuration(PHASE.IDLE), 0);
});

test('riwayat chat dipangkas agar prompt tidak membengkak', () => {
  const s = createSession();
  for (let i = 0; i < 20; i++) pushHistory(s, 'user', `pesan-${i}`, 12);
  assert.equal(s.history.length, 12);
  assert.equal(s.history.at(-1).text, 'pesan-19');
});

test('summarize hanya mengekspos data yang dibutuhkan klien', () => {
  const s = createSession('abc');
  setActiveTask(s, 'Tugas A');
  parkIdea(s, 'ide lain');
  const out = summarize(s);

  assert.deepEqual(Object.keys(out).sort(), [
    'activeTask', 'completedRounds', 'durationMinutes', 'id',
    'microSteps', 'parkedIdeas', 'phase',
  ]);
  assert.equal(out.activeTask, 'Tugas A');
  assert.deepEqual(out.parkedIdeas, ['ide lain']);
  assert.equal(out.durationMinutes, POMODORO.focusMinutes);
});

test('store memberi sesi terpisah per id dan bisa direset', () => {
  const store = createStore();
  setActiveTask(store.get('a'), 'Tugas A');
  assert.equal(store.get('b').activeTask, null, 'sesi lain tidak boleh bocor');
  assert.equal(store.get('a').activeTask.title, 'Tugas A');

  store.reset('a');
  assert.equal(store.get('a').activeTask, null);
});
