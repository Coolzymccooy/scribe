import React, { useMemo, useState } from "react";
import scribeAiLogo from "../assets/scribeai-logo.png";

type AuthMode = "signin" | "signup" | "reset";

type AuthScreenProps = {
  isBusy: boolean;
  error: string | null;
  notice: string | null;
  verificationHint?: string | null;
  firebaseConfigured: boolean;
  onGoogleSignIn: () => void;
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (email: string, password: string) => Promise<void>;
  onResetPassword: (email: string) => Promise<void>;
  onResendVerification: (email: string, password: string) => Promise<void>;
};

const GoogleIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.4c-.2 1.2-1.4 3.6-5.4 3.6-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.8 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.4 14.7 2.5 12 2.5 6.9 2.5 2.8 6.6 2.8 11.7s4.1 9.2 9.2 9.2c5.3 0 8.8-3.7 8.8-9 0-.6-.1-1.1-.2-1.7H12z"
    />
    <path fill="#34A853" d="M2.8 16.5l3-2.3c.8 1.8 2.6 3.1 4.9 3.1 3 0 4.8-2 5.4-3.6h4.2v2.7c-1.8 2.8-4.8 4.5-8.3 4.5-3.6 0-6.8-2-8.3-4.4z" />
    <path fill="#4A90E2" d="M20.8 11.7c0-.6-.1-1.1-.2-1.7H12v3.9h5.4c-.2 1.2-.9 2.2-1.8 2.8l2.9 2.2c1.7-1.6 2.3-3.9 2.3-7.2z" />
    <path fill="#FBBC05" d="M2.8 7.1c-.6 1.3-.9 2.8-.9 4.6s.3 3.3.9 4.6l3-2.3c-.2-.6-.3-1.2-.3-2.3s.1-1.8.3-2.3l-3-2.3z" />
  </svg>
);

