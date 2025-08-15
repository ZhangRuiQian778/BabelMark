export function throttle<T extends (...args: any[]) => void>(fn: T, wait: number) {
  let last = 0;
  let timer: any;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        fn(...args);
      }, remaining);
    }
  };
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const storage = {
  get<T>(key: string, def: T): T {
    try {
      const v = localStorage.getItem(key);
      if (v == null) return def;
      return JSON.parse(v) as T;
    } catch {
      return def;
    }
  },
  set(key: string, v: any) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {}
  },
};
