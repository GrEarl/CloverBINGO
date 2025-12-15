import { drizzle } from "drizzle-orm/d1";

import type { Bindings } from "../bindings";

export function getDb(env: Bindings) {
  return drizzle(env.DB);
}

