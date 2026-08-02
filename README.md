# 🌸 Anime Focus Buddy

> Chatbot anime penyemangat kerja: **Pomodoro + aturan Satu Tugas Saja**, dirancang untuk otak ADHD.

**Final Project** — Hacktiv8: *AI Productivity and AI API Integration for Developers*
Ditenagai **Gemini** (`@google/genai`, model `gemini-flash-latest`) · Node.js + Express

---

## Kenapa ini ada

Timer Pomodoro biasa cuma menghitung mundur. Untuk otak ADHD, tiga masalah ini
tidak tersentuh sama sekali:

- **Task switching** — tiap 10 menit muncul ide baru yang terasa lebih seru.
- **Task initiation paralysis** — tugasnya terlalu besar, jadi tidak pernah dimulai.
- **Shame spiral** — gagal fokus → merasa bersalah → makin tidak mulai.

Anime Focus Buddy menjawabnya dengan tiga mekanisme:

| Fitur | Cara kerja |
|---|---|
| 🔒 **Satu Tugas Saja** | Server **menolak** tugas kedua selama masih ada tugas aktif. Judul yang ditolak otomatis masuk **Parkiran Ide** — idemu tidak hilang, cuma tidak sekarang. |
| ✂️ **Pecah jadi 2 menit** | Gemini memecah tugas jadi maksimal 3 langkah mikro; langkah pertama harus bisa dimulai dalam 2 menit. |
| 🫂 **Buddy tanpa menghakimi** | Tombol "Aku kedistract", "Mentok", dan "Nyerah dulu" memicu respons hangat — bukan ceramah. "Nyerah" tidak dihitung sebagai kegagalan. |

Ditemani dua karakter anime: **Aira** (ceria, perempuan) dan **Kenta** (tenang, laki-laki),
yang ekspresinya ikut berubah sesuai fase kerjamu.

### Konfigurasi Parameter Gemini

Dua karakter ini dibedakan bukan cuma lewat teks persona, tapi juga lewat
**parameter model** — satu API yang melayani dua "kepribadian":

| Karakter / Mode | `temperature` | `top_p` | `top_k` | Kenapa |
|---|---|---|---|---|
| **Aira** — ekspresif | `1.0` | `0.95` | `40` | Kalimat penyemangat harus variatif, tidak terasa template |
| **Kenta** — tenang | `0.6` | `0.8` | `20` | Jawaban pendek, konsisten, mudah ditebak |
| **Mode `breakdown`** | `0.3` | `0.7` | `20` | Memecah tugas butuh presisi, jadi menimpa preset karakter |

Nilai aktifnya ditampilkan langsung di UI (di bawah timer), dan ikut dikirim di
setiap respons API lewat field `params` — jadi konfigurasinya bisa diverifikasi,
bukan tersembunyi di dalam kode.

**System Instruction** disusun tiga lapis (persona → house rules → konteks sesi
real-time) dan menjalankan keempat fungsinya: menetapkan persona, mengatur tone,
memberi batasan (maks 2–3 kalimat, dilarang menyarankan tugas kedua), dan mengatur
format output.

---

## Tata Cara Menggunakan

### 1. Prasyarat

- **Node.js 18+** (`node -v`)
- **API key Gemini** — gratis di <https://aistudio.google.com/apikey>

### 2. Instalasi

```bash
cd anime-focus-buddy
npm install
```

> **Catatan untuk folder Google Drive / OneDrive:** `npm install` bisa gagal dengan
> error `EBADF: bad file descriptor`. Itu masalah sinkronisasi drive, bukan kodenya.
> Solusinya: jalankan `npm install` di folder disk lokal, lalu salin `node_modules/`
> ke folder proyek.

### 3. Konfigurasi API key

Cara termudah — salin key dari AI Studio (pakai tombol **copy**, jangan blok manual),
lalu:

```bash
npm run set-key
```

Perintah ini membaca key dari clipboard, memvalidasi bentuknya, dan menulis `.env`
sendiri. Kalau isi clipboard bukan key yang benar, ia menolak menulis file.

