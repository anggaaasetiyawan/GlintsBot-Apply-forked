# GlintsAuto

**🌐 Read in English → [README.md](README.md)**

Bot auto-apply untuk **dua platform**: Glints dan Jobstreet. TypeScript, terminal UI,
cron + mode 24/7. Satu `config.json`, satu CLI.

> Edukasi only. Gunakan di akun sendiri. Jangan disalahgunakan.
> Gapunya Orang Dalam, punyanya OTAK yang bisa dipake.

## Dua platform, dua cara kerja

|                  | Glints                                                        | Jobstreet                                                                                        |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Transport        | **HTTP murni** — API mobile yang sama dengan aplikasi Android | **Puppeteer** — browser sungguhan, profil tersimpan                                              |
| Login            | Email/password di `.env`                                      | Sekali via `jobstreet login` (headful), sesi di `.glints/jobstreet-profile`                      |
| Alur apply       | One-tap apply + pesan intro di chat                           | Wizard multi-langkah: `/apply` → `/apply/role-requirements` → `/apply/profile` → `/apply/review` |
| Jawaban otomatis | Bank jawaban per nama pertanyaan Glints                       | **Diturunkan dari CV Anda** (`answers` + `answers.skills`)                                       |
| Riwayat          | `.glints/history.json`                                        | `.glints/jobstreet-history.json`                                                                 |
| Cap harian       | `limits.maxAppliesPerDay`                                     | angka sama, penghitung sendiri                                                                   |

## Apa yang dilakukan

- Mengambil lowongan dari feed For-You (dan "recently added" / nearby sebagai cadangan).
- Filter berdasarkan keyword, tipe pekerjaan, work arrangement, minimal pengalaman, flag fraud.
- Auto-apply dengan jawaban dari bank jawaban di config.
- Setelah apply, membuka channel chat dan mengirim pesan intro — sama seperti alur di aplikasi.
- Dashboard terminal live saat berjalan.
- **Mode 24/7**: mendapatkan keyword dari profil Anda, loop terus-menerus,
  tidur sampai tengah malam berikutnya saat cap harian tercapai, backoff eksponensial saat error.
- Mode cron jika Anda lebih suka menjadwalkannya.
- Batas harian dan per-run. Delay acak antar apply.
- Riwayat lokal agar tidak apply pekerjaan yang sama dua kali — termasuk
  dedupe 409 dari server (menangani "sudah apply" tanpa melakukan retry).
- **Deteksi keyword yang dapat dikustomisasi** — bekerja untuk IT _dan_ non-IT.
  Auto-detect keyword dari profil, atau definisikan token industri Anda sendiri.

Glints tanpa browser automation — tanpa Selenium, hanya HTTP.

**Jobstreet**

- Mencari lowongan per keyword di `id.jobstreet.com` — keyword auto diturunkan dari
  riwayat apply + `filters.includeKeywords`.
- Melewati iklan "Daftar / Apply on company website" — hanya kampanye on-site yang di-apply.
- Menyelesaikan seluruh wizard dan menjawab `/apply/role-requirements` **dari CV Anda**:
  ekspektasi gaji, lama pengalaman (termasuk pertanyaan per-skill), pendidikan,
  hak bekerja, relocation, notice period, industri, dan daftar skill wajib.
- **Menimpa pre-fill basi Jobstreet** saat CV punya jawaban lebih baik — platform ini
  suka mengisi `Rp 4.5 Jt` dan `1 tahun`. Setiap penimpaan dicatat di log (nilai lama ikut).
- `--dry-run` sampai ke tombol submit lalu berhenti. Dicatat sebagai `DRY_RUN` dan
  tidak mengurangi cap harian.
- `jobstreet status` sinkron dari `my-activity/applied-jobs`.

---

## 🚀 Panduan Cepat untuk Non-IT

Anda tidak perlu jadi programmer untuk pakai bot ini. Ikuti langkah-langkah di bawah:

### Langkah 1: Install Node.js

