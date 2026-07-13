import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { uploadEligibilityList, createBallot } from "../api/client";
import Navbar from "../components/Navbar";
import { useTheme } from "../context/ThemeContext";
import { useNotifications } from "../context/NotificationContext";

export default function CreateBallotPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { addNotification } = useNotifications();
  const [topic, setTopic] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [deadline, setDeadline] = useState("");
  const [allowWeightedVoting, setAllowWeightedVoting] = useState(false);
  const [allowRankedChoice, setAllowRankedChoice] = useState(false);
  const [maxRankings, setMaxRankings] = useState<number>(3);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const addOption = () => setOptions([...options, ""]);
  const removeOption = (i: number) => {
    if (options.length > 2) setOptions(options.filter((_, idx) => idx !== i));
  };
  const updateOption = (i: number, val: string) =>
    setOptions(options.map((o, idx) => (idx === i ? val : o)));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!topic.trim()) e.topic = "Topic is required";
    if (topic.length > 500) e.topic = "Topic must be under 500 characters";

    if (options.some((o) => !o.trim()))
      e.options = "All options must have text";
    if (options.filter((o) => o.trim()).length < 2)
      e.options = "At least two options are required";
    if (options.length > 10) e.options = "Maximum 10 options allowed";

    if (!deadline) {
      e.deadline = "Deadline is required";
    } else {
      const d = new Date(deadline);
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      if (d < oneHourFromNow) {
        e.deadline = "Deadline must be at least 1 hour in the future";
      }
    }

    if (!file) e.file = "Eligibility list file is required";
    else if (file.size > 10 * 1024 * 1024) e.file = "File must be under 10MB";
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
      const eligRes = await uploadEligibilityList(file!);
      const { eligibilityListId } = eligRes.data.data;
      await createBallot({
        topic: topic.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        eligibilityListId,
        deadline: new Date(deadline).toISOString(),
        allowWeightedVoting,
        allowRankedChoice,
        maxRankings: allowRankedChoice ? maxRankings : undefined,
      });
      addNotification({
        type: "ballot_created",
        title: "Ballot created",
        message: `"${topic.trim()}" is now live and accepting votes`,
      });
      navigate("/dashboard");
    } catch (err: any) {
      if (err.response?.data?.fields) {
        const fieldErrors: Record<string, string> = {};
        err.response.data.fields.forEach((f: any) => {
          fieldErrors[f.field] = f.message;
        });
        setErrors(fieldErrors);
      } else {
        setErrors({
          general: err.response?.data?.message || "Failed to create ballot",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const minDeadline = new Date(Date.now() + 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);

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
        <div className="text-eyebrow mb-3">New Ballot</div>
        <h1
          className="font-space-grotesk font-bold mb-2"
          style={{ fontSize: "var(--text-2xl)", color: "var(--ink-primary)" }}
        >
          Create a Ballot
        </h1>
        <p
          className="mb-8"
          style={{ color: "var(--ink-muted)", fontSize: "var(--text-base)" }}
        >
          Define the topic, options, deadline, and eligible voters.
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
          {/* Ballot Topic */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "var(--space-2)",
              }}
            >
              <label htmlFor="ballot-topic" className="form-label" style={{ marginBottom: 0 }}>
                Ballot Topic
              </label>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color:
                    topic.length > 500
                      ? "var(--semantic-error)"
                      : "var(--ink-muted)",
                }}
              >
                {topic.length}/500
              </span>
            </div>
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
                id="ballot-topic"
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

          {/* Options */}
          <div>
            <label className="form-label">Options</label>
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
                      className="input-field has-icon"
                      placeholder={"Option " + (i + 1)}
                    />
                  </div>
                  {options.length > 2 && (
                    <button
                      type="button"
                      title="Remove option"
                      aria-label={`Remove option ${i + 1}`}
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
            {options.length < 10 && (
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

          {/* Deadline — full input clickable, icon themed */}
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

          {/* Voting Options — checkboxes */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
            }}
          >
            <label className="form-label" style={{ marginBottom: 0 }}>
              Voting Options
            </label>

            {/* Weighted Voting checkbox */}
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "var(--space-3)",
                cursor: "pointer",
                padding: "var(--space-4)",
                background: "var(--surface-sunken)",
                border:
                  "1px solid " +
                  (allowWeightedVoting
                    ? "var(--brand-primary)"
                    : "var(--border-soft)"),
                borderRadius: "var(--radius-md)",
                transition: "border-color var(--transition-fast)",
              }}
            >
              <input
                type="checkbox"
                checked={allowWeightedVoting}
                onChange={(e) => {
                  setAllowWeightedVoting(e.target.checked);
                  if (!e.target.checked) setAllowRankedChoice(false);
                }}
                style={{
                  width: "16px",
                  height: "16px",
                  marginTop: "2px",
                  accentColor: "var(--brand-primary)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              />
              <div>
                <span
                  style={{
                    fontSize: "var(--text-sm)",
                    fontWeight: "var(--weight-medium)",
                    color: "var(--ink-primary)",
                    display: "block",
                    marginBottom: "var(--space-1)",
                  }}
                >
                  Allow Weighted Voting
                </span>
                <span
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--ink-muted)",
                  }}
                >
                  Voters can have different vote weights based on their
                  eligibility entry
                </span>
              </div>
            </label>

            {/* Ranked Choice checkbox — only shown when weighted is enabled */}
            {allowWeightedVoting && (
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-3)",
                  cursor: "pointer",
                  padding: "var(--space-4)",
                  background: "var(--surface-sunken)",
                  border:
                    "1px solid " +
                    (allowRankedChoice
                      ? "var(--brand-primary)"
                      : "var(--border-soft)"),
                  borderRadius: "var(--radius-md)",
                  transition: "border-color var(--transition-fast)",
                }}
              >
                <input
                  type="checkbox"
                  checked={allowRankedChoice}
                  onChange={(e) => setAllowRankedChoice(e.target.checked)}
                  style={{
                    width: "16px",
                    height: "16px",
                    marginTop: "2px",
                    accentColor: "var(--brand-primary)",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                />
                <div>
                  <span
                    style={{
                      fontSize: "var(--text-sm)",
                      fontWeight: "var(--weight-medium)",
                      color: "var(--ink-primary)",
                      display: "block",
                      marginBottom: "var(--space-1)",
                    }}
                  >
                    Allow Ranked-Choice Voting
                  </span>
                  <span
                    style={{
                      fontSize: "var(--text-xs)",
                      color: "var(--ink-muted)",
                    }}
                  >
                    Voters can rank multiple options (1st, 2nd, 3rd choice)
                  </span>
                </div>
              </label>
            )}

            {/* Max Rankings input */}
            {allowWeightedVoting && allowRankedChoice && (
              <div>
                <label className="form-label">Max Rankings</label>
                <input
                  type="number"
                  min="2"
                  max={options.length}
                  value={maxRankings}
                  onChange={(e) =>
                    setMaxRankings(
                      Math.min(
                        Math.max(2, parseInt(e.target.value) || 2),
                        options.length,
                      ),
                    )
                  }
                  className="input-field"
                  style={{ maxWidth: "120px" }}
                />
                <p
                  style={{
                    fontSize: "var(--text-xs)",
                    color: "var(--ink-muted)",
                    marginTop: "var(--space-1)",
                  }}
                >
                  Maximum number of options voters can rank
                </p>
              </div>
            )}
          </div>

          {/* File Upload */}
          <div>
            <label className="form-label">Eligible Voters List</label>
            <p
              style={{
                color: "var(--ink-muted)",
                fontSize: "var(--text-sm)",
                marginBottom: "var(--space-2)",
              }}
            >
              Upload a CSV or plain-text file with one voter identifier per line
              (max 10MB)
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

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="btn-primary full-width"
            style={{ minHeight: "48px" }}
          >
            {loading ? (
              <span className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </span>
            ) : (
              "Launch Ballot"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
