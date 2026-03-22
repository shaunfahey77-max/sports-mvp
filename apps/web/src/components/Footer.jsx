import React from "react";

export default function Footer() {
  return (
    <footer style={styles.footer}>
      <div style={styles.inner}>
        
        {/* LEFT — LOGO + BRAND */}
        <div style={styles.left}>
          <img
            src="/sports-mvp-logo.png"
            alt="Sports MVP"
            style={styles.logo}
          />
          <div style={styles.brandBlock}>
            <div style={styles.brand}>Sports MVP</div>
            <div style={styles.sub}>NBA • NHL • NCAAM Betting Intelligence</div>
          </div>
        </div>

        {/* RIGHT — LINKS */}
        <div style={styles.right}>
          <a style={styles.link}>Privacy Policy</a>
          <a style={styles.link}>Terms & Conditions</a>
          <a style={styles.link}>Responsible Gambling</a>
        </div>
      </div>

      {/* LEGAL */}
      <div style={styles.legal}>
        Sports MVP provides betting analytics and informational content only. 
        We do not accept wagers or operate a sportsbook. 

        <br /><br />

        21+ where applicable. Users are responsible for complying with all local laws and regulations. 
        This platform does not guarantee outcomes or profits.

        <br /><br />

        Please gamble responsibly. If you or someone you know has a gambling problem, 
        call <strong>1-800-MY-RESET</strong>, text <strong>800GAM</strong>, or visit the 
        National Problem Gambling Helpline.

        <br /><br />

        © {new Date().getFullYear()} Sports MVP. All rights reserved.
      </div>
    </footer>
  );
}

const styles = {
  footer: {
    marginTop: 36,
    padding: "28px 20px 20px",
    borderTop: "1px solid rgba(59,130,246,0.15)",
    background: "linear-gradient(180deg, rgba(2,6,23,0.6), rgba(2,6,23,0.95))",
  },
  inner: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 14,
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    width: 42,
    height: 42,
    objectFit: "contain",
    borderRadius: 10,
  },
  brandBlock: {
    display: "flex",
    flexDirection: "column",
  },
  brand: {
    fontSize: 14,
    fontWeight: 800,
    color: "#f8fafc",
    letterSpacing: "0.05em",
  },
  sub: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 2,
  },
  right: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
  },
  link: {
    fontSize: 12,
    color: "#cbd5f5",
    cursor: "pointer",
    opacity: 0.85,
  },
  legal: {
    maxWidth: 900,
    margin: "18px auto 0",
    fontSize: 11,
    lineHeight: 1.45,
    color: "#64748b",
    textAlign: "center",
  },
};
