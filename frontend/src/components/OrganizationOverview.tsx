import React, { useEffect, useState } from "react";
import { InfoCircledIcon, ExternalLinkIcon } from "@radix-ui/react-icons";

interface OrganizationOverviewProps {
  organizationName?: string;
}

export default function OrganizationOverview({
  organizationName = "AnonVote",
}: OrganizationOverviewProps) {
  const [readmeContent, setReadmeContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch the .github/README.md from GitHub
    const fetchReadme = async () => {
      try {
        const response = await fetch(
          "https://raw.githubusercontent.com/AnonVote/.github/main/README.md",
        );
        if (response.ok) {
          const content = await response.text();
          setReadmeContent(content);
        }
      } catch (error) {
        console.error("Failed to fetch README:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchReadme();
  }, []);

  const parseReadmeContent = (markdown: string) => {
    const lines = markdown.split("\n");
    const parsed: { type: string; content: string }[] = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith("# ")) {
        parsed.push({ type: "h1", content: trimmed.substring(2) });
      } else if (trimmed.startsWith("## ")) {
        parsed.push({ type: "h2", content: trimmed.substring(3) });
      } else if (trimmed.startsWith("- ")) {
        parsed.push({ type: "li", content: trimmed.substring(2) });
      } else if (!trimmed.startsWith("| ")) {
        parsed.push({ type: "p", content: trimmed });
      }
    });

    return parsed;
  };

  const parsedContent = parseReadmeContent(readmeContent);

  if (loading) {
    return (
      <div className="card p-6 mb-8">
        <div className="skeleton" style={{ height: "200px" }} />
      </div>
    );
  }

  return (
    <div
      className="card p-6 mb-8"
      style={{ borderLeft: "4px solid var(--brand-primary)" }}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex-shrink-0"
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "var(--radius-lg)",
            background: "var(--brand-primary-pale)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--brand-primary)",
          }}
        >
          <InfoCircledIcon width="24" height="24" />
        </div>

        <div style={{ flex: 1 }}>
          {parsedContent.length > 0 ? (
            <>
              {parsedContent.map((item, idx) => {
                switch (item.type) {
                  case "h1":
                    return (
                      <h2
                        key={idx}
                        className="font-display font-bold mb-2"
                        style={{
                          fontSize: "var(--text-xl)",
                          color: "var(--ink-primary)",
                        }}
                      >
                        {item.content}
                      </h2>
                    );
                  case "h2":
                    return (
                      <h3
                        key={idx}
                        className="font-display font-semibold mt-3 mb-2"
                        style={{
                          fontSize: "var(--text-lg)",
                          color: "var(--ink-primary)",
                        }}
                      >
                        {item.content}
                      </h3>
                    );
                  case "p":
                    return (
                      <p
                        key={idx}
                        style={{
                          color: "var(--ink-secondary)",
                          fontSize: "var(--text-sm)",
                          lineHeight: "1.6",
                          marginBottom: "var(--space-2)",
                        }}
                      >
                        {item.content}
                      </p>
                    );
                  case "li":
                    return (
                      <div
                        key={idx}
                        style={{
                          color: "var(--ink-secondary)",
                          fontSize: "var(--text-sm)",
                          lineHeight: "1.6",
                          marginBottom: "var(--space-1)",
                          marginLeft: "var(--space-3)",
                        }}
                      >
                        • {item.content}
                      </div>
                    );
                  default:
                    return null;
                }
              })}

              <div
                style={{
                  marginTop: "var(--space-4)",
                  paddingTop: "var(--space-4)",
                  borderTop: "1px solid var(--border-soft)",
                  display: "flex",
                  gap: "var(--space-3)",
                  flexWrap: "wrap",
                }}
              >
                <a
                  href="https://github.com/AnonVote"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-dark"
                  style={{
                    fontSize: "var(--text-sm)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                  }}
                >
                  GitHub Repository
                  <ExternalLinkIcon width="14" height="14" />
                </a>
                <a
                  href="https://github.com/AnonVote/protocol"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-dark"
                  style={{
                    fontSize: "var(--text-sm)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                  }}
                >
                  Protocol & Whitepaper
                  <ExternalLinkIcon width="14" height="14" />
                </a>
              </div>
            </>
          ) : (
            <>
              <h2
                className="font-display font-bold mb-2"
                style={{
                  fontSize: "var(--text-xl)",
                  color: "var(--ink-primary)",
                }}
              >
                {organizationName}
              </h2>

              <p
                style={{
                  color: "var(--ink-secondary)",
                  fontSize: "var(--text-sm)",
                  lineHeight: "1.6",
                  marginBottom: "var(--space-3)",
                }}
              >
                Private decision infrastructure on Stellar. AnonVote is a
                privacy-preserving voting platform that separates voter identity
                from ballots at every layer — cryptographically, not by policy.
                Results are anchored to the Stellar blockchain so anyone can
                verify outcomes without trusting AnonVote's servers.
              </p>

              <div
                style={{
                  marginTop: "var(--space-4)",
                  paddingTop: "var(--space-4)",
                  borderTop: "1px solid var(--border-soft)",
                  display: "flex",
                  gap: "var(--space-3)",
                  flexWrap: "wrap",
                }}
              >
                <a
                  href="https://github.com/AnonVote"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-dark"
                  style={{
                    fontSize: "var(--text-sm)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-1)",
                  }}
                >
                  GitHub Repository
                  <ExternalLinkIcon width="14" height="14" />
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
