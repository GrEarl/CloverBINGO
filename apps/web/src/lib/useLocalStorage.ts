import { useEffect, useState } from "react";

export function useLocalStorageString(key: string, initialValue: string) {
  const [value, setValue] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored ?? initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  }, [key, value]);

  return [value, setValue] as const;
}