Mau membuatnya manual? Buat file bernama `.env` di folder proyek dengan isi:

```env
GEMINI_API_KEY=AQ.Ab...isi_key_kamu_di_sini
PORT=3000
```

| Variabel | Wajib | Keterangan |
|---|---|---|
| `GEMINI_API_KEY` | ya | API key dari <https://aistudio.google.com/apikey>. Format terbaru diawali `AQ.` |
| `GEMINI_MODEL` | tidak | Default `gemini-flash-latest`. Lihat pilihan dengan `npm run models` |
| `PORT` | tidak | Default `3000` |
| `GEMINI_DAILY_LIMIT` | tidak | Default `20`, mengikuti batas free tier |

> **Catatan format API key.** Google mengganti format key dari `AIza...` (*Standard
> key*) ke `AQ.Ab...` (*Auth key*) pada 2026. Key `AIza` tanpa restriction ditolak
> sejak 19 Juni 2026 dan dimatikan total September 2026. Aplikasi ini menerima
> keduanya, tapi memperingatkan kalau kamu masih memakai format lama.

Untuk memastikan key-nya benar tanpa membuka file (aman saat share screen):

```bash
npm run check-key
```

> Tanpa API key aplikasi **tetap jalan** dalam *mode demo* dengan jawaban cadangan,
> supaya bisa dicoba dulu. Setiap balasan menandai asalnya di field `source`.

### 4. Jalankan

```bash
npm start
```

```
Anime Focus Buddy ready on http://localhost:3000
Mode: Gemini (gemini-flash-latest)
```

Buka **<http://localhost:3000>** di browser.

### 5. Alur pemakaian sehari-hari

1. **Pilih buddy** — Aira atau Kenta, di kiri atas. Pilihanmu diingat browser.
2. **Tulis SATU tugas** → klik **Mulai**. Timer 25 menit jalan, buddy menyapa dengan
   satu langkah pembuka.
3. Kalau tugasnya terasa berat → klik **Pecah jadi langkah kecil**. Muncul maksimal
   3 langkah mikro; kerjakan yang pertama saja.
4. **Muncul ide/distraksi di tengah kerja?** Tulis di kotak **Parkiran Ide** → klik
   **Parkir**. Idenya tersimpan, fokusmu tidak pecah.
   *Kalau kamu nekat mengetik tugas baru di kolom utama, sistem menolaknya dan
   memarkirnya otomatis.*
5. Lagi buntu → **Mentok**. Pikiran melayang → **Aku kedistract**. Buddy menarikmu
   balik tanpa menyalahkan.
6. **Selesai ✓** → ronde bertambah, buddy merayakan, timer pindah ke istirahat 5 menit.
   Tiap **4 ronde** istirahatnya jadi 15 menit.
7. Capek beneran → **Nyerah dulu**. Tugas dilepas, dan ini **tidak** dihitung sebagai
   ronde gagal. Besok lagi.

### 6. Menjalankan test

```bash
npm test
```

```
# tests 58
# pass 58
# fail 0
```

58 test memverifikasi aturan produk: tugas kedua ditolak & diparkir, nyerah tidak
menambah ronde, istirahat panjang tepat di ronde ke-4, persona selalu memuat aturan
"satu tugas saja", pemetaan sprite per fase, konfigurasi parameter Gemini (dua
karakter tidak boleh identik, semua nilai dalam rentang valid), deteksi masalah
API key, dan anggaran request harian.

### Hemat kuota

Free tier Gemini dibatasi **20 request per hari**. Supaya tidak habis dalam satu
sesi Pomodoro, panggilan dibagi dua:

| Aksi | Sumber jawaban | Biaya |
|---|---|---|
| Mulai tugas, ronde selesai, istirahat habis, parkir ide, menyerah | Kalimat lokal per karakter | **0 request** |
| Chat bebas, pecah tugas, "aku kedistract", "mentok", penolakan tugas kedua | Gemini | 1 request |