1. Buka [nodejs.org](https://nodejs.org/)
2. Download versi **LTS** (yang tombolnya hijau besar)
3. Double-click file yang sudah didownload
4. Klik **Next** → **Next** → **Install** → **Finish**
5. Selesai!

### Langkah 2: Download Bot

1. Tekan `Win + R` di keyboard
2. Ketik `cmd` lalu tekan **Enter** (ini membuka Command Prompt / terminal hitam)
3. Ketik perintah ini satu per satu:

```cmd
cd %USERPROFILE%\Documents
git clone https://github.com/anggaaasetiyawan/GlintsBot-Apply-forked.git
cd GlintsBot-Apply-forked
```

### Langkah 3: Install Dependencies

Di terminal yang sama, ketik:

```cmd
npm install
```

Tunggu sampai selesai (mungkin 1-2 menit). Ini menginstall semua "bahan" yang dibutuhkan bot.

### Langkah 4: Setup Akun Glints

Bot perlu email dan password Glints Anda. Ini aman — data hanya disimpan di komputer Anda sendiri, tidak dikirim ke mana-mana.

1. Copy file `.env.example` menjadi `.env`:

```cmd
copy .env.example .env
```

2. Buka file `.env` dengan Notepad:

```cmd
notepad .env
```

3. Isi email dan password Glints Anda:

```
GLINTS_USERNAME=emailanda@gmail.com
GLINTS_PASSWORD=passwordglintsanda
GLINTS_DEVICE_ID=2582a15c363f2e56
GLINTS_COUNTRY=ID
GLINTS_LANG=id
GLINTS_APP_VERSION=1.106.2
GLINTS_OS_VERSION=9
```

> **Catatan**: `GLINTS_DEVICE_ID` boleh dibiarkan seperti itu, atau ganti dengan 16 karakter hex acak lainnya (contoh: `a1b2c3d4e5f67890`).

4. **Save** (Ctrl+S) lalu tutup Notepad.

### Langkah 5: Setup Config (Filter Lowongan)

1. Copy file `config.example.json` menjadi `config.json`:

```cmd
copy config.example.json config.json
```

2. Buka `config.json` dengan Notepad:

```cmd
notepad config.json
```

3. Sesuaikan dengan kebutuhan Anda (lihat panduan di bawah).

### Langkah 6: Test Login

```cmd
npx tsx src/cli.ts me
```

Jika berhasil, akan muncul nama, email, dan info profil Anda. Jika error, cek email/password di file `.env`.

### Langkah 7: Coba Dulu (Dry Run)

```cmd
npx tsx src/cli.ts apply --dry-run
```

Ini akan mensimulasikan apply TANPA benar-benar apply. Aman untuk test.

### Langkah 8: Login Jobstreet (sekali saja)

```cmd
npx tsx src/cli.ts jobstreet login
```

Jendela browser terbuka — login manual dengan email/password Jobstreet (plus captcha
atau 2FA kalau muncul). Sesi tersimpan di `.glints/jobstreet-profile` dan dipakai
otomatis seterusnya. Cukup **sekali**; setelah itu semuanya headless.

### Langkah 9: Dry Run Jobstreet

```cmd
npx tsx src/cli.ts jobstreet apply --dry-run
```

Bot berjalan sampai tombol submit lalu berhenti. Periksa log jawabannya — semuanya
harus diambil dari CV Anda.

### Langkah 10: Jalankan!

```cmd
# Glints — sekali jalan (dengan dashboard keren)
npx tsx src/cli.ts apply

# Glints — mode 24/7
npx tsx src/cli.ts auto

# Jobstreet — sekali jalan
npx tsx src/cli.ts jobstreet apply
```

### Jalan terus-menerus di server

```bash
# nohup
nohup npx tsx src/cli.ts auto --no-tui > .glints/auto.log 2>&1 &

# atau PM2 (auto-restart kalau crash, tetap hidup setelah reboot)
pm2 start --name glints-auto -- npx tsx src/cli.ts auto --no-tui
pm2 save && pm2 startup
```

`ecosystem.config.cjs` bawaan hanya menjalankan **Glints** (`auto --no-tui`). Jobstreet
tidak terhubung ke `auto`/`cron` — jadwalkan `jobstreet apply` sendiri kalau mau
otomatis, dan ingat profil browser hanya boleh dipakai satu proses sekaligus.

---

## ⚙️ Panduan Config untuk Non-IT

Buka `config.json` dengan Notepad. Ini penjelasan bagian-bagiannya:

### Filter Keyword (Paling Penting!)

Keyword menentukan lowongan apa yang akan di-apply. Bot akan mencari lowongan yang mengandung kata-kata ini.

```json
"keywordOptions": {
  "mode": "tech",
  "customTokens": [],
  "extraRoleNouns": []
}
```

**Pilih mode sesuai bidang Anda:**

| Mode       | Artinya                                              | Cocok untuk                                                  |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| `"tech"`   | Hanya kata-kata IT (developer, programmer, php, dll) | Programmer, IT Support, Designer                             |
| `"all"`    | **Semua kata penting dari profil Anda**              | Semua bidang — akuntan, perawat, guru, admin, marketing, dll |
| `"custom"` | Hanya kata yang Anda tulis sendiri                   | Kontrol penuh                                                |

### Contoh Config per Bidang

#### 🖥️ IT / Programmer

```json
"keywordOptions": {
  "mode": "tech",
  "customTokens": [],
  "extraRoleNouns": []
}
```

#### 💰 Akuntansi / Keuangan

```json
"keywordOptions": {
  "mode": "custom",
  "customTokens": ["accounting", "audit", "pajak", "finance", "akuntansi", "laporan keuangan", "budgeting"],
  "extraRoleNouns": ["accountant", "auditor", "staff akuntansi", "finance staff"]
}
```

#### 🏥 Kesehatan / Perawat

```json
"keywordOptions": {
  "mode": "custom",
  "customTokens": ["nursing", "perawat", "pasien", "klinik", "rumah sakit", "medis", "kesehatan"],
  "extraRoleNouns": ["nurse", "perawat", "bidan", "caregiver", "apoteker"]
}
```

#### 📚 Pendidikan / Guru

```json
"keywordOptions": {
  "mode": "custom",
  "customTokens": ["mengajar", "pendidikan", "guru", "tutor", "kurikulum", "sekolah"],
  "extraRoleNouns": ["guru", "teacher", "pengajar", "dosen", "instruktur"]
}
```

#### 📊 Marketing / Sales

```json
"keywordOptions": {
  "mode": "custom",
  "customTokens": ["marketing", "sales", "digital marketing", "social media", "branding", "promosi", "iklan"],
  "extraRoleNouns": ["marketer", "sales", "account executive", "brand manager"]
}
```

#### 🏢 Admin / Umum (paling gampang)

```json
"keywordOptions": {
  "mode": "all"
}
```

### Filter Tambahan

```json
"filters": {
  "includeKeywords": ["developer", "engineer"],
  "excludeKeywords": ["sales", "marketing", "intern"],
  "jobTypes": ["FULL_TIME", "CONTRACT"],
  "workArrangements": ["REMOTE", "HYBRID", "ONSITE"],
  "minYearsOfExperienceMax": 5,
  "remoteOnly": false,
  "skipApplied": true,
  "skipFraudFlagged": true
}
```

| Field                     | Artinya                                       | Contoh                                  |
| ------------------------- | --------------------------------------------- | --------------------------------------- |
| `includeKeywords`         | Lowongan HARUS mengandung salah satu kata ini | `["akuntan", "admin", "staff"]`         |
| `excludeKeywords`         | Lowongan TIDAK BOLEH mengandung kata ini      | `["intern", "magang", "sales"]`         |
| `jobTypes`                | Tipe pekerjaan yang diterima                  | `["FULL_TIME"]` = full time saja        |
| `workArrangements`        | Cara kerja                                    | `["REMOTE"]` = remote saja              |
| `minYearsOfExperienceMax` | Maksimal pengalaman yang diminta              | `3` = skip lowongan yang minta >3 tahun |
| `remoteOnly`              | Hanya remote                                  | `true` / `false`                        |

### Batas Apply (Safety)

```json
"limits": {
  "maxAppliesPerRun": 20,
  "maxAppliesPerDay": 50,
  "minDelaySeconds": 4,
  "maxDelaySeconds": 12
}
```

| Field              | Artinya                                      |
| ------------------ | -------------------------------------------- |
| `maxAppliesPerRun` | Maksimal apply per 1 run                     |
| `maxAppliesPerDay` | Maksimal apply per hari (reset tengah malam) |
| `minDelaySeconds`  | Jeda minimum antar apply (detik)             |
| `maxDelaySeconds`  | Jeda maksimum antar apply (detik)            |

> **Rekomendasi**: Jangan ubah `maxAppliesPerDay` terlalu tinggi. Glints bisa curiga kalau terlalu banyak apply sekaligus. 20-50 per hari masih aman.

### Jawaban Otomatis

Saat apply, Glints kadang bertanya (contoh: "Berapa tahun pengalaman Anda?"). Bot akan menjawab otomatis dari bagian `answers`:

```json
"answers": {
  "years_of_relevant_experience_v2": "More than 5 years",
  "skill_set_tools": "Expert",
  "skill_set_foreign_language_v2": ["Bahasa Indonesia", "English"],
  "expected_salary_idr": 7000000,
  // Daftar teknologi dari CV Anda — dipakai Jobstreet untuk pertanyaan skill wajib.
  "skills": ["javascript", "typescript", "node.js", "react", "sql", "docker", "git"]
}
```

Sesuaikan dengan profil Anda. Jika ada pertanyaan yang tidak ada di list, bot akan skip lowongan itu dan log `missing-answers:<nama>`.

Field `answers.skills` adalah daftar teknologi dari CV Anda — Jobstreet memakai ini
untuk pertanyaan multi-select wajib ("Library/framework back end apa saja yang bisa
kamu gunakan?") dan hanya akan mencentang nama-nama yang ada di daftar itu.

---

## 📋 Daftar Perintah

```
me                      tampilkan profil Anda
feed [-p N -s SIZE]     lihat feed lowongan For-You
keywords                preview keyword auto-detect dari profil
apply [--dry-run]       1 run auto-apply, dengan TUI
apply --no-tui          1 run auto-apply, output plain text
dashboard               alias dari apply
auto [--dry-run]        mode 24/7 — auto keyword, auto cooldown, auto resume
cron [--once]           jalan sesuai jadwal cron
history [-n N]          riwayat apply terbaru + cap hari ini
reset-day               hapus riwayat hari ini (reset cap harian)
config                  tampilkan config yang aktif

jobstreet login         buka browser, login sekali — sesi di .glints/jobstreet-profile
jobstreet apply         jalan wizard dan submit lamaran
jobstreet apply --dry-run   sama, tapi berhenti di tombol submit
jobstreet status        tabel status + sinkron dari my-activity/applied-jobs
```

`jobstreet <action>` hanya menerima `login | apply | status`. `--dry-run` sampai ke
tombol submit tanpa menekannya. `-c, --config <path>` di root memakai file config lain.

### Contoh Penggunaan

```bash
# Cek profil
npx tsx src/cli.ts me

# Lihat 10 lowongan terbaru
npx tsx src/cli.ts feed -p 1 -s 10

# Preview keyword yang akan dipakai bot
npx tsx src/cli.ts keywords

# Coba apply TANPA benar-benar apply (test dulu)
npx tsx src/cli.ts apply --dry-run

# Apply sungguhan (1 run)
npx tsx src/cli.ts apply

# Mode 24/7 — jalan terus sampai di-stop (Ctrl+C)
npx tsx src/cli.ts auto

# Lihat riwayat apply
npx tsx src/cli.ts history -n 30

# Jobstreet — dry run (berhenti di tombol submit)
npx tsx src/cli.ts jobstreet apply --dry-run

# Jobstreet — apply sungguhan
npx tsx src/cli.ts jobstreet apply

# Jobstreet — status + sinkron dari my-activity
npx tsx src/cli.ts jobstreet status
```

---

## 🎯 Konfigurasi Jobstreet

Bot Jobstreet **tidak** ikut `auto`/`cron`. Jalankan manual atau jadwalkan sendiri.

### Cap harian

`limits.maxAppliesPerDay` adalah **satu angka** yang dipatuhi kedua platform. Kalau
Anda tidak mengisi `jobstreet.limitPerDay`, angkanya ikut dari `limits` — jadi 50
artinya 50 untuk Glints dan 50 untuk Jobstreet, dengan penghitung masing-masing.
Kalau ingin membagi satu kuota untuk dua platform, set `jobstreet.limitPerDay` lebih kecil.

Baris yang disalin dari halaman `my-activity` disimpan dengan `counted: false` —
muncul di `jobstreet status` tapi **tidak pernah** mengurangi cap.

### Blok config

```json
"jobstreet": {
  "searchKeywords": ["frontend developer", "web developer"],
  "location": "jakarta",
  "limitPerDay": 50,
  "concurrency": 2,
  "maxPages": 3,
  "maxJobsPerKeyword": 40,
  "dryRun": false,
  "debugTest": 0,
  "minDelaySeconds": 3,
  "maxDelaySeconds": 6,
  "autoKeywords": true,
  "refreshKeywordsEvery": 0,
  "maxAutoKeywords": 12
}
```

| Field                                 | Default                                  | Artinya                                                                              |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `searchKeywords`                      | `["frontend developer","web developer"]` | Satu pencarian per keyword. Diabaikan kalau `autoKeywords` aktif.                    |
| `location`                            | `"jakarta"`                              | Slug atau nama kota — `jakarta`, `bontang`, `remote`.                                |
| `limitPerDay`                         | _(ikut `limits`)_                        | Override opsional. Kosongkan supaya `limits.maxAppliesPerDay` berlaku.               |
| `concurrency`                         | `2`                                      | Tab paralel untuk buka detail. 2 aman, 3+ berisiko captcha.                          |
| `maxPages`                            | `3`                                      | Halaman listing per keyword.                                                         |
| `maxJobsPerKeyword`                   | `40`                                     | Link yang dikumpulkan per keyword.                                                   |
| `dryRun`                              | `false`                                  | Sama dengan flag `--dry-run`.                                                        |
| `debugTest`                           | `0`                                      | Kalau > 0, berhenti setelah N apply — untuk smoke test.                              |
| `minDelaySeconds` / `maxDelaySeconds` | `3` / `6`                                | Rentang jeda antar apply.                                                            |
| `autoKeywords`                        | `true`                                   | Turunkan keyword dari riwayat + `filters.includeKeywords`.                           |
| `refreshKeywordsEvery`                | `0`                                      | Turunkan ulang tiap N run. `0` = tiap run. Cache: `.glints/jobstreet-keywords.json`. |
| `maxAutoKeywords`                     | `12`                                     | Batas atas keyword hasil turunan.                                                    |
| `locationOverride`                    | —                                        | Lokasi eksplisit, menang atas hasil turunan. Env `JOBSTREET_LOCATION` juga bisa.     |

Urutan penentuan lokasi: `locationOverride` / `JOBSTREET_LOCATION` → hasil turunan dari
riwayat → `location` di config → `answers.domicile` → `"jakarta"`.

### Jawaban Jobstreet dari CV

`/apply/role-requirements` menanyakan apa pun yang diset HRD, dan Jobstreet mengisi
sendiri dari profil Anda — sering **salah** (gaji `Rp 4.5 Jt`, pengalaman `1 tahun`).
Bot menimpa isian itu kalau CV punya jawaban. Semua penimpaan dicatat di log:

```
A: Berapa gaji bulanan yang kamu inginkan? → Rp 7 Jt (was Rp 4.5 Jt)
A: Berapa tahun pengalaman kerjamu sebagai programmer? → Lebih dari 5 tahun (was 1 tahun)
A: Kualifikasi mana yang kamu miliki? → Sarjana (S1) (was Diploma 4)
```

Yang dipakai dari CV: gaji (`expected_salary_idr`), pengalaman
(`years_of_relevant_experience_v2`, termasuk pertanyaan per-skill), pendidikan
(`education_level` — cocok untuk `Sarjana (S1)` maupun `Bachelor's Degree (S1)`),
hak bekerja, relocation, notice period, availability, domicile, industri, dan
daftar skill wajib.

Kalau CV Anda tidak punya satu pun opsi yang ditawarkan pada pertanyaan skill wajib,
bot menjawab jujur (`Tidak satupun`) daripada menebak.

### Keamanan

- `--dry-run` (atau `jobstreet.dryRun: true`) berjalan sampai tombol submit lalu berhenti.
  Dicatat sebagai `DRY_RUN` dan **tidak** mengurangi cap.
- `debugTest: 0` berarti tidak ada penghentian dini. Digabung dengan profil yang sudah
  login, `jobstreet apply` tanpa `--dry-run` akan **benar-benar** mengirim lamaran.
  Selalu dry-run dulu.
- Log per lowongan: `OK` terkirim, `DRY` dry-run, `SKIP [alasan]`, `FAIL [alasan]`.

| Alasan             | Artinya                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `ALREADY_APPLIED`  | Sudah ada di riwayat, atau platform bilang begitu.                                 |
| `EXTERNAL_APPLY`   | "Daftar / Apply on company website" — bukan kampanye on-site. Tidak pernah diklik. |
| `NO_APPLY_BUTTON`  | Tidak ada tombol apply di halaman detail.                                          |
| `AUTH_REQUIRED`    | Sesi habis — jalankan `jobstreet login` lagi.                                      |
| `FLOW_STUCK`       | Wizard tidak mau lanjut.                                                           |
| `SUBMIT_NOT_FOUND` | Sudah di halaman review tapi tombol submit tidak muncul.                           |
| `UNCONFIRMED_TEXT` | Terkirim, tapi banner sukses tidak terdeteksi. Cek `jobstreet status`.             |

---

## 🔧 Cara Kerja Mode 24/7

| Hasil run                         | Apa yang terjadi selanjutnya                                                    |
| --------------------------------- | ------------------------------------------------------------------------------- |
| Cap harian tercapai               | Tidur sampai tengah malam berikutnya (`cron.timezone`), lalu resume             |
| Cap per-run tercapai              | Tidur `auto.cooldownMinutes` menit (default 30)                                 |
| Feed habis / tidak ada yang cocok | Tidur `auto.idleMinutes` menit (default 20)                                     |
| Progress normal                   | Istirahat 2 menit, lalu run berikutnya                                          |
| Run error                         | Backoff 2 → 4 → 8 → 16 → 32 → 60 menit, berhenti setelah `maxConsecutiveErrors` |
| Server return 409 "sudah apply"   | Dicatat sebagai already-applied agar tidak di-retry                             |

> Tabel di atas berlaku untuk **Glints** (`auto` / `cron`). Jobstreet jalan manual.

---

## ❓ Troubleshooting

### "npm is not recognized"

Node.js belum terinstall atau belum masuk PATH. Restart Command Prompt, atau install ulang Node.js.

### "GLINTS_USERNAME or GLINTS_PASSWORD env vars"

File `.env` belum dibuat atau email/password kosong. Cek Langkah 4.

### Login gagal / error 401

Email atau password salah. Coba login manual di aplikasi Glints dulu untuk verifikasi.

### Bot tidak apply apa-apa

- Cek `filters.includeKeywords` — mungkin terlalu sempit
- Cek `keywordOptions.mode` — untuk non-IT, pakai `"all"` atau `"custom"`
- Jalankan `npx tsx src/cli.ts keywords` untuk preview keyword
- Jalankan `npx tsx src/cli.ts apply --dry-run` untuk lihat apa yang difilter

### Bagaimana stop bot?

Tekan `Ctrl + C` di terminal. Jika bot Jobstreet sedang jalan, tutup jendela browser
atau tekan `Ctrl + C` di terminal yang memulainya.

### Jobstreet: "Not logged in. Run 'jobstreet login' first."

Sesi sudah habis atau folder profil terhapus. Jalankan `npx tsx src/cli.ts jobstreet login` lagi.

### Jobstreet: "The browser is already running for …"

Ada proses lama yang masih memegang profil. Bersihkan:

```bash
pkill -f "jobstreet-profile"
```

### Jobstreet: "Navigation timeout of 60000 ms exceeded"

Jobstreet sedang lambat atau melempar Anda ke halaman login ulang. Ulangi run; kalau
hanya terjadi di satu lowongan, iklan itu memang rusak.

### Jobstreet: cap terlihat aneh

`npx tsx src/cli.ts jobstreet status` menampilkan hitungan hari ini yang sebenarnya.
Baris hasil sinkron dari `my-activity` disimpan dengan `counted: false` jadi tidak
mengurangi cap.

---

## 🧩 Struktur Kode

```
src/
├── client.ts            HTTP client Glints — REST + 2 endpoint GraphQL
├── queries.ts           operasi GraphQL yang direkam
├── types.ts             tipe respons
├── config.ts            config + .env
├── storage.ts           history + session JSON (batas hari sadar timezone)
├── filters.ts           aturan filter lowongan
├── answer-bank.ts       mapping pertanyaan Glints → jawaban
├── auto-keywords.ts     turunkan includeKeywords dari profil + pengalaman
├── engine.ts            loop auto-apply Glints
├── auto.ts              wrapper loop 24/7
├── tui.ts               terminal UI (alt-screen, diff render)
├── scheduler.ts         wrapper node-cron
├── cli.ts               entry commander
└── jobstreet/
    ├── browser.ts       launch puppeteer / siapkan page / jitter / sleep
    ├── types.ts         URL, tipe config, deteksi login, helper navigasi
    ├── auto-keywords.ts turunkan keyword + lokasi Jobstreet dari riwayat
    ├── bot.ts           kumpulkan listing, jalankan wizard, mesin jawaban
    └── index.ts         JobstreetBot — login / runApply / statusTable / syncStatus
```

**Glints.** Engine bergiliran antar sumber feed, dedupe terhadap riwayat lokal,
filter, ambil pertanyaan per lowongan, susun jawaban, submit, lalu buka channel chat
dan kirim intro. Event mengalir lewat EventEmitter — TUI dan logger cron sama-sama
berlangganan. `auto.ts` membungkus engine dalam loop tanpa akhir dengan jeda pintar,
menurunkan keyword dari profil secara berkala, dan menangani cap/error supaya proses
terus jalan tanpa intervensi.

**Jobstreet.** `JobstreetBot` menurunkan rencana pencarian (keyword + lokasi),
mengumpulkan link lowongan, membuang yang sudah ada di `.glints/jobstreet-history.json`,
lalu per lowongan: buka halaman detail, lewati iklan external-apply, klik
`/apply` → `/apply/role-requirements` → `/apply/profile` → `/apply/review`, jawab
setiap grup yang bisa dijawab (select, grup checkbox, grup radio, teks bebas), dan
submit kecuali dry-run. Setiap jawaban dicatat; cap diperiksa sebelum **setiap**
lamaran, bukan hanya di awal.

---

## 🗂️ File State

| Path                              | Isinya                                                            |
| --------------------------------- | ----------------------------------------------------------------- |
| `.glints/history.json`            | Riwayat apply Glints                                              |
| `.glints/jobstreet-history.json`  | Riwayat apply Jobstreet (`counted: false` = baris hasil sinkron)  |
| `.glints/jobstreet-keywords.json` | Cache keyword/lokasi hasil turunan + counter run                  |
| `.glints/jobstreet-profile/`      | Profil browser yang **sudah login** — perlakukan seperti password |
| `.glints/session.json`            | Sesi Glints                                                       |

Semua isi `.glints/` di-`.gitignore` dan tidak ikut ter-commit.

---

## Lisensi

Private.
