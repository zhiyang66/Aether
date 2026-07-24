let counter = 1;

export function nextId(prefix = "id"): string {
  return `${prefix}-${counter++}`;
}

export function resetIdCounter(n = 1) {
  counter = n;
}

export function peekId(): number {
  return counter;
}
