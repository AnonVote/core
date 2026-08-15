import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

prisma.$use(async (params: any, next: any) => {
  if (params.model === "Ballot" && params.action === "create") {
    const data = params.args.data as Record<string, unknown> & {
      ballotKey?: unknown;
    };

    if (!data.ballotKey) {
      params.args.data = {
        ...data,
        ballotKey: {
          create: {
            key: randomBytes(32).toString("hex"),
          },
        },
      };
    }
  }

  return next(params);
});

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
