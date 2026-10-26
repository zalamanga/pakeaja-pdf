const field = (label, kind, values, fallback, extra = {}) => Object.freeze({ label, kind, values, fallback, ...extra });
const select = (label, values, fallback) => field(label, "select", values, fallback);
const input = (label, fallback, extra = {}) => field(label, "text", undefined, fallback, extra);
const integer = (label, minimum, maximum, fallback) => field(label, "integer", undefined, fallback, { minimum, maximum });
const ranges = input("Halaman, misalnya 1,3,5-7", "", { maximum: 2000 });
const paper = select("Ukuran halaman", ["A4", "Letter", "fit"], "A4");
const tools = [
  ["merge", "Gabungkan PDF", "Atur PDF", "Satukan halaman menurut urutan file yang kamu susun.", "pdf", "pdf", {}],
  ["extract", "Ambil Halaman", "Atur PDF", "Salin halaman yang dipilih ke satu PDF baru.", "pdf", "pdf", { ranges }],
  ["split-page", "Pisahkan per Halaman", "Atur PDF", "Buat satu PDF per halaman dalam ZIP. Maksimal 100 halaman.", "pdf", "zip", {}],
  ["split-size", "Pisahkan Berdasarkan Ukuran", "Atur PDF", "Bagi halaman berurutan dengan perkiraan ukuran. Ukuran tiap bagian dapat melewati target.", "pdf", "zip", { targetMiB: select("Target perkiraan (MiB)", [5, 10, 20, 25], 10) }],
  ["delete", "Hapus Halaman", "Atur PDF", "Hapus halaman pilihan; setidaknya satu halaman harus tersisa.", "pdf", "pdf", { ranges }],
  ["organize-pages", "Atur Urutan Halaman", "Atur PDF", "Susun semua halaman dengan pratinjau, seret, atau tombol naik dan turun.", "pdf", "pdf", {}],
  ["scan-pdf", "Scan ke PDF", "Atur PDF", "Susun foto JPG/PNG menjadi PDF. Pilihan kamera bergantung pada perangkat; tanpa OCR.", "image", "pdf", { paper }],
  ["pdf-image", "PDF ke Gambar", "Konversi PDF", "Simpan halaman sebagai JPG/PNG. Beberapa halaman menghasilkan ZIP.", "pdf", "image-or-zip", { format: select("Format gambar", ["jpg", "png"], "jpg"), scale: select("Skala render", [1.25, 1.75, 2.25], 1.75) }],
  ["pdf-word", "PDF ke Word", "Konversi PDF", "Ekspor teks yang dapat dipilih ke DOCX dengan pemisah halaman. Tata letak asli tidak direkonstruksi.", "pdf", "docx", {}],
  ["pdf-text", "PDF ke Teks", "Konversi PDF", "Ekspor teks yang dapat dipilih dengan penanda setiap halaman. Tanpa OCR.", "pdf", "txt", {}],
  ["image-pdf", "Gambar ke PDF", "Konversi PDF", "Satu foto JPG/PNG per halaman, mengikuti urutan file.", "image", "pdf", { paper }],
  ["compress", "Kecilkan Ukuran PDF", "Optimalkan", "Render ulang menjadi gambar: teks tidak lagi dapat dipilih dan hasil dapat lebih besar.", "pdf", "pdf", { quality: select("Kualitas raster", ["small", "balanced", "clear"], "balanced") }],
  ["resize", "Ubah Ukuran Halaman", "Optimalkan", "Tempatkan isi secara proporsional pada ukuran kertas pilihan. Formulir/anotasi dapat berubah.", "pdf", "pdf", { paper: select("Ukuran kertas", ["A4", "A3", "Letter", "Legal"], "A4"), orientation: select("Orientasi", ["auto", "portrait", "landscape"], "auto") }],
  ["repair", "Coba Perbaiki PDF", "Optimalkan", "Tulis ulang PDF yang masih dapat dibaca parser. Pemulihan kerusakan tidak dijamin.", "pdf", "pdf", {}],
  ["rotate", "Putar Halaman", "Edit PDF", "Tambahkan rotasi pada semua halaman atau rentang pilihan.", "pdf", "pdf", { ranges: { ...ranges, label: "Halaman (kosong untuk semua)" }, angle: select("Tambahan rotasi", [90, 180, 270], 90) }],
  ["page-numbers", "Tambah Nomor Halaman", "Edit PDF", "Nomor halaman menggunakan Helvetica dan enam posisi pilihan.", "pdf", "pdf", { start: integer("Nomor awal", 1, 9999, 1), position: select("Posisi", ["bottom-left", "bottom-center", "bottom-right", "top-left", "top-center", "top-right"], "bottom-center") }],
  ["watermark", "Tambah Watermark", "Edit PDF", "Tambahkan teks diagonal yang terlihat. Font standar menerima karakter WinAnsi.", "pdf", "pdf", { text: input("Teks watermark", "", { maximum: 100 }), opacity: select("Kepekatan", [0.16, 0.28, 0.45], 0.28) }],
  ["crop", "Potong Halaman", "Edit PDF", "Ubah batas tampilan setiap halaman. Isi di luar batas tetap dapat tersimpan; bukan redaksi.", "pdf", "pdf", Object.fromEntries(["left", "right", "top", "bottom"].map((side) => [side, integer(({ left: "Kiri", right: "Kanan", top: "Atas", bottom: "Bawah" })[side] + " (mm)", 0, 500, 0)]))],
  ["add-text", "Tambah Teks", "Edit PDF", "Tambahkan teks satu baris dari sudut kiri bawah tampilan. Font standar menerima WinAnsi.", "pdf", "pdf", { text: input("Teks", "", { maximum: 500 }), page: integer("Halaman", 1, 200, 1), x: integer("X dari kiri (mm)", 0, 1000, 20), y: integer("Y dari bawah (mm)", 0, 1000, 20), size: integer("Ukuran font (pt)", 6, 96, 16) }],
  ["sign", "Tanda Tangan Visual", "Edit PDF", "Tuliskan nama pada halaman terakhir. Ini tanda visual, tanpa sertifikat digital.", "pdf", "pdf", { name: input("Nama yang ditampilkan", "", { maximum: 100 }) }],
  ["protect", "Lindungi PDF", "Keamanan", "Gunakan kata sandi untuk membuka hasil AES-256. Simpan sendiri kata sandimu.", "pdf", "pdf", { password: input("Kata sandi baru (8+ karakter, maksimal 127 byte UTF-8)", "", { password: true }) }],
  ["unlock", "Buka Proteksi PDF", "Keamanan", "Simpan salinan tanpa proteksi bila PDF dapat dibuka dengan kata sandi yang kamu berikan.", "pdf", "pdf", { password: input("Kata sandi PDF (boleh kosong)", "", { password: true }) }],
  ["compare", "Bandingkan PDF", "Keamanan", "Bandingkan teks serta keberadaan halaman dari dua PDF, termasuk halaman kosong. Tanpa perbandingan visual.", "pdf", "txt", {}],
  ["rename", "Ganti Nama PDF", "Kelola File", "Salin isi file persis dengan nama baru. Isi tidak dibaca atau diperbaiki.", "pdf", "pdf", { name: input("Nama file hasil", "dokumen-baru", { maximum: 90 }) }],
  ["pdf-markdown", "PDF ke Markdown", "PDF Intelligence", "Ekspor teks yang dapat dipilih dengan judul per halaman. Struktur tabel tidak direkonstruksi.", "pdf", "md", {}],
];
export const TOOLS = Object.freeze(tools.map(([id, title, category, description, input, output, options]) => Object.freeze({ id, title, category, description, input, output, options: Object.freeze(options) })));
export const CATEGORIES = Object.freeze(["Semua alat", ...new Set(TOOLS.map((tool) => tool.category))]);
export function toolById(id) {
  const tool = TOOLS.find((item) => item.id === id);
  if (!tool) throw new Error("Alat PDF tidak dikenal.");
  return tool;
}
export const defaultsFor = (id) => Object.fromEntries(Object.entries(toolById(id).options).map(([key, value]) => [key, value.fallback]));
