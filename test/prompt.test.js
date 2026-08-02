import test from 'node:test';
import assert from 'node:assert/strict';

import { createSession, setActiveTask, parkIdea, completeTask, PHASE } from '../src/session.js';
import {
  CHARACTERS,
  DEFAULT_CHARACTER,
  getCharacter,
  buildSystemInstruction,
  buildCoachPrompt,
  buildBreakdownPrompt,
  describeSession,
  toContents,
  spriteFor,
  COACH_EVENTS,
  BREAKDOWN_SCHEMA,
  paramsFor,
  CHARACTER_PARAMS,
  PARAM_RANGE,
} from '../src/prompt.js';

test('MVP menyediakan satu karakter cewek dan satu cowok', () => {
  const genders = Object.values(CHARACTERS).map((c) => c.gender).sort();
  assert.deepEqual(genders, ['laki-laki', 'perempuan']);
  assert.deepEqual(Object.values(CHARACTERS).map((c) => c.sprite).sort(), ['boy', 'girl']);
});

test('karakter tidak dikenal jatuh ke default, bukan undefined', () => {
  assert.equal(getCharacter('entah').id, DEFAULT_CHARACTER);
  assert.equal(getCharacter(undefined).id, DEFAULT_CHARACTER);
  assert.equal(getCharacter('kenta').id, 'kenta');
});

test('system instruction memuat nama karakter dan aturan satu tugas', () => {
  const s = createSession();
  const si = buildSystemInstruction('kenta', s);
  assert.match(si, /Kenta/);
  assert.match(si, /SATU TUGAS SAJA/);
  assert.match(si, /Maksimal 2-3 kalimat/);
});

test('system instruction menyuntikkan tugas aktif ke konteks', () => {
  const s = createSession();
  setActiveTask(s, 'Nulis bab 3');
  const si = buildSystemInstruction('aira', s);
  assert.match(si, /Nulis bab 3/);
  assert.match(si, /sedang fokus/);
});

test('saat belum ada tugas, prompt mengarahkan buddy membantu memilih satu', () => {
  const s = createSession();
  assert.match(describeSession(s), /belum ada/i);
});

test('ide yang diparkir ikut masuk konteks dengan instruksi jangan diungkit', () => {
  const s = createSession();
  setActiveTask(s, 'Tugas A');
  parkIdea(s, 'beresin inbox');
  const si = buildSystemInstruction('aira', s);
  assert.match(si, /beresin inbox/);
  assert.match(si, /JANGAN diungkit/);
});

test('semua event coaching punya instruksi sendiri', () => {
  for (const event of Object.keys(COACH_EVENTS)) {
    assert.ok(buildCoachPrompt(event).length > 20, `event ${event} kosong`);
  }
});

test('event tak dikenal tetap menghasilkan prompt yang aman', () => {
  const p = buildCoachPrompt('event_ngaco');
  assert.ok(p.length > 20);
  assert.match(p, /tugas aktif/);
});

test('prompt breakdown membatasi jadi maksimal 3 langkah', () => {
  const p = buildBreakdownPrompt('Bikin slide presentasi');
  assert.match(p, /Bikin slide presentasi/);
  assert.match(p, /maksimal 3 langkah/i);
  assert.match(p, /2 menit/);
});

test('skema breakdown mewajibkan langkah pertama dan penyemangat', () => {
  assert.deepEqual(BREAKDOWN_SCHEMA.required, ['firstStep', 'steps', 'pep']);
  assert.equal(BREAKDOWN_SCHEMA.properties.steps.type, 'array');
});

test('riwayat dipetakan ke role yang dikenal Gemini', () => {
  const history = [
    { role: 'user', text: 'halo' },
    { role: 'buddy', text: 'hai!' },
  ];
  const contents = toContents(history, 'lanjut dong');

  assert.equal(contents.length, 3);
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[1].role, 'model', 'buddy harus dipetakan ke role "model"');
  assert.equal(contents[2].role, 'user');
  assert.equal(contents[2].parts[0].text, 'lanjut dong');
});

test('sprite mengikuti karakter dan fase sesi', () => {
  assert.equal(spriteFor('aira', PHASE.IDLE), '/img/girl_idle.png');
  assert.equal(spriteFor('aira', PHASE.FOCUS), '/img/girl_focus.png');
  assert.equal(spriteFor('kenta', PHASE.BREAK), '/img/boy_rest.png');
  assert.equal(spriteFor('kenta', PHASE.LONG_BREAK), '/img/boy_rest.png');
});

test('event selesai menampilkan sprite cheer apa pun fasenya', () => {
  assert.equal(spriteFor('kenta', PHASE.BREAK, 'complete'), '/img/boy_cheer.png');
  assert.equal(spriteFor('aira', PHASE.IDLE, 'complete'), '/img/girl_cheer.png');
});

test('setelah tugas selesai, fase istirahat memakai sprite rest', () => {
  const s = createSession();
  setActiveTask(s, 'Tugas A');
  completeTask(s);
  assert.equal(spriteFor('aira', s.phase), '/img/girl_rest.png');
});

// --- Konfigurasi parameter Gemini (materi Sesi 3) ---

test('tiap karakter punya konfigurasi parameter sendiri', () => {
  const aira = paramsFor('aira');
  const kenta = paramsFor('kenta');

  assert.notDeepEqual(aira, kenta, 'dua karakter tidak boleh memakai parameter identik');
  assert.ok(
    aira.temperature > kenta.temperature,
    'Aira yang ekspresif harus lebih tinggi temperature-nya daripada Kenta yang tenang'
  );
  assert.ok(aira.topK > kenta.topK);
  assert.ok(aira.topP > kenta.topP);
});

test('mode breakdown menurunkan keacakan karena butuh presisi', () => {
  for (const id of Object.keys(CHARACTER_PARAMS)) {
    const chat = paramsFor(id, 'chat');
    const breakdown = paramsFor(id, 'breakdown');
    assert.ok(
      breakdown.temperature < chat.temperature,
      `mode breakdown untuk ${id} harus lebih rendah temperature-nya`
    );
  }
});

test('semua parameter berada di rentang yang diizinkan Gemini', () => {
  for (const id of [...Object.keys(CHARACTER_PARAMS), 'karakter_ngaco']) {
    for (const mode of ['chat', 'coach', 'breakdown', 'mode_ngaco']) {
      const p = paramsFor(id, mode);
      assert.ok(p.temperature >= PARAM_RANGE.temperature[0] && p.temperature <= PARAM_RANGE.temperature[1]);
      assert.ok(p.topP >= PARAM_RANGE.topP[0] && p.topP <= PARAM_RANGE.topP[1]);
      assert.ok(p.topK >= PARAM_RANGE.topK[0] && p.topK <= PARAM_RANGE.topK[1]);
      assert.equal(Number.isInteger(p.topK), true, 'top_k harus bilangan bulat');
    }
  }
});

test('karakter tak dikenal tetap mendapat parameter default yang valid', () => {
  assert.deepEqual(paramsFor('entah'), paramsFor(DEFAULT_CHARACTER));
});

test('paramsFor selalu mengembalikan ketiga parameter yang diajarkan Sesi 3', () => {
  assert.deepEqual(Object.keys(paramsFor('kenta')).sort(), ['temperature', 'topK', 'topP']);
});
