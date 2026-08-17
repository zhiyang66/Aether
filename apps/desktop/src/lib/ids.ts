let counter = 1;

export function nextId(prefix = "id"): string {
  const rand = Math.random().toString(36).substring(2, 7);
  const ts = Date.now().toString(36);
  return `${prefix}-${ts}-${counter++}-${rand}`;
}

export function resetIdCounter(n = 1) {
  counter = n;
}

export function peekId(): number {
  return counter;
}

