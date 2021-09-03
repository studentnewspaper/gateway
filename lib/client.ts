import { PrismaClient } from "@prisma/client";

export const client = new PrismaClient({
  // log: ["query", "info", "error", "warn"],
});

export async function init() {
  await client.$connect();
}
