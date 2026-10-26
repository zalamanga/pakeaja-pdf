# Catatan pemeriksaan

Pemeriksaan pada 26 Oktober 2026 memakai dokumen sintetis dan Chrome. Hasil di bawah membedakan uji murni/mock, eksekusi browser, pembacaan hasil dengan pustaka independen, serta pengamatan visual. Angka keberhasilan hanya berlaku untuk kasus yang disebutkan.

## Hasil yang sudah dijalankan

| Pemeriksaan | Hasil dan cakupan |
| --- | --- |
| Uji yang disertakan | 39 lulus, 0 gagal, 0 dilewati. Mencakup validasi opsi/rentang/sandi, geometri, kontrak worker, perubahan pilihan/pembatalan, resource dan publikasi build. Adapter palsu tidak membuktikan engine PDF. |
| Build akhir | Build lulus dengan 228 berkas dalam manifest deployment; manifestnya sendiri bukan endpoint tambahan. Pemeriksaan sintaks modul domain dan 39 uji lulus setelah perubahan JavaScript/judul. Dua aturan CSS tautan lewati ditambahkan sesudahnya dan diperiksa secara terarah. Build terakhir sesudah perapihan pengantar pemberitahuan lisensi serta metadata juga lulus; kode runtime dan isi pemberitahuan upstream tetap sama. |
| Pustaka runtime | 205 berkas dipin dengan ukuran dan SHA-256. Sweep HTTP mengambil serta membandingkan setiap berkas. Ini membuktikan ketersediaan, bukan bahwa setiap dokumen secara alami membutuhkan semua resource tersebut. |
| Alur positif browser | Seluruh 25 alat dijalankan melalui UI: 59 pemeriksaan lulus dan 52 file hasil diunduh. Variasi meliputi pengaturan, urutan, format dan kata sandi. |
| Pemeriksaan hasil independen | Seluruh 52 hasil diperiksa sesuai format dan kontraknya. PDF dibaca dengan parser di luar engine aplikasi; ZIP/DOCX diperiksa struktur/isinya, dan gambar diperiksa ukuran serta formatnya. |
| Pemeriksaan visual hasil | Seluruh 124 halaman PDF yang relevan, termasuk anggota ZIP, dirender; 8 gambar hasil ekspor diperiksa. Peninjau melihat seluruhnya melalui 22 lembar kontak. |
| QPDF | Versi engine aktual 12.2.0 diamati dari loader/WASM yang sama byte-nya. Browser menjalankan proteksi AES-256 dan pembukaan salinan dengan variasi sandi benar, salah, kosong, Unicode, spasi, awalan `-`/`@` dan batas 127 byte. |
| Gangguan dan state | 18 pemeriksaan awal lulus, termasuk pilihan invalid yang mempertahankan file lama, parser gagal, identitas worker salah, pembatalan, hasil terlambat dan validasi sandi sebelum dispatch. Dua batas waktu nyata tercatat 60.573 ms dan 60.460 ms dengan pembacaan File yang sengaja tidak selesai. |
| UI setelah perbaikan CSS | 16 pemeriksaan lulus: kategori/pencarian, tautan, urutan file, drop melalui DataTransfer browser, pratinjau, modul/worker gagal, serta 8 kombinasi lebar 320/375/768/1280 dan font akar 100%/200%. Dialog dan target aktif memenuhi pemeriksaan geometri yang diukur. |
| Pemeriksaan setelah perubahan judul/tanda baca | 12 pemeriksaan lulus: penjelasan JavaScript mati, 8 geometri halaman statis pada lebar/font yang sama, startup normal dengan 25 kartu, dan 2 hasil TXT Bandingkan PDF. Kedua TXT memakai decoding UTF-8 ketat; kasus halaman hilang memuat tanda koma baru dan kasus dua halaman kosong tetap sama. |
| Perbaikan akhir tautan lewati | 10 pemeriksaan lulus: notice statis, 8 geometri JavaScript mati, serta Tab/Enter pada lebar 320 dan font akar 200%. Tautan tersembunyi sepenuhnya sebelum fokus, tampil utuh ketika Tab menyorotnya, lalu Enter menuju `#alat`. Peninjau melihat dua screenshot baru. |

