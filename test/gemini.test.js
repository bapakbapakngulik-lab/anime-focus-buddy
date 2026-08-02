import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectKey, describeError, KEY_FORMATS } from '../src/gemini.js';

const AUTH_KEY = 'AQ.Ab' + 'x'.repeat(48); // format baru 2026
const LEGACY_KEY = 'AIza' + 'x'.repeat(35); // format lama, 39 karakter

test('key format baru (AQ.) diterima', () => {
  const r = inspectKey(AUTH_KEY);
  assert.equal(r.ok, true);
  assert.equal(r.warning, undefined, 'format baru tidak boleh diberi peringatan');
});

test('key format lama (AIza) diterima tapi diberi peringatan kedaluwarsa', () => {
  const r = inspectKey(LEGACY_KEY);
  assert.equal(r.ok, true, 'jangan blokir — masih bisa jalan sampai September 2026');
  assert.equal(r.reason, 'DEPRECATED_FORMAT');
  assert.match(r.warning, /AQ\./);
});

test('prefix tak dikenal TIDAK diblokir, hanya diberi catatan', () => {
  // Pelajaran dari format AQ.: menebak format dari pengetahuan lama itu berbahaya.
  const r = inspectKey('ZZ.baru' + 'x'.repeat(40));
  assert.equal(r.ok, true, 'format masa depan tidak boleh ikut terblokir');
  assert.equal(r.reason, 'UNKNOWN_PREFIX');
  assert.match(r.warning, /check-key/);
});

test('key kosong terdeteksi', () => {
  const r = inspectKey('');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MISSING');
});

test('key yang jelas kepotong terdeteksi', () => {
  const r = inspectKey('AQ.Ab123');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'TOO_SHORT');
  assert.match(r.hint, /8 karakter/);
});

test('key yang terbawa tanda kutip terdeteksi', () => {
  const r = inspectKey(`"${AUTH_KEY}"`);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'HAS_QUOTES_OR_SPACES');
});

test('key dengan spasi di dalamnya terdeteksi', () => {
  const r = inspectKey('AQ.Ab xxxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'HAS_QUOTES_OR_SPACES');
});

test('daftar format memuat AQ. sebagai format aktif dan AIza sebagai kedaluwarsa', () => {
  const aq = KEY_FORMATS.find((f) => f.prefix === 'AQ.');
  const aiza = KEY_FORMATS.find((f) => f.prefix === 'AIza');
  assert.equal(aq.deprecated, false);
  assert.equal(aiza.deprecated, true);
});

test('error API key dari Gemini diterjemahkan jadi pesan yang bisa ditindaklanjuti', () => {
  const msg = describeError(new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}'));
  assert.match(msg, /API key ditolak Google/);
});

test('error kuota diterjemahkan', () => {
  assert.match(describeError(new Error('429 RESOURCE_EXHAUSTED')), /Kuota/);
});

test('error jaringan diterjemahkan', () => {
  assert.match(describeError(new Error('fetch failed ENOTFOUND')), /koneksi internet|menjangkau server/);
});

test('error tak dikenal tetap mengembalikan pesan, bukan undefined', () => {
  const msg = describeError(new Error('sesuatu yang aneh'));
  assert.ok(msg.length > 0);
  assert.match(msg, /sesuatu yang aneh/);
});
