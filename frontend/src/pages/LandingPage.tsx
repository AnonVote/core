import { useState } from "react";
import { Link } from "react-router-dom";
import Footer from "../components/Footer";

const faqs = [
  {
    q: "Do voters need to create an account?",
    a: "No. Voters only need the link shared by the admin and their identifier (email or employee ID). No registration, no password.",
  },
  {
    q: "How is voter privacy guaranteed?",
    a: "Voter identifiers are SHA-256 hashed before storage — the original is never saved. Tokens are cryptographically random and unlinked from identity. There is no database join between who voted and what they voted.",
  },
  {
    q: "What happens if a voter loses their token?",
    a: "They can return to the token request page and enter their identifier again. If they haven't voted yet, the old token is revoked and a new one issued. If they already voted, no new token is issued.",
  },
  {
    q: "How are results verified?",
    a: "Every event — token issuance, vote cast, result publication — is written to the Stellar blockchain as an immutable record. Anyone can verify the result by checking the Stellar transaction ID on Stellar Expert.",
  },
  {
    q: "Can the admin see how people voted?",
    a: "No. Vote payloads are AES-256-GCM encrypted. The admin can only see aggregate results after tallying — never individual votes or which voter chose what.",
  },
  {
    q: "Is AnonVote free to use?",
    a: "Yes. AnonVote is open source. You can self-host it for free. The only cost is the Stellar testnet (free) or mainnet (tiny XLM fees per transaction).",
  },
];

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div
      style={{
        background: "#0a0a0a",
        color: "#ffffff",
        minHeight: "100vh",
        fontFamily: "var(--font-body)",
        overflowX: "hidden",
      }}
    >
      {/* ── Navbar ── */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 var(--space-10)",
          height: "56px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(10,10,10,0.8)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-bold)",
            fontSize: "var(--text-lg)",
            letterSpacing: "var(--tracking-tight)",
            color: "#ffffff",
          }}
        >
          AnonVote
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-4)",
          }}
        >
          <Link
            to="/login"
            style={{
              color: "rgba(255,255,255,0.6)",
              textDecoration: "none",
              fontSize: "var(--text-sm)",
              fontFamily: "var(--font-body)",
              transition: "color var(--transition-fast)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
            onMouseLeave={(e) =>
              (e.currentTarget.style.color = "rgba(255,255,255,0.6)")
            }
          >
            Sign in
          </Link>
          <Link
            to="/register"
            style={{
              background: "var(--brand-primary)",
              color: "white",
              textDecoration: "none",
              fontSize: "var(--text-sm)",
              fontFamily: "var(--font-display)",
              fontWeight: "var(--weight-semibold)",
              padding: "8px 18px",
              borderRadius: "var(--radius-md)",
              transition: "opacity var(--transition-fast)",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "var(--space-16) var(--space-6)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Eyebrow */}
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-xs)",
            letterSpacing: "var(--tracking-widest)",
            textTransform: "uppercase",
            color: "var(--brand-primary)",
            marginBottom: "var(--space-6)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
          }}
        >
          <span
            style={{
              width: "24px",
              height: "1px",
              background: "var(--brand-primary)",
              opacity: 0.5,
              display: "inline-block",
            }}
          />
          Built on Stellar
          <span
            style={{
              width: "24px",
              height: "1px",
              background: "var(--brand-primary)",
              opacity: 0.5,
              display: "inline-block",
            }}
          />
        </div>

        {/* Headline */}
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(40px, 7vw, 80px)",
            fontWeight: "var(--weight-bold)",
            letterSpacing: "var(--tracking-tighter)",
            lineHeight: 1.05,
            color: "#ffffff",
            maxWidth: "800px",
            marginBottom: "var(--space-6)",
          }}
        >
          Private voting
          <br />
          <span style={{ color: "var(--brand-primary)" }}>infrastructure</span>
          <br />
          for organizations.
        </h1>

        {/* Sub */}
        <p
          style={{
            fontSize: "var(--text-md)",
            color: "rgba(255,255,255,0.5)",
            maxWidth: "500px",
            lineHeight: 1.6,
            marginBottom: "var(--space-10)",
          }}
        >
          Anonymous tokens. Encrypted votes. Immutable results on the
          blockchain. No identity exposed at any layer.
        </p>

        {/* CTAs */}
        <div
          style={{
            display: "flex",
            gap: "var(--space-4)",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <Link
            to="/register"
            style={{
              background: "var(--brand-primary)",
              color: "white",
              textDecoration: "none",
              fontFamily: "var(--font-display)",
              fontWeight: "var(--weight-bold)",
              fontSize: "var(--text-base)",
              padding: "14px 32px",
              borderRadius: "var(--radius-md)",
              transition:
                "transform var(--transition-base), box-shadow var(--transition-base)",
              display: "inline-block",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow =
                "0 8px 24px rgba(28,126,214,0.35)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
            }}
          >
            Register your organization
          </Link>
          <Link
            to="/login"
            style={{
              background: "transparent",
              color: "rgba(255,255,255,0.7)",
              textDecoration: "none",
              fontFamily: "var(--font-display)",
              fontWeight: "var(--weight-semibold)",
              fontSize: "var(--text-base)",
              padding: "14px 32px",
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(255,255,255,0.12)",
              transition:
                "border-color var(--transition-base), color var(--transition-base)",
              display: "inline-block",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)";
              e.currentTarget.style.color = "#ffffff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = "rgba(255,255,255,0.7)";
            }}
          >
            Sign in →
          </Link>
        </div>
      </section>

      {/* ── Trust strip ── */}
      <section
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "var(--space-6) var(--space-6)",
          display: "flex",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: "var(--space-8)",
        }}
      >
        {[
          "One person, one vote",
          "Votes stay private",
          "Results verifiable",
          "Tamper-proof record",
        ].map((label) => (
          <span
            key={label}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              letterSpacing: "var(--tracking-widest)",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.35)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
            }}
          >
            <span
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: "var(--brand-primary)",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            {label}
          </span>
        ))}
      </section>

      {/* ── How it works ── */}
      <section
        style={{
          maxWidth: "960px",
          margin: "0 auto",
          padding: "var(--space-20) var(--space-6)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "var(--space-16)" }}>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-xs)",
              letterSpacing: "var(--tracking-widest)",
              textTransform: "uppercase",
              color: "var(--brand-primary)",
              marginBottom: "var(--space-4)",
            }}
          >
            How it works
          </p>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(28px, 4vw, 44px)",
              fontWeight: "var(--weight-bold)",
              letterSpacing: "var(--tracking-tight)",
              color: "#ffffff",
            }}
          >
            From ballot to verified result
          </h2>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: "var(--space-6)",
          }}
        >
          {[
            {
              n: "01",
              title: "Create a ballot",
              desc: "Define the topic, options, deadline, and upload your eligible voter list as a CSV.",
            },
            {
              n: "02",
              title: "Voters get tokens",
              desc: "Each eligible voter enters their identifier and receives a one-time anonymous token.",
            },
            {
              n: "03",
              title: "Cast encrypted votes",
              desc: "Voters use their token to submit an AES-256-GCM encrypted vote. Token is marked used.",
            },
            {
              n: "04",
              title: "Verified results",
              desc: "Results are tallied and published with a Stellar transaction ID anyone can verify.",
            },
          ].map((step) => (
            <div
              key={step.n}
              style={{
                padding: "var(--space-6)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "var(--radius-lg)",
                background: "rgba(255,255,255,0.02)",
                transition:
                  "border-color var(--transition-base), background var(--transition-base)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "rgba(28,126,214,0.3)";
                (e.currentTarget as HTMLDivElement).style.background =
                  "rgba(28,126,214,0.04)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.borderColor =
                  "rgba(255,255,255,0.07)";
                (e.currentTarget as HTMLDivElement).style.background =
                  "rgba(255,255,255,0.02)";
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-xs)",
                  color: "var(--brand-primary)",
                  letterSpacing: "var(--tracking-wide)",
                  display: "block",
                  marginBottom: "var(--space-4)",
                }}
              >
                {step.n}
              </span>
              <h3
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--text-md)",
                  fontWeight: "var(--weight-semibold)",
                  color: "#ffffff",
                  marginBottom: "var(--space-3)",
                }}
              >
                {step.title}
              </h3>
              <p
                style={{
                  fontSize: "var(--text-sm)",
                  color: "rgba(255,255,255,0.45)",
                  lineHeight: 1.6,
                }}
              >
                {step.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "var(--space-20) var(--space-6)",
        }}
      >
        <div style={{ maxWidth: "960px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-16)" }}>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                letterSpacing: "var(--tracking-widest)",
                textTransform: "uppercase",
                color: "var(--brand-primary)",
                marginBottom: "var(--space-4)",
              }}
            >
              Who it's for
            </p>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(28px, 4vw, 44px)",
                fontWeight: "var(--weight-bold)",
                letterSpacing: "var(--tracking-tight)",
                color: "#ffffff",
              }}
            >
              Built for any organization
            </h2>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "var(--space-6)",
            }}
          >
            {[
              {
                icon: "🎓",
                sector: "Education",
                uses: [
                  "Student elections",
                  "Faculty votes",
                  "Course feedback",
                  "Committee decisions",
                ],
              },
              {
                icon: "🏢",
                sector: "Corporate",
                uses: [
                  "Policy votes",
                  "Leadership surveys",
                  "Board approvals",
                  "Team decisions",
                ],
              },
              {
                icon: "🌐",
                sector: "Communities",
                uses: [
                  "Governance decisions",
                  "Membership votes",
                  "Program approvals",
                  "Budget allocation",
                ],
              },
            ].map((item) => (
              <div
                key={item.sector}
                style={{
                  padding: "var(--space-8)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: "var(--radius-lg)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <div
                  style={{ fontSize: "2rem", marginBottom: "var(--space-4)" }}
                >
                  {item.icon}
                </div>
                <h3
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "var(--text-lg)",
                    fontWeight: "var(--weight-semibold)",
                    color: "#ffffff",
                    marginBottom: "var(--space-4)",
                  }}
                >
                  {item.sector}
                </h3>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)",
                  }}
                >
                  {item.uses.map((use) => (
                    <li
                      key={use}
                      style={{
                        fontSize: "var(--text-sm)",
                        color: "rgba(255,255,255,0.45)",
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-2)",
                      }}
                    >
                      <span
                        style={{
                          width: "4px",
                          height: "4px",
                          borderRadius: "50%",
                          background: "rgba(255,255,255,0.2)",
                          flexShrink: 0,
                        }}
                      />
                      {use}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "var(--space-20) var(--space-6)",
        }}
      >
        <div style={{ maxWidth: "680px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-16)" }}>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                letterSpacing: "var(--tracking-widest)",
                textTransform: "uppercase",
                color: "var(--brand-primary)",
                marginBottom: "var(--space-4)",
              }}
            >
              FAQ
            </p>
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "clamp(28px, 4vw, 44px)",
                fontWeight: "var(--weight-bold)",
                letterSpacing: "var(--tracking-tight)",
                color: "#ffffff",
              }}
            >
              Common questions
            </h2>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            {faqs.map((faq, i) => (
              <div
                key={i}
                style={{
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: "var(--radius-md)",
                  overflow: "hidden",
                  background:
                    openFaq === i
                      ? "rgba(28,126,214,0.04)"
                      : "rgba(255,255,255,0.02)",
                  transition: "background var(--transition-base)",
                }}
              >
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "var(--space-5) var(--space-6)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    gap: "var(--space-4)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "var(--text-base)",
                      fontWeight: "var(--weight-semibold)",
                      color: "#ffffff",
                    }}
                  >
                    {faq.q}
                  </span>
                  <span
                    style={{
                      color: "var(--brand-primary)",
                      fontSize: "18px",
                      flexShrink: 0,
                      transition: "transform var(--transition-base)",
                      transform:
                        openFaq === i ? "rotate(45deg)" : "rotate(0deg)",
                      display: "inline-block",
                    }}
                  >
                    +
                  </span>
                </button>
                {openFaq === i && (
                  <div
                    style={{
                      padding: "0 var(--space-6) var(--space-5)",
                      fontSize: "var(--text-sm)",
                      color: "rgba(255,255,255,0.5)",
                      lineHeight: 1.7,
                    }}
                  >
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <section
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          padding: "var(--space-20) var(--space-6)",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(28px, 4vw, 48px)",
            fontWeight: "var(--weight-bold)",
            letterSpacing: "var(--tracking-tight)",
            color: "#ffffff",
            marginBottom: "var(--space-4)",
          }}
        >
          Ready to run your first ballot?
        </h2>
        <p
          style={{
            fontSize: "var(--text-base)",
            color: "rgba(255,255,255,0.4)",
            marginBottom: "var(--space-8)",
          }}
        >
          Free to use. Open source. No credit card required.
        </p>
        <Link
          to="/register"
          style={{
            background: "var(--brand-primary)",
            color: "white",
            textDecoration: "none",
            fontFamily: "var(--font-display)",
            fontWeight: "var(--weight-bold)",
            fontSize: "var(--text-base)",
            padding: "16px 40px",
            borderRadius: "var(--radius-md)",
            display: "inline-block",
            transition:
              "transform var(--transition-base), box-shadow var(--transition-base)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-2px)";
            e.currentTarget.style.boxShadow =
              "0 8px 24px rgba(28,126,214,0.35)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          Register your organization →
        </Link>
      </section>

      {/* ── Footer — static override ── */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <style>{`.footer { position: static !important; background: transparent !important; border-top: none !important; }`}</style>
        <Footer />
      </div>
    </div>
  );
}