Ganti Nama PDF sengaja menerima satu fixture yang tidak dapat dibaca sebagai PDF dan menyalin byte-nya persis. Pemeriksa membuktikan kontrak salinan tersebut; angka 52 hasil tidak berarti 52 file PDF yang dapat diparse.

Pemeriksa hasil memakai pypdf untuk PDF biasa dan PDFium untuk parsing/dekripsi/render yang relevan, terpisah dari PDF.js/PDF-lib/QPDF aplikasi. Uji format dan peninjauan visual saling melengkapi; render yang berhasil saja tidak membuktikan seluruh semantik dokumen.

## Riwayat kegagalan dan batas bukti

Run gangguan lama berhenti pada overflow lebar 320 dengan font akar 200%. Perbaikan CSS kemudian diuji ulang pada seluruh 8 kombinasi geometri UI. Run UI berikutnya tetap tercatat gagal pada langkah terakhir: penguji memakai pencocokan teks untuk elemen `noscript`. Sumber Playwright yang terpasang secara eksplisit mengecualikan `NOSCRIPT` dari pencocokan teks; [laporan upstream](https://github.com/microsoft/playwright/issues/32542) membahas perilaku tersebut. Run terarah memakai selector CSS, lalu memeriksa DOM, `textContent` dan visibilitas notice. Kedua laporan gagal lama dipertahankan dan tidak diubah menjadi lulus.

Peninjauan screenshot berikutnya menemukan potongan teks tautan lewati yang masih muncul sebelum fokus pada lebar 320/font 200%. Dua aturan CSS kemudian memperbaiki posisi tersembunyi dan posisi fokusnya. Build serta 10 pemeriksaan terarah terakhir lulus; hasil sebelumnya tetap dipertahankan sesuai tahapnya.

Setelah perubahan CSS, judul dan tanda baca perbandingan, 52 keluaran lama tidak diproses ulang seluruhnya. Byte engine/vendor tetap sama. Bukti lama untuk 50 keluaran lain dipertahankan; dua perbandingan TXT dibuat dan diperiksa lagi setelah perubahan tanda baca, sebelum perbaikan CSS tautan lewati. Uji 60 detik dan 39 uji murni juga tidak diulang untuk dua aturan CSS terakhir.

Geometri menggunakan viewport browser dan perubahan ukuran font akar, bukan zoom native. Drop menggunakan DataTransfer di browser, bukan drag dari sistem operasi. Mode JavaScript mati memakai pengaturan Playwright `javaScriptEnabled: false`; pengamatan DOM oleh otomasi tidak menyatakan bahwa semua preferensi browser/perangkat berubah. Pengukuran fokus/kontras yang tercakup tidak menjadi klaim audit WCAG AA untuk seluruh aplikasi.

Pengujian browser mencatat hanya permintaan GET lokal, tanpa permintaan keluar origin, dan menutup konteks yang dimilikinya. Log, fixture, profil pengujian serta harness privat berada di luar repositori. Screenshot publik menampilkan UI asli dengan dokumen sintetis; tidak ada data pengguna atau kata sandi di dalamnya.

## Pemeriksaan manual singkat

Jalankan build/server dan uji yang tersedia dari [README](../README.md). Untuk mencoba perilaku dasar tanpa menambah alat pengujian:

1. Buka halaman lokal. Cari `gabungkan`, kosongkan pencarian lewat keyboard, lalu pastikan katalog kembali tampil.
2. Pilih dua PDF kecil milikmu pada Gabungkan PDF. Ubah urutan file, proses, unduh dan buka hasil untuk memeriksa urutannya.
3. Pada Atur Urutan Halaman, baca pratinjau dan pindahkan halaman dengan Naik/Turun. Periksa hasil setelah proses.
4. Ubah satu pengaturan setelah hasil tersedia. Pastikan hasil lama hilang dan aplikasi meminta proses ulang.
5. Coba batalkan pekerjaan, tutup dialog dengan keyboard dan buka alat lain. Pastikan pengaturan/hasil lama tidak muncul pada pekerjaan baru.
6. Kecilkan viewport dan perbesar ukuran teks. Periksa label, tombol dan dialog; jika menemukan kegagalan, catat browser, alat, langkah dan pesan yang tampil tanpa mengunggah dokumen sensitif.

Uji manual ini membantu memeriksa pemasangan sendiri. Pengujian tersebut tidak menggantikan pemeriksaan format/hasil independen atau membuktikan semua PDF akan berhasil diproses.
