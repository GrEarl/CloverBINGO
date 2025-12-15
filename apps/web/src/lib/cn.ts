export type ClassValue = string | number | null | undefined | false | ClassValue[];

function pushClass(out: string[], input: ClassValue): void {
  if (!input) return;
  if (Array.isArray(input)) {
    for (const item of input) pushClass(out, item);
    return;
  }
  if (typeof input === "string") {
    if (!input) return;
    out.push(input);
    return;
  }
  if (typeof input === "number") {
    out.push(String(input));
  }
}

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) pushClass(out, input);
  return out.join(" ");
}

