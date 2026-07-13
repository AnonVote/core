import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { loginOrg } from "../api/client";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import {
  LockClosedIcon,
  EyeOpenIcon,
  EyeClosedIcon,
  HomeIcon,
  CheckIcon,
  InfoCircledIcon,
  ExclamationTriangleIcon,
} from "@radix-ui/react-icons";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const reason = query.get("reason");
  const successMsg = (location.state as any)?.success;
  const [form, setForm] = useState({ name: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.password) {
      setError("Please fill in all fields");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await loginOrg(form);
      navigate("/dashboard");
    } catch (err: any) {
      console.error("Login error:", err);
      const msg =
        err.response?.data?.message ||
        err.message ||
        "Invalid credentials. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-content">
      <Navbar />
      <div className="w-full max-w-md">
        <div className="card p-8">
          <div className="section-eyebrow">Sign In</div>
          <h1 className="text-3xl font-space-grotesk font-bold mb-2">
            Welcome Back
          </h1>
          <p className="text-sm mb-6" style={{ color: "var(--ink-muted)" }}>
            Sign in to manage your ballots and track your votes.
          </p>

          {/* Trust Chips */}
          <div className="flex flex-wrap gap-2 mb-6">
            <span className="chip-mono">
              <LockClosedIcon className="w-3 h-3 text-green-500" />
              AES-256-GCM
            </span>
            <span className="chip-mono">
              <EyeOpenIcon className="w-3 h-3 text-blue-500" />
              SHA-256 hashed
            </span>
            <span className="chip-mono">
              <ExclamationTriangleIcon className="w-3 h-3 text-indigo-500" />
              Stellar chain
            </span>
          </div>

          {successMsg && (
            <div
              className="message message-success mb-6"
              role="status"
              aria-live="polite"
            >
              <span className="message-icon" aria-hidden="true">
                <CheckIcon width="16" height="16" />
              </span>
              <span>{successMsg}</span>
            </div>
          )}
          {reason === "session_expired" && (
            <div
              className="message message-warning mb-6"
              role="alert"
              aria-live="polite"
            >
              <span className="message-icon" aria-hidden="true">
                <InfoCircledIcon width="16" height="16" />
              </span>
              <span>Your session has expired. Please sign in again.</span>
            </div>
          )}
          {error && (
            <div
              className="message message-error"
              role="alert"
              aria-live="assertive"
            >
              <span className="message-icon" aria-hidden="true">
                <InfoCircledIcon width="16" height="16" />
              </span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="block text-sm font-medium mb-1 text-[var(--ink-secondary)]">
                Organization Name
              </label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <HomeIcon />
                </span>
                <input
                  type="text"
                  id="login-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="input-field has-icon"
                  placeholder="Your organization name"
                  aria-required="true"
                  aria-label="Organization name"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 text-[var(--ink-secondary)]">
                Password
              </label>
              <div className="mb-3 input-wrapper">
                <span className="input-icon">
                  <LockClosedIcon />
                </span>
                <input
                  type={showPassword ? "text" : "password"}
                  id="login-password"
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  className="input-field has-icon"
                  placeholder="Your password"
                  aria-required="true"
                  aria-label="Password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                >
                  {showPassword ? (
                    <EyeClosedIcon width="20" height="20" />
                  ) : (
                    <EyeOpenIcon width="20" height="20" />
                  )}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary"
            >
              {loading ? (
                <span className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          <p className="text-center text-gray-600 dark:text-gray-400 text-sm mt-6">
            Don't have an account?{" "}
            <Link
              to="/register"
              className="font-medium underline hover:opacity-70 transition"
              style={{ color: "var(--ink-secondary)" }}
            >
              Sign up for free
            </Link>
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}
