"use client";

import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useCallback, useEffect, useState } from "react";
import { auth, googleProvider } from "../lib/firebase";
import { withAutoAvatar } from "../lib/avatar";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 15000;

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function shouldRetryWithFreshToken(message) {
  const normalized = String(message || "").toLowerCase();
  return (
    normalized.includes("invalid firebase token") ||
    normalized.includes("token has expired") ||
    normalized.includes("token verification failed")
  );
}

async function getFreshFirebaseToken(user) {
  const token = await user.getIdToken(true);
  if (!token) {
    throw new Error("Unable to get Firebase ID token.");
  }
  return token;
}

function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPreviewMode = searchParams.get("preview") === "1";

  const [mode, setMode] = useState("signup");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const AUTH_IMAGE_SRC = "/auth-left-panel.png";

  const exchangeFirebaseToken = useCallback(
    async (firebaseToken, selectedMode) => {
      const endpoint = selectedMode === "signup" ? "/auth/signup" : "/auth/login/google";

      let authResponse;
      try {
        authResponse = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firebase_token: firebaseToken }),
        });
      } catch (err) {
        const reason =
          err instanceof DOMException && err.name === "AbortError"
            ? "request timed out"
            : err instanceof Error
              ? err.message
              : "fetch failed";
        throw new Error(`Cannot reach backend API (${reason}).`);
      }

      const authData = await parseJsonSafely(authResponse);
      if (!authResponse.ok) {
        throw new Error(authData?.detail || "Authentication failed");
      }

      localStorage.setItem("access_token", authData.access_token);

      if (authData?.user) {
        localStorage.setItem("current_user", JSON.stringify(withAutoAvatar(authData.user)));
        router.replace("/app");
        return;
      }

      let meResponse;
      try {
        meResponse = await fetchWithTimeout(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${authData.access_token}` },
        });
      } catch (err) {
        const reason =
          err instanceof DOMException && err.name === "AbortError"
            ? "request timed out"
            : err instanceof Error
              ? err.message
              : "fetch failed";
        throw new Error(`Cannot load profile from backend API (${reason}).`);
      }

      const meData = await parseJsonSafely(meResponse);
      if (!meResponse.ok) {
        throw new Error(meData?.detail || "Failed to load user profile");
      }

      localStorage.setItem("current_user", JSON.stringify(withAutoAvatar(meData)));
      router.replace("/app");
    },
    [router],
  );

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (token && !isPreviewMode) {
      router.replace("/app");
      return;
    }

    const processRedirect = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) {
          const pendingMode = localStorage.getItem("auth_mode") || "login";
          const firebaseToken = await getFreshFirebaseToken(result.user);
          await exchangeFirebaseToken(firebaseToken, pendingMode);
          localStorage.removeItem("auth_mode");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sign in failed";
        setError(message);
      }
    };

    processRedirect();

    const unsubscribe = onAuthStateChanged(auth, () => {});
    return () => unsubscribe();
  }, [exchangeFirebaseToken, isPreviewMode, router]);

  const handleGoogleAuth = async () => {
    setLoading(true);
    setError("");

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const cachedToken = await result.user.getIdToken();
      await exchangeFirebaseToken(cachedToken, mode);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : "";

      if (code === "auth/popup-blocked" || code === "auth/cancelled-popup-request") {
        localStorage.setItem("auth_mode", mode);
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      let message = err instanceof Error ? err.message : "Sign in failed";

      if (auth.currentUser && shouldRetryWithFreshToken(message)) {
        try {
          const refreshedToken = await getFreshFirebaseToken(auth.currentUser);
          await exchangeFirebaseToken(refreshedToken, mode);
          return;
        } catch (retryErr) {
          message = retryErr instanceof Error ? retryErr.message : "Sign in failed";
        }
      }

      setError(code ? `${message} (${code})` : message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden">
      <img
        src={AUTH_IMAGE_SRC}
        alt="Authentication visual"
        className="absolute inset-0 h-full w-full object-cover object-[38%_center]"
      />
      <div className="absolute inset-0 bg-[#1a4d2e]/78" />

      <div className="relative min-h-screen flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md rounded-2xl border border-white/25 bg-white/92 p-8 shadow-2xl backdrop-blur-sm">
          {isPreviewMode && (
            <p className="mb-4 text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-700 px-3 py-2">
              Preview mode enabled. Existing session redirect is temporarily disabled.
            </p>
          )}

          <div className="space-y-6">
            <div className="mb-8">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Authentication</h1>
              <p className="text-sm text-slate-500 mt-2">
                Choose sign up or login, then continue with Google.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 p-1 bg-slate-50">
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`rounded-lg py-2.5 text-sm font-medium transition ${
                  mode === "signup"
                    ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                New Sign Up
              </button>
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`rounded-lg py-2.5 text-sm font-medium transition ${
                  mode === "login"
                    ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Login
              </button>
            </div>

            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={loading}
              className="w-full rounded-xl bg-[#1a4d2e] text-white py-3 font-medium disabled:opacity-60"
            >
              {loading ? "Please wait..." : mode === "signup" ? "Sign up with Google" : "Login with Google"}
            </button>

            {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function LoginPageWrapper() {
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
