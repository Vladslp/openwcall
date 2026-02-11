import { z } from "zod";

const API_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export const authResponseSchema = z.object({
  sessionToken: z.string(),
  user: z.object({
    id: z.string(),
    name: z.string(),
    nickname: z.string().nullable().optional(),
    avatarUrl: z.string().nullable().optional()
  })
});

export async function loginByNickname(payload: { nickname: string }) {
  const response = await fetch(`${API_URL}/auth/nickname`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Failed to sign in" }));
    throw new Error(error?.message ?? "Failed to sign in");
  }

  const data = await response.json();
  return authResponseSchema.parse(data);
}
