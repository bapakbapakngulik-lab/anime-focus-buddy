import test from 'node:test';
import assert from 'node:assert/strict';

import { recordCall, usage, resetUsage, FREE_TIER_DAILY_LIMIT } from '../src/quota.js';
import { localLine, LOCAL_EVENTS, AI_EVENTS, LOCAL_LINES, CHARACTERS } from '../src/prompt.js';

test('penghitung mulai dari nol', () => {
  resetUsage();
  const u = usage();
  assert.equal(u.used, 0);
  assert.equal(u.remaining, FREE_TIER_DAILY_LIMIT);
  assert.equal(u.exhausted, false);
});

test('tiap panggilan mengurangi sisa jatah', () => {
  resetUsage();
  recordCall();
  recordCall();
  const u = usage();
  assert.equal(u.used, 2);
  assert.equal(u.remaining, FREE_TIER_DAILY_LIMIT - 2);
});

test('jatah habis terdeteksi tepat di batas, tidak minus', () => {
  resetUsage();
  for (let i = 0; i < FREE_TIER_DAILY_LIMIT + 5; i++) recordCall();
  const u = usage();
  assert.equal(u.exhausted, true);
  assert.equal(u.remaining, 0, 'sisa tidak boleh minus');
});

test('batas free tier default 20 request per hari', () => {
  assert.equal(FREE_TIER_DAILY_LIMIT, 20);
});

// --- Kalimat lokal (penghemat kuota) ---

test('aksi rutin punya kalimat lokal untuk kedua karakter', () => {
  for (const id of Object.keys(CHARACTERS)) {
    for (const event of LOCAL_EVENTS) {
      assert.ok(localLine(id, event), `${id} belum punya kalimat lokal untuk "${event}"`);
    }
  }
});

test('event yang butuh AI tidak punya kalimat lokal', () => {
  // Kalau punya, nanti tertangkap jalur lokal dan buddy jadi tidak nyambung.
  for (const id of Object.keys(CHARACTERS)) {
    for (const event of AI_EVENTS) {
      assert.equal(localLine(id, event), null, `${id}/"${event}" seharusnya dijawab AI`);
    }
  }
});

test('event lokal dan event AI tidak boleh tumpang tindih', () => {
  for (const e of LOCAL_EVENTS) {
    assert.equal(AI_EVENTS.has(e), false, `event "${e}" ada di dua daftar`);
  }
});

test('kalimat lokal berputar, tidak selalu sama', () => {
  const hasil = new Set([0, 1, 2].map((seed) => localLine('aira', 'start', seed)));
  assert.ok(hasil.size > 1, 'kalimat pembuka harus bervariasi');
});

test('dua karakter punya kalimat lokal yang berbeda', () => {
  assert.notDeepEqual(LOCAL_LINES.aira.start, LOCAL_LINES.kenta.start);
});

test('event tak dikenal mengembalikan null, bukan error', () => {
  assert.equal(localLine('aira', 'event_ngaco'), null);
});
