import { z } from "zod";

const API_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string()
  })
});

export async function registerUser(payload: { email: string; name: string; password: string }) {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Failed to register");
  }
  const data = await response.json();
  return authResponseSchema.parse(data);
}

export async function loginUser(payload: { email: string; password: string }) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Failed to login");
  }
  const data = await response.json();
  return authResponseSchema.parse(data);
}

export async function refreshSession(refreshToken: string) {
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
  if (!response.ok) {
    throw new Error("Failed to refresh");
  }
  const data = await response.json();
  return authResponseSchema.parse(data);
}

export async function logout(refreshToken: string) {
  await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
}
