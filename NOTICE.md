# Asal kode dan aset

PakeAjaPDF berasal dari proyek lokal dengan nama yang sama. Nama aplikasi, ikon dokumen, jalur ikon alat, dan tujuan 25 alat dipertahankan. Kode aplikasi disusun ulang menjadi modul dengan validasi, pembatalan pekerjaan dan pemisahan worker.

Informasi penulis dan lisensi kode aplikasi lama belum tercatat dalam sumber yang diaudit. Repositori ini tidak menetapkan lisensi baru untuk kode/aset tersebut dan tidak menganggapnya sebagai karya milik pustaka pihak ketiga.

Pustaka vendor memiliki pemberitahuan dan lisensinya sendiri di [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Manifest [vendor-manifest.json](vendor-manifest.json) mencatat versi, URL artefak, anggota arsip, ukuran dan SHA-256. Berkas runtime disalin tanpa perubahan dari artefak resmi yang telah dibandingkan. Bundle DOCX lama yang asalnya tidak tercatat tidak digunakan.

Font Liberation lama yang dibawa PDF.js memakai ketentuan GPLv2 dengan pengecualian font yang tertulis dalam pemberitahuan upstream. Arsip sumber lengkap versi yang dipin disertakan di src/vendor/source. Ketentuan ini dibedakan dari lisensi kode aplikasi dan tidak disamakan dengan rilis Liberation versi lain.

Dua berkas sandbox QuickJS PDF.js tidak disertakan. Aplikasi tidak meminta eksekusi skrip PDF. Pemeriksaan browser mengambil seluruh 205 berkas runtime yang dipin dan menjalankan semua 25 alat dengan dokumen sintetis. Cakupan serta batas bukti dijelaskan di [docs/VERIFICATION.md](docs/VERIFICATION.md).
