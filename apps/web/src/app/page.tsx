"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "../store/auth";

export default function HomePage() {
  const router = useRouter();
  const token = useAuthStore((state) => state.accessToken);

  useEffect(() => {
    if (token) {
      router.replace("/app");
    } else {
      router.replace("/login");
    }
  }, [router, token]);

  return null;
}