const AuthScreen: React.FC<AuthScreenProps> = ({
  isBusy,
  error,
  notice,
  verificationHint,
  firebaseConfigured,
  onGoogleSignIn,
  onEmailSignIn,
  onEmailSignUp,
  onResetPassword,
  onResendVerification,
}) => {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const modeLabel = useMemo(() => {
    if (mode === "signup") return "Create your account";
    if (mode === "reset") return "Reset your password";
    return "Welcome back";
  }, [mode]);

  const submitLabel = useMemo(() => {
    if (mode === "signup") return "Create account";
    if (mode === "reset") return "Send reset email";
    return "Sign in";
  }, [mode]);

  const disabled = isBusy || !firebaseConfigured;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setLocalError("Email is required.");
      return;
    }

    if (mode === "reset") {
      await onResetPassword(normalizedEmail);
      return;
    }

    if (!password.trim()) {
      setLocalError("Password is required.");
      return;
    }

    if (mode === "signup") {
      if (password.length < 6) {
        setLocalError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setLocalError("Passwords do not match.");
        return;
      }
      await onEmailSignUp(normalizedEmail, password);
      return;
    }

    await onEmailSignIn(normalizedEmail, password);
  };

  const tabButtonClass = (tab: AuthMode) =>
    `px-4 max-[360px]:px-2 flex-1 h-10 max-[360px]:h-9 rounded-xl text-xs max-[360px]:text-[10px] font-bold tracking-wide max-[360px]:tracking-normal transition ${
      mode === tab
        ? "bg-slate-900 text-white shadow-[0_12px_24px_-14px_rgba(15,23,42,0.85)]"
        : "text-slate-600 hover:text-slate-900"
    }`;

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_15%,rgba(20,184,166,0.2),transparent_38%),radial-gradient(circle_at_95%_0%,rgba(14,165,233,0.16),transparent_40%),linear-gradient(165deg,#f8fafc_0%,#e2e8f0_45%,#f1f5f9_100%)]" />

      <div className="relative z-10 min-h-screen flex items-center justify-center p-5 max-[360px]:p-2.5 md:p-8">
        <div className="w-full max-w-6xl rounded-[2.2rem] max-[360px]:rounded-2xl border border-slate-300/70 bg-white/90 backdrop-blur-xl overflow-hidden shadow-[0_45px_110px_-50px_rgba(15,23,42,0.8)]">
          <div className="grid lg:grid-cols-[1.15fr,1fr]">
            <section className="relative p-7 max-[360px]:p-4 md:p-12 bg-slate-950 text-white">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_12%,rgba(45,212,191,0.22),transparent_40%),radial-gradient(circle_at_86%_85%,rgba(14,165,233,0.2),transparent_45%)]" />
              <div className="relative z-10 space-y-8 max-[360px]:space-y-5">
                <button
                  type="button"
                  onClick={() => {
                    setMode("signin");
                    setLocalError(null);
                  }}
                  className="group inline-flex items-center gap-3.5 max-[360px]:gap-2.5"
                  title="Return to sign in"
                  aria-label="Return to sign in"
                >
                  <img
                    src={scribeAiLogo}
                    alt="ScribeAI"
                    className="h-12 max-[360px]:h-9 md:h-[3.6rem] w-auto object-contain transition-transform group-hover:scale-[1.02]"
                  />
                  <span className="font-tech-display text-base max-[360px]:text-sm md:text-lg font-black tracking-[0.02em] text-cyan-50">
                    ScribeAI
                  </span>
                </button>
                <div className="space-y-4 font-tech-display max-w-[34rem]">
                  <h1 className="text-3xl max-[360px]:text-[2rem] md:text-[2.8rem] font-extrabold leading-[1.06] tracking-tight">
                    Capture the full meeting, not just one side.
                  </h1>
                  <p className="text-cyan-50/80 text-base max-[360px]:text-sm max-w-md leading-relaxed font-medium">
                    ScribeAI records mic + meeting audio, runs speaker-aware transcription, and returns structured summaries with actions and decisions.
                  </p>
                </div>
                <div className="grid grid-cols-2 max-[360px]:grid-cols-1 gap-3 text-[11px] font-semibold">
                  <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                    <p className="text-cyan-200 uppercase tracking-[0.22em] text-[10px] font-bold">Dual capture</p>
                    <p className="mt-1 text-slate-100">Mic and remote speaker channels are validated before recording.</p>
                  </div>
                  <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                    <p className="text-cyan-200 uppercase tracking-[0.22em] text-[10px] font-bold">Session recovery</p>
                    <p className="mt-1 text-slate-100">Interrupted sessions can be restored from autosaved chunks.</p>
                  </div>
                  <div className="rounded-2xl border border-white/15 bg-white/5 p-4 col-span-2 max-[360px]:col-span-1">
                    <p className="text-cyan-200 uppercase tracking-[0.22em] text-[10px] font-bold">Local-first security</p>
                    <p className="mt-1 text-slate-100">Audio stays local by default; you choose when to sync or export.</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="p-7 max-[360px]:p-4 md:p-12">
              <div className="space-y-6 max-[360px]:space-y-4">
                <div className="inline-flex max-[360px]:w-full rounded-2xl bg-slate-100 p-1">
                  <button type="button" className={tabButtonClass("signin")} onClick={() => setMode("signin")} disabled={isBusy}>
                    Sign in
                  </button>
                  <button type="button" className={tabButtonClass("signup")} onClick={() => setMode("signup")} disabled={isBusy}>
                    Create account
                  </button>
                  <button type="button" className={tabButtonClass("reset")} onClick={() => setMode("reset")} disabled={isBusy}>
                    Reset
                  </button>
                </div>

                <div className="space-y-1">
                  <h2 className="text-2xl max-[360px]:text-xl md:text-3xl font-black tracking-tight text-slate-900">{modeLabel}</h2>
                  <p className="text-slate-500 text-sm font-semibold">
                    {mode === "reset"
                      ? "Enter your email and we'll send a reset link."
                      : "Use email/password or continue with Google."}
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] uppercase tracking-[0.24em] font-bold text-slate-500">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="w-full h-12 px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold outline-none focus:border-sky-500"
                      disabled={disabled}
                    />
                  </div>

                  {mode !== "reset" && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] uppercase tracking-[0.24em] font-bold text-slate-500">Password</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full h-12 px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold outline-none focus:border-sky-500"
                        disabled={disabled}
                      />
                    </div>
                  )}

                  {mode === "signup" && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] uppercase tracking-[0.24em] font-bold text-slate-500">Confirm password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat password"
                        className="w-full h-12 px-4 rounded-xl border border-slate-300 bg-white text-sm font-semibold outline-none focus:border-sky-500"
                        disabled={disabled}
                      />
                    </div>
                  )}

                  {mode === "signin" && (
                    <button
                      type="button"
                      onClick={() => setMode("reset")}
                      className="text-[12px] font-bold text-sky-700 hover:text-sky-800"
                      disabled={isBusy}
                    >
                      Forgot password?
                    </button>
                  )}

                  {mode === "signin" && verificationHint && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-700">Email verification required</p>
                      <p className="text-xs font-semibold text-amber-800">{verificationHint}</p>
                      <button
                        type="button"
                        disabled={disabled || !email.trim() || !password.trim()}
                        onClick={async () => {
                          setLocalError(null);
                          try {
                            await onEmailSignIn(email.trim(), password);
                          } catch (err) {
                            setLocalError(err instanceof Error ? err.message : "Could not continue.");
                          }
                        }}
                        className={`h-10 px-4 rounded-xl text-[11px] font-black uppercase tracking-[0.14em] ${
                          disabled || !email.trim() || !password.trim()
                            ? "bg-amber-200 text-amber-600 cursor-not-allowed"
                            : "bg-amber-500 text-white hover:bg-amber-600"
                        }`}
                      >
                        I've verified - continue
                      </button>
                      <button
                        type="button"
                        disabled={disabled || !email.trim() || !password.trim()}
                        onClick={async () => {
                          setLocalError(null);
                          try {
                            await onResendVerification(email.trim(), password);
                          } catch (err) {
                            setLocalError(err instanceof Error ? err.message : "Could not resend verification.");
                          }
                        }}
                        className={`h-10 px-4 rounded-xl text-[11px] font-black uppercase tracking-[0.14em] border ${
                          disabled || !email.trim() || !password.trim()
                            ? "border-amber-300 text-amber-400 bg-amber-100/50 cursor-not-allowed"
                            : "border-amber-500 text-amber-700 bg-white hover:bg-amber-100"
                        }`}
                      >
                        Re-send verification
                      </button>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={disabled}
                    className={`w-full h-12 rounded-xl text-sm font-black tracking-wide transition ${
                      disabled
                        ? "bg-slate-300 text-slate-500 cursor-not-allowed"
                        : "bg-slate-900 text-white hover:bg-slate-800"
                    }`}
                  >
                    {isBusy ? "Please wait..." : submitLabel}
                  </button>
                </form>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-300" />
                  </div>
                  <div className="relative flex justify-center text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
                    <span className="px-3 bg-white">or</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={onGoogleSignIn}
                  className={`w-full h-12 rounded-xl border text-sm font-bold tracking-wide flex items-center justify-center gap-3 transition ${
                    disabled
                      ? "bg-slate-200 border-slate-300 text-slate-500 cursor-not-allowed"
                      : "bg-white text-slate-900 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <GoogleIcon />
                  Continue with Google
                </button>

                {!firebaseConfigured && (
                  <p className="text-amber-700 text-xs font-semibold">
                    Firebase env variables are missing in `frontend/.env.local`.
                  </p>
                )}
                {localError && <p className="text-rose-700 text-xs font-semibold">{localError}</p>}
                {error && <p className="text-rose-700 text-xs font-semibold">{error}</p>}
                {notice && <p className="text-emerald-700 text-xs font-semibold">{notice}</p>}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
