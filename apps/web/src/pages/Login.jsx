import React, { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useSubscriber } from "../auth/SubscriberContext";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, isActiveSubscriber } = useSubscriber();

  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const target = useMemo(() => {
    return location?.state?.from || "/app";
  }, [location]);

  const onSubmit = (e) => {
    e.preventDefault();
    const normalized = String(email || "").trim().toLowerCase();

    if (!normalized || !normalized.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    setError("");
    login({ email: normalized });
    navigate(target, { replace: true });
  };

  if (isAuthenticated && isActiveSubscriber) {
    navigate(target, { replace: true });
    return null;
  }

  const styles = {
    page: {
      minHeight: "100vh",
      background: "radial-gradient(circle at top, rgba(37,99,235,0.18), transparent 32%), linear-gradient(180deg, #020617 0%, #061224 100%)",
      padding: "48px 20px",
    },
    shell: {
      maxWidth: 560,
      margin: "0 auto",
      background: "rgba(9,15,28,0.86)",
      border: "1px solid rgba(148,163,184,0.14)",
      borderRadius: 28,
      boxShadow: "0 24px 60px rgba(0,0,0,0.32)",
      padding: 32,
      color: "#e2e8f0",
    },
    eyebrow: {
      color: "#93c5fd",
      fontSize: 12,
      fontWeight: 800,
      textTransform: "uppercase",
      letterSpacing: "0.16em",
      marginBottom: 12,
    },
    title: {
      margin: 0,
      fontSize: 42,
      lineHeight: 1,
      fontWeight: 900,
      color: "#f8fafc",
    },
    text: {
      color: "#94a3b8",
      fontSize: 16,
      lineHeight: 1.7,
      marginTop: 14,
      marginBottom: 24,
    },
    label: {
      display: "block",
      marginBottom: 8,
      color: "#cbd5e1",
      fontWeight: 700,
      fontSize: 14,
    },
    input: {
      width: "100%",
      boxSizing: "border-box",
      background: "rgba(15,23,42,0.95)",
      border: "1px solid rgba(148,163,184,0.16)",
      borderRadius: 14,
      padding: "14px 16px",
      color: "#f8fafc",
      fontSize: 16,
      outline: "none",
      marginBottom: 16,
    },
    button: {
      width: "100%",
      border: "1px solid rgba(59,130,246,0.36)",
      background: "linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)",
      color: "#f8fafc",
      fontWeight: 800,
      fontSize: 16,
      borderRadius: 14,
      padding: "14px 18px",
      cursor: "pointer",
      boxShadow: "0 12px 28px rgba(37,99,235,0.28)",
    },
    note: {
      marginTop: 16,
      color: "#94a3b8",
      fontSize: 13,
      lineHeight: 1.6,
    },
    error: {
      marginBottom: 12,
      color: "#fda4af",
      fontSize: 14,
      fontWeight: 700,
    },
    back: {
      display: "inline-block",
      marginTop: 18,
      color: "#93c5fd",
      textDecoration: "none",
      fontWeight: 700,
    },
  };

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.eyebrow}>Subscriber Access</div>
        <h1 style={styles.title}>Log in to Sports MVP</h1>
        <div style={styles.text}>
          Access premium picks, Edge Score rankings, performance dashboards, and bankroll tools.
        </div>

        <form onSubmit={onSubmit}>
          <label style={styles.label} htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
          />

          {error ? <div style={styles.error}>{error}</div> : null}

          <button type="submit" style={styles.button}>
            Continue to Premium App
          </button>
        </form>

        <div style={styles.note}>
          This is the subscriber access scaffold. Stripe billing and production auth will be connected next.
        </div>

        <Link to="/" style={styles.back}>← Back to homepage</Link>
      </div>
    </div>
  );
}
