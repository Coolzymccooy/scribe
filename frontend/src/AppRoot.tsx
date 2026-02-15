import React, { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import App from "./App";
import AuthScreen from "./components/AuthScreen";
import {
  completeRedirectAuth,
  isFirebaseConfigured,
  sendResetPasswordEmail,
  signInWithEmailPassword,
  signInWithGoogle,
  signUpWithEmailPassword,
  signOutUser,
  subscribeToAuth,
} from "./services/firebase";

const AppRoot: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  useEffect(() => {
    let isDisposed = false;

    const hydrateRedirectResult = async () => {
      try {
        await completeRedirectAuth();
      } catch (err) {
        if (!isDisposed) {
          setAuthError(err instanceof Error ? err.message : "Google authentication failed.");
        }
      }
    };

    void hydrateRedirectResult();

    const unsubscribe = subscribeToAuth((user) => {
      if (isDisposed) return;
      setCurrentUser(user);
      setAuthReady(true);
    });

    return () => {
      isDisposed = true;
      unsubscribe();
    };
  }, []);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthError(null);
    setAuthNotice(null);
    setIsBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Google authentication failed.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthError(null);
    setAuthNotice(null);
    setIsBusy(true);
    try {
      await signOutUser();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not sign out.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleEmailSignIn = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    setAuthNotice(null);
    setIsBusy(true);
    try {
      await signInWithEmailPassword(email, password);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Email sign in failed.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleEmailSignUp = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    setAuthNotice(null);
    setIsBusy(true);
    try {
      await signUpWithEmailPassword(email, password);
      setAuthNotice("Account created successfully.");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Account sign up failed.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleResetPassword = useCallback(async (email: string) => {
    setAuthError(null);
    setAuthNotice(null);
    setIsBusy(true);
    try {
      await sendResetPasswordEmail(email);
      setAuthNotice("Password reset link sent. Check your inbox and spam folder.");
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Password reset failed.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 text-white grid place-items-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl border-2 border-cyan-300/70 border-t-transparent animate-spin mx-auto" />
          <p className="text-xs uppercase tracking-[0.35em] text-cyan-200 font-bold">Booting secure workspace</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        isBusy={isBusy}
        error={authError}
        notice={authNotice}
        firebaseConfigured={isFirebaseConfigured}
        onGoogleSignIn={handleGoogleSignIn}
        onEmailSignIn={handleEmailSignIn}
        onEmailSignUp={handleEmailSignUp}
        onResetPassword={handleResetPassword}
      />
    );
  }

  return (
    <>
      <div className="fixed top-4 right-4 max-[360px]:top-2 max-[360px]:right-2 z-[70] flex items-center gap-3 max-[360px]:gap-2 px-3 max-[360px]:px-2 py-2 max-[360px]:py-1.5 rounded-xl border border-white/10 bg-slate-900/80 text-white backdrop-blur-xl shadow-2xl max-[360px]:max-w-[95vw]">
        <div className="max-w-[160px] max-[360px]:max-w-[110px] truncate text-[11px] max-[360px]:text-[9px] font-black uppercase tracking-[0.2em] max-[360px]:tracking-[0.12em] text-cyan-100">
          {currentUser.displayName || currentUser.email || "Google User"}
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isBusy}
          className="px-3 max-[360px]:px-2 py-1.5 max-[360px]:py-1 rounded-lg bg-white text-slate-900 text-[10px] max-[360px]:text-[9px] font-black uppercase tracking-widest max-[360px]:tracking-[0.12em] disabled:opacity-60"
        >
          Sign out
        </button>
      </div>
      <App />
    </>
  );
};

export default AppRoot;
