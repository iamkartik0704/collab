import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
    /** Epoch seconds after which the access token must be refreshed. */
    accessExpiresAt: number;
  }

  interface User {
    role?: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    /** Refresh-token family id (one per device sign-in). */
    sid?: string;
    /** Epoch seconds; access-token expiry. */
    accessExp?: number;
  }
}