Sisa jatah ditampilkan di bawah timer. Kalau habis, timer dan aturan Satu Tugas
tetap berjalan penuh — yang berhenti cuma balasan AI-nya.

---

## Endpoint API

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/api/health` | Status server & mode (gemini/demo) |
| `GET` | `/api/characters` | Daftar karakter |
| `GET` | `/api/state` | State sesi + sprite saat ini |
| `POST` | `/api/task` | Menetapkan satu tugas aktif (`409` kalau sudah ada) |
| `POST` | `/api/task/complete` | Menyelesaikan ronde → istirahat |
| `POST` | `/api/task/drop` | Melepas tugas tanpa menghitung ronde |
| `POST` | `/api/break/end` | Mengakhiri istirahat |
| `POST` | `/api/park` | Memarkir ide/distraksi |
| `POST` | `/api/chat` | Chat bebas dengan buddy |
| `POST` | `/api/coach` | Dorongan sesuai event (`start`, `distracted`, `stuck`, `complete`, `break_over`, `giveup`) |
| `POST` | `/api/breakdown` | Memecah tugas jadi 3 langkah mikro (JSON terstruktur) |
| `POST` | `/api/reset` | Reset sesi |

Contoh:

```bash
curl -X POST http://localhost:3000/api/task \
  -H "Content-Type: application/json" \
  -d '{"title":"Nulis laporan bab 3","character":"aira"}'
```

Coba tambah tugas kedua — inilah inti produknya:

```bash
curl -i -X POST http://localhost:3000/api/task \
  -H "Content-Type: application/json" \
  -d '{"title":"Beresin inbox"}'
# HTTP/1.1 409 Conflict  → "Beresin inbox" masuk parkiran, tugas aktif tidak tergeser
```

---

## Struktur Proyek

```
anime-focus-buddy/
├─ index.js               Express server + semua route
├─ src/
│  ├─ session.js          Aturan sesi (satu tugas, Pomodoro, parkiran) — murni, tanpa I/O
│  ├─ prompt.js           Persona karakter + perakitan prompt — murni, tanpa I/O
│  └─ gemini.js           Adapter @google/genai (+ mode demo)
├─ public/
│  ├─ index.html · style.css · app.js
│  └─ img/                8 sprite: {girl,boy}_{idle,focus,cheer,rest}.png
├─ test/                  31 test (node:test, tanpa dependency)
├─ tools/
│  └─ generate-characters.py   Generator sprite via ComfyUI
├─ CLAUDE.md              Panduan untuk Claude Code
└─ TDD.md                 Technical Design Document
```

---

## Aset Karakter

8 sprite di-generate lokal dengan **ComfyUI** (SDXL — `waiIllustriousSDXL_v170`),
832×1216, 28 langkah, `euler_ancestral`, CFG 5.5.

| Karakter | idle | focus | cheer | rest |
|---|---|---|---|---|
| **Aira** (perempuan) | menyapa | menyemangati | merayakan | santai dengan teh |
| **Kenta** (laki-laki) | menyapa | menyemangati | merayakan | santai dengan teh |

Regenerasi (butuh ComfyUI jalan di `127.0.0.1:8188`):

```bash
python tools/generate-characters.py
```

Gambar dipakai sebagai **aset statis** — ComfyUI tidak dipanggil saat runtime.

---

## Teknologi

| Bagian | Pilihan |
|---|---|
| Runtime | Node.js (ESM) |
| Server | Express 4 + CORS |
| AI | Gemini (`gemini-flash-latest`) via `@google/genai` |
| Prompting | `systemInstruction` + `temperature`/`top_p`/`top_k` + `responseSchema` |
| Frontend | HTML/CSS/JS vanilla — tanpa build step |
| Testing | `node:test` bawaan Node |
| Aset gambar | ComfyUI + SDXL/Illustrious |

Alasan di balik tiap keputusan ada di **[TDD.md](TDD.md)** (tabel D1–D9).

---

## Lisensi

MIT
