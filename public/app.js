/* Anime Focus Buddy — klien. Timer jalan di browser, semua keputusan
   soal state tugas tetap di server. */

const $ = (id) => document.getElementById(id);
let character = localStorage.getItem('afb.character') || 'aira';
let timer = null;
let remaining = 0;

// ------------------------------------------------------------- helper

async function api(path, body) {
  try {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify({ ...body, character }) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    // Server mati / koneksi putus: jangan gagal diam-diam.
    return { ok: false, status: 0, data: { error: `Tidak bisa menghubungi server: ${err.message}` } };
  }
}

/**
 * Selalu ada umpan balik untuk tiap klik. Sebelumnya pesan kosong dibiarkan
 * lewat, sehingga tombol yang gagal terlihat seperti tombol yang tidak aktif.
 */
function say(text, isError = false) {
  $('bubble').textContent = text || 'Hmm, tidak ada balasan yang masuk. Coba lagi ya.';
  $('bubble').classList.toggle('error', Boolean(isError));
}

/** Menampilkan hasil panggilan API: balasan buddy, atau alasan gagalnya. */
function report(data) {
  if (data?.reply) return say(data.reply);
  if (data?.error) return say(data.error, true);
  say(null, true);
}

function addMsg(text, who) {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.textContent = text;
  $('chat').appendChild(el);
  $('chat').scrollTop = $('chat').scrollHeight;
  return el;
}

// ------------------------------------------------------------- render

function render(data) {
  if (!data?.state) return;
  const s = data.state;

  if (data.sprite) $('sprite').src = data.sprite;

  $('activeTask').textContent = s.activeTask || 'Belum ada tugas aktif.';
  $('activeTask').classList.toggle('empty', !s.activeTask);
  $('taskInput').disabled = Boolean(s.activeTask);
  $('taskInput').placeholder = s.activeTask
    ? 'Satu tugas dulu — selesaikan yang ini.'
    : 'Mau kerjain apa? (satu saja)';

  $('rounds').textContent = `Ronde selesai: ${s.completedRounds}`;
  $('phaseLabel').textContent = phaseLabel(s.phase);

  $('steps').innerHTML = '';
  (s.microSteps || []).forEach((step) => {
    const li = document.createElement('li');
    li.textContent = step;
    $('steps').appendChild(li);
  });

  $('parked').innerHTML = '';
  (s.parkedIdeas || []).slice().reverse().forEach((idea) => {
    const li = document.createElement('li');
    li.textContent = idea;
    $('parked').appendChild(li);
  });

  // Parameter Gemini sengaja ditampilkan supaya terlihat bahwa tiap karakter
  // memakai konfigurasi yang berbeda, bukan cuma persona yang berbeda.
  if (data.params) {
    const p = data.params;
    $('params').textContent =
      `temperature ${p.temperature} · top_p ${p.topP} · top_k ${p.topK}`;
  }

  // Free tier cuma 20 request/hari — tampilkan sisanya supaya tidak kehabisan
  // di tengah sesi tanpa sadar.
  if (data.quota) {
    const q = data.quota;
    $('quota').textContent = `Sisa jatah Gemini hari ini: ${q.remaining}/${q.limit}`;
    $('quota').classList.toggle('low', q.remaining <= 5);
  }

  syncTimer(s);
}

function phaseLabel(phase) {
  return {
    idle: 'Belum mulai',
    focus: 'Fokus',
    break: 'Istirahat',
    long_break: 'Istirahat panjang',
  }[phase] || phase;
}

// ------------------------------------------------------------- timer

function syncTimer(s) {
  const shouldRun = s.phase !== 'idle' && s.durationMinutes > 0;
  if (!shouldRun) {
    stopTimer();
    $('clock').textContent = '25:00';
    return;
  }
  // Timer hanya di-restart saat fase berganti, bukan tiap render.
  if ($('clock').dataset.phase !== s.phase) {
    $('clock').dataset.phase = s.phase;
    startTimer(s.durationMinutes * 60, s.phase);
  }
}

