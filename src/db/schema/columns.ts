import { numeric } from "drizzle-orm/pg-core";

/** USD amounts. Credits are whole integers, not money. */
export const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });
