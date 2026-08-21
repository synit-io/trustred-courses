import type { UserRole } from "@/lib/types.ts";

export type SessionUser = { id: string; email: string; role: UserRole };

export type AppEnv = {
  Variables: {
    sessionUser?: SessionUser;
  };
};
