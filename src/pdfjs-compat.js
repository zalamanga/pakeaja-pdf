const defineIfMissing = (target, name, value) => {
  if (typeof target[name] === 'function') return;
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
};

defineIfMissing(Promise, 'try', (callback, ...args) => new Promise((resolve, reject) => {
  try { resolve(callback(...args)); } catch (error) { reject(error); }
}));

defineIfMissing(Promise, 'withResolvers', () => {
  let resolve;
  let reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
});

defineIfMissing(Uint8Array, 'fromBase64', (encoded) => {
  const binary = atob(String(encoded).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
});

defineIfMissing(Uint8Array.prototype, 'toBase64', function toBase64() {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < this.length; offset += chunkSize) {
    binary += String.fromCharCode(...this.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
});

defineIfMissing(Uint8Array.prototype, 'toHex', function toHex() {
  return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('');
});
