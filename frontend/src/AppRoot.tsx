import React, { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import App from "./App";
import AuthScreen from "./components/AuthScreen";
import {
  completeRedirectAuth,
  isFirebaseConfigured,
  resendVerificationEmail,
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
  const [verificationHint, setVerificationHint] = useState<string | null>(null);

  const isUnverifiedEmailPasswordUser = useCallback((user: User) => {
    const hasPasswordProvider = user.providerData.some((provider) => provider.providerId === "password");
    return hasPasswordProvider && !user.emailVerified;
  }, []);

  useEffect(() => {
    let isDisposed = false;
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("verified") === "email") {
        setAuthNotice("Email verification received. Sign in to continue.");
        params.delete("verified");
        const next = params.toString();
        const cleanUrl = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash || ""}`;
        window.history.replaceState({}, "", cleanUrl);
      }
    }

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
      if (user && isUnverifiedEmailPasswordUser(user)) {
        setCurrentUser(null);
        setAuthReady(true);
        setVerificationHint(
          `Verify ${user.email || "your email"} before access. After verification, return and click 'I've verified - continue'.`
        );
        void signOutUser().catch(() => {
          // no-op
        });
        return;
      }
      setCurrentUser(user);
      setAuthReady(true);
    });

    return () => {
      isDisposed = true;
      unsubscribe();
    };
  }, [isUnverifiedEmailPasswordUser]);

  const handleGoogleSignIn = useCallback(async () => {
    setAuthError(null);
    setAuthNotice(null);
    setVerificationHint(null);
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
    setVerificationHint(null);
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
    setVerificationHint(null);
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
    setVerificationHint(null);
    setIsBusy(true);
    try {
      const user = await signUpWithEmailPassword(email, password);
      const targetEmail = user.email || email.trim();
      setVerificationHint(
        `Verification email sent to ${targetEmail}. Open it, verify, then click 'I've verified - continue'.`
      );
      setAuthNotice(
        "Check inbox/spam for your verification link. You must verify before app access."
      );
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Account sign up failed.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleResetPassword = useCallback(async (email: string) => {
    setAuthError(null);
    setAuthNotice(null);
    setVerificationHint(null);
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

  const handleResendVerification = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    setAuthNotice(null);
    setIsBusy(true);
    try {
      const result = await resendVerificationEmail(email, password);
      if (result.alreadyVerified) {
        setAuthNotice("This email is already verified. Click 'I've verified - continue' to enter.");
        setVerificationHint(
          `Verification already completed for ${result.email}. Continue to access your workspace.`
        );
      } else {
        setAuthNotice(`Verification email resent to ${result.email}. Check inbox and spam.`);
        setVerificationHint(
          `A new verification email was sent to ${result.email}. After verifying, click 'I've verified - continue'.`
        );
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Could not resend verification email.");
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
        onResendVerification={handleResendVerification}
        verificationHint={verificationHint}
      />
    );
  }

  return (
    <App
      accountLabel={currentUser.displayName || currentUser.email || "Google User"}
      onSignOut={handleSignOut}
      isAuthBusy={isBusy}
    />
  );
};

export default AppRoot;
