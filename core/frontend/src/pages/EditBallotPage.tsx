import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getBallot, updateBallot, uploadEligibilityList } from "../api/client";
import Navbar from "../components/Navbar";
import { useTheme } from "../context/ThemeContext";
import type { Ballot } from "../types";

export default function EditBallotPage() {
  const { ballotId } = useParams<{ ballotId: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [ballot, setBallot] = useState<Ballot | null>(null);
  const [loadError, setLoadError] = useState("");

  const [topic, setTopic] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [deadline, setDeadline] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [hasVotes, setHasVotes] = useState(false);

  useEffect(() => {
    if (!ballotId) return;
    getBallot(ballotId)
      .then((res) => {
        const b = res.data.data;
        if (b.status === "CLOSED") {
          setLoadError("Closed ballots cannot be edited.");
          return;
        }
        setBallot(b);
        setTopic(b.topic);
        setOptions(b.options.map((o) => o.text));
        // Format deadline for datetime-local input
        const d = new Date(b.deadline);
        const pad = (n: number) => String(n).padStart(2, "0");
        setDeadline(
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
        );
        setHasVotes((b.votesCast ?? 0) > 0);
      })
      .catch(() => setLoadError("Ballot not found or you don't have access."));
  }, [ballotId]);

  const addOption = () => setOptions([...options, ""]);
  const removeOption = (i: number) => {
    if (options.length > 2) setOptions(options.filter((_, idx) => idx !== i));
  };
  const updateOption = (i: number, val: string) =>
    setOptions(options.map((o, idx) => (idx === i ? val : o)));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!topic.trim()) e.topic = "Topic is required";
    if (!hasVotes) {
      if (options.some((o) => !o.trim()))
        e.options = "All options must have text";
      if (options.filter((o) => o.trim()).length < 2)
        e.options = "At least two options are required";
    }
    if (!deadline) e.deadline = "Deadline is required";
    else if (new Date(deadline) <= new Date())
      e.deadline = "Deadline must be in the future";
    if (file && file.size > 10 * 1024 * 1024)
      e.file = "File must be under 10MB";
    return e;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      let eligibilityListId: string | undefined;
      if (file) {
        const eligRes = await uploadEligibilityList(file);
        eligibilityListId = eligRes.data.data.eligibilityListId;
      }

      await updateBallot(ballotId!, {
        topic: topic.trim(),
        deadline: new Date(deadline).toISOString(),
        ...(!hasVotes && {
          options: options.map((o) => o.trim()).filter(Boolean),
        }),
        ...(eligibilityListId && { eligibilityListId }),
      });

      navigate("/dashboard");
    } catch (err: any) {
      setErrors({
        general: err.response?.data?.message || "Failed to update ballot",
      });
    } finally {
      setLoading(false);
    }
  };

  const minDeadline = new Date(Date.now() + 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);

  if (loadError) {
    return (
      <div className="page-wrapper">
        <Navbar />
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            padding: "var(--space-10) 0",
            width: "100%",
          }}
        >
          <div className="card p-8 text-center">
            <p style={{ color: "var(--ink-muted)" }}>{loadError}</p>
            <button
              onClick={() => navigate("/dashboard")}
              className="btn-ghost"
              style={{ marginTop: "var(--space-4)" }}
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ballot) {
    return (
      <div className="page-wrapper">
        <Navbar />
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            padding: "var(--space-10) 0",
            width: "100%",
          }}
        >
          <div className="card p-8 animate-pulse h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrapper">
      <Navbar />
      <div
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "var(--space-10) 0",
          width: "100%",
        }}
      >
        <button
          onClick={() => navigate("/dashboard")}
          style={{
            background: "none",
            border: "none",
            color: "var(--ink-muted)",
            cursor: "pointer",
            fontSize: "var(--text-sm)",
            padding: 0,
            marginBottom: "var(--space-4)",
            fontFamily: "var(--font-body)",
          }}
        >
          ← Back to Dashboard
        </button>

        <div className="text-eyebrow mb-3">Edit Ballot</div>
        <h1
          className="font-space-grotesk font-bold mb-2"
          style={{ fontSize: "var(--text-2xl)", color: "var(--ink-primary)" }}
        >
          Edit Ballot
        </h1>
        <p
          className="mb-8"
          style={{ color: "var(--ink-muted)", fontSize: "var(--text-base)" }}
        >
          Update the topic, deadline, or eligibility list.
          {hasVotes && (
            <span
              style={{
                display: "block",
                marginTop: "var(--space-2)",
                color: "var(--semantic-warning, #d97706)",
                fontSize: "var(--text-sm)",
              }}
            >
              ⚠ Votes have been cast — options and eligibility list are locked.
            </span>
          )}
        </p>

        {errors.general && (
          <div className="message message-error mb-6">
            <span className="message-icon">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
            <span>{errors.general}</span>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          noValidate
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-6)",
          }}
        >
          {/* Topic */}
          <div>
            <label className="form-label">Ballot Topic</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </span>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className={
                  "input-field has-icon " + (errors.topic ? "error" : "")
                }
                placeholder="e.g. Adopt new remote work policy"
              />
            </div>
            {errors.topic && <p className="field-error">{errors.topic}</p>}
          </div>

          {/* Options — locked if votes cast */}
          <div>
            <label className="form-label">
              Options
              {hasVotes && (
                <span
                  style={{
                    marginLeft: "var(--space-2)",
                    fontSize: "var(--text-xs)",
                    color: "var(--ink-muted)",
                    fontWeight: "normal",
                  }}
                >
                  (locked — votes cast)
                </span>
              )}
            </label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
              }}
            >
              {options.map((opt, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: "var(--space-2)",
                    alignItems: "center",
                  }}
                >
                  <div className="input-wrapper" style={{ flex: 1 }}>
                    <span className="input-icon">
                      <svg
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                      </svg>
                    </span>
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      disabled={hasVotes}
                      className="input-field has-icon"
                      placeholder={"Option " + (i + 1)}
                      style={
                        hasVotes ? { opacity: 0.5, cursor: "not-allowed" } : {}
                      }
                    />
                  </div>
                  {!hasVotes && options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--ink-muted)",
                        cursor: "pointer",
                        padding: "var(--space-2)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "var(--text-base)",
                        transition: "color var(--transition-fast)",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.color = "var(--semantic-error)")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.color = "var(--ink-muted)")
                      }
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {errors.options && <p className="field-error">{errors.options}</p>}
            {!hasVotes && (
              <button
                type="button"
                onClick={addOption}
                style={{
                  marginTop: "var(--space-3)",
                  background: "none",
                  border: "none",
                  color: "var(--brand-primary)",
                  cursor: "pointer",
                  fontSize: "var(--text-sm)",
                  fontWeight: "var(--weight-medium)",
                  fontFamily: "var(--font-body)",
                  padding: 0,
                }}
              >
                + Add option
              </button>
            )}
          </div>

          {/* Deadline */}
          <div>
            <label className="form-label">Voting Deadline</label>
            <div className="input-wrapper">
              <span className="input-icon" style={{ pointerEvents: "none" }}>
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </span>
              <input
                type="datetime-local"
                value={deadline}
                min={minDeadline}
                onChange={(e) => setDeadline(e.target.value)}
                className={
                  "input-field has-icon " + (errors.deadline ? "error" : "")
                }
                style={{
                  cursor: "pointer",
                  colorScheme: theme === "dark" ? "dark" : "light",
                }}
                onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              />
            </div>
            {errors.deadline && (
              <p className="field-error">{errors.deadline}</p>
            )}
          </div>

          {/* Eligibility list — locked if votes cast */}
          {!hasVotes && (
            <div>
              <label className="form-label">Replace Eligible Voters List</label>
              <p
                style={{
                  color: "var(--ink-muted)",
                  fontSize: "var(--text-sm)",
                  marginBottom: "var(--space-2)",
                }}
              >
                Upload a new CSV to replace the current list. Leave empty to
                keep the existing list.
              </p>
              <div className="upload-area">
                <input
                  type="file"
                  accept=".csv,.txt,text/plain,text/csv"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  style={{ display: "none" }}
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  style={{ cursor: "pointer", display: "block" }}
                >
                  <svg
                    width="40"
                    height="40"
                    style={{
                      margin: "0 auto var(--space-3)",
                      color: "var(--ink-muted)",
                      display: "block",
                    }}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p
                    style={{
                      color: "var(--ink-secondary)",
                      fontSize: "var(--text-sm)",
                    }}
                  >
                    {file ? file.name : "Click to upload or drag and drop"}
                  </p>
                  {file && (
                    <p
                      style={{
                        color: "var(--ink-muted)",
                        fontSize: "var(--text-xs)",
                        marginTop: "var(--space-1)",
                      }}
                    >
                      {(file.size / 1024).toFixed(1)} KB
                    </p>
                  )}
                </label>
              </div>
              {errors.file && <p className="field-error">{errors.file}</p>}
            </div>
          )}

          {/* Submit */}
          <div style={{ display: "flex", gap: "var(--space-3)" }}>
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className="btn-ghost"
              style={{ flex: 1, minHeight: "48px" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{ flex: 2, minHeight: "48px" }}
            >
              {loading ? (
                <span className="loading-dots">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
