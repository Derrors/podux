// Node >= 25 ships an experimental global `localStorage` that shadows jsdom's and has no
// working methods unless started with --localstorage-file. Replace it with an in-memory store.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  if (typeof globalThis[name]?.setItem !== "function") {
    Object.defineProperty(globalThis, name, { configurable: true, value: new MemoryStorage() });
  }
}