function startTimer(seconds, phase) {
  stopTimer();
  remaining = seconds;
  paint();
  timer = setInterval(() => {
    remaining -= 1;
    paint();
    if (remaining <= 0) {
      stopTimer();
      onTimerDone(phase);
    }
  }, 1000);
}

function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

function paint() {
  const m = String(Math.floor(remaining / 60)).padStart(2, '0');
  const s = String(remaining % 60).padStart(2, '0');
  $('clock').textContent = `${m}:${s}`;
  document.title = `${m}:${s} — Anime Focus Buddy`;
}

async function onTimerDone(phase) {
  if (phase === 'focus') {
    const { data } = await api('/api/coach', { event: 'complete' });
    report(data);
    render(data);
  } else {
    const { data } = await api('/api/break/end', {});
    report(data);
    render(data);
  }
}

// ------------------------------------------------------------- aksi

$('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = $('taskInput').value.trim();
  if (!title) return;
  const { data } = await api('/api/task', { title });
  $('taskInput').value = '';
  report(data);
  render(data);
});

$('parkForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const idea = $('parkInput').value.trim();
  if (!idea) return;
  const { data } = await api('/api/park', { idea });
  $('parkInput').value = '';
  report(data);
  render(data);
});

$('chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = $('chatInput').value.trim();
  if (!message) return;
  $('chatInput').value = '';
  addMsg(message, 'user');
  const pending = addMsg('...', 'buddy typing');
  const { data } = await api('/api/chat', { message });
  pending.remove();
  addMsg(data.reply || data.error || 'Tidak ada balasan.', data.reply ? 'buddy' : 'buddy error');
  report(data);
  render(data);
});

$('btnComplete').addEventListener('click', async () => {
  const { data } = await api('/api/task/complete', {});
  report(data);
  render(data);
});

$('btnDrop').addEventListener('click', async () => {
  const { data } = await api('/api/task/drop', {});
  report(data);
  render(data);
});

$('btnDistracted').addEventListener('click', () => coach('distracted'));
$('btnStuck').addEventListener('click', () => coach('stuck'));

async function coach(event) {
  const { data } = await api('/api/coach', { event });
  report(data);
  render(data);
}

$('btnBreakdown').addEventListener('click', async () => {
  const title = $('taskInput').value.trim() || undefined;
  $('btnBreakdown').disabled = true;
  const { data } = await api('/api/breakdown', { title });
  $('btnBreakdown').disabled = false;
  if (!data.breakdown) return report(data);
  say(data.breakdown.pep);
  render(data);
  // Langkah pertama ditampilkan paling atas sebagai pemicu 2 menit.
  const li = document.createElement('li');
  li.textContent = data.breakdown.firstStep;
  $('steps').prepend(li);
});

// ------------------------------------------------------------- init

async function boot() {
  const { data: chars } = await api('/api/characters');
  $('charPicker').innerHTML = '';
  chars.characters.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'char-btn' + (c.id === character ? ' active' : '');
    btn.innerHTML = `<strong>${c.name}</strong><br><span>${c.tagline}</span>`;
    btn.addEventListener('click', async () => {
      character = c.id;
      localStorage.setItem('afb.character', c.id);
      document.querySelectorAll('.char-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const { data } = await api(`/api/state?character=${c.id}`);
      render(data);
      say(`Halo, aku ${c.name}. Siap nemenin kamu.`);
    });
    $('charPicker').appendChild(btn);
  });

  const { data: health } = await api('/api/health');
  if (health.mode !== 'gemini') {
    $('mode').textContent = 'MODE DEMO — isi GEMINI_API_KEY di .env untuk jawaban asli Gemini';
    $('mode').className = 'mode warn';
  } else if (!health.keyOk) {
    // Key ada tapi bentuknya salah — beri tahu sekarang, jangan tunggu chat gagal.
    $('mode').textContent = `⚠ ${health.keyHint}`;
    $('mode').className = 'mode warn';
  } else {
    $('mode').textContent = `Terhubung ke ${health.model}`;
    $('mode').className = 'mode';
  }

  const { data } = await api(`/api/state?character=${character}`);
  render(data);
}

boot();
