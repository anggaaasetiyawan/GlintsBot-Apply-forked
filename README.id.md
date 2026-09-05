# GlintsAuto

**🌐 Read in English → [README.md](README.md)**

Bot auto-apply untuk Glints. TypeScript, terminal UI, cron + mode 24/7.
Dengan API yang sama yang digunakan aplikasi Android.

> Edukasi only. Gunakan di akun sendiri. Jangan disalahgunakan.
> Gapunya Orang Dalam, punyanya OTAK yang bisa dipake.

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

Tanpa browser automation. Tanpa Selenium. Hanya HTTP.

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

### Langkah 8: Jalankan!

```cmd
# Sekali jalan (dengan dashboard keren)
npx tsx src/cli.ts apply

# Mode 24/7 (jalan terus, auto-apply, auto-tidur saat cap tercapai)
npx tsx src/cli.ts auto
```

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
  "expected_salary_idr": 7000000
}
```

Sesuaikan dengan profil Anda. Jika ada pertanyaan yang tidak ada di list, bot akan skip lowongan itu dan log `missing-answers:<nama>`.

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
```

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
```

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

Tekan `Ctrl + C` di terminal.

---

## Lisensi

Private.
