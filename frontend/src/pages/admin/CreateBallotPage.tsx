import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createBallot } from "../../api/client";
import Navbar from "../../components/Navbar";
import { useNotifications } from "../../context/NotificationContext";

export default function AdminCreateBallotPage() {
  const navigate = useNavigate();
  const { addNotification } = useNotifications();
  const [topic, setTopic] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [deadline, setDeadline] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const addOption = () => {
    if (options.length < 10) setOptions([...options, ""]);
  };
  const removeOption = (i: number) => {
    if (options.length > 2) setOptions(options.filter((_, idx) => idx !== i));
  };
  const updateOption = (i: number, val: string) =>
    setOptions(options.map((o, idx) => (idx === i ? val : o)));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!topic.trim()) e.topic = "Topic is required";
    else if (topic.length > 200) e.topic = "Topic must be under 200 characters";

    const trimmed = options.filter((o) => o.trim());
    if (trimmed.length < 2) e.options = "At least two options are required";
    if (options.some((o) => o.trim().length > 100))
      e.options = "Each option must be at most 100 characters";

    const seen = new Set<string>();
    for (const o of options) {
      if (!o.trim()) continue;
      const normalized = o.trim().toLowerCase();
      if (seen.has(normalized)) {
        e.options = "Duplicate options are not allowed";
        break;
      }
      seen.add(normalized);
    }

    if (!deadline) {
      e.deadline = "Deadline is required";
    } else {
      const d = new Date(deadline);
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      if (d < oneHourFromNow) {
        e.deadline = "Deadline must be at least 1 hour in the future";
      }
    }
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
      await createBallot({
        topic: topic.trim(),
        options: options.map((o) => o.trim()).filter(Boolean),
        deadline: new Date(deadline).toISOString(),
      });
      addNotification({
        type: "ballot_created",
        title: "Ballot created",
        message: `"${topic.trim()}" has been created as a draft`,
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

  const getUTCEquivalent = (localVal: string): string | null => {
    if (!localVal) return null;
    const d = new Date(localVal);
    return d.toISOString().replace("Z", "+00:00");
  };

  const utcEquivalent = getUTCEquivalent(deadline);

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
        <div className="text-eyebrow mb-3">Admin</div>
        <h1
          className="font-space-grotesk font-bold mb-2"
          style={{ fontSize: "var(--text-2xl)", color: "var(--ink-primary)" }}
        >
          Create Ballot
        </h1>
        <p
          className="mb-8"
          style={{ color: "var(--ink-muted)", fontSize: "var(--text-base)" }}
        >
          Define the topic, options, and deadline. The ballot will be created as a
          draft and activated automatically at the start time.
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
          {/* Title with character count */}
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
                Ballot Title
              </label>
              <span
                style={{
                  fontSize: "var(--text-xs)",
                  color:
                    topic.length > 200
                      ? "var(--semantic-error)"
                      : "var(--ink-muted)",
                }}
              >
                {topic.length}/200
              </span>
            </div>
            <input
              id="ballot-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className={
                "input-field " + (errors.topic ? "error" : "")
              }
              placeholder="e.g. Adopt new remote work policy"
              maxLength={200}
            />
            {errors.topic && <p className="field-error">{errors.topic}</p>}
          </div>

          {/* Options */}
          <div>
            <label className="form-label">
              Options
              <span
                style={{
                  marginLeft: "var(--space-2)",
                  fontSize: "var(--text-xs)",
                  color: "var(--ink-muted)",
                  fontWeight: "normal",
                }}
              >
                ({options.length}/10, minimum 2)
              </span>
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
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => updateOption(i, e.target.value)}
                    className="input-field"
                    placeholder={"Option " + (i + 1)}
                    maxLength={100}
                  />
                  <button
                    type="button"
                    disabled={options.length <= 2}
                    title={options.length <= 2 ? "Minimum 2 options required" : "Remove option"}
                    aria-label={`Remove option ${i + 1}`}
                    onClick={() => removeOption(i)}
                    style={{
                      background: "none",
                      border: "1px solid var(--border-medium)",
                      borderRadius: "var(--radius-sm)",
                      color: options.length <= 2 ? "var(--ink-muted)" : "var(--semantic-error)",
                      cursor: options.length <= 2 ? "not-allowed" : "pointer",
                      padding: "8px 12px",
                      fontSize: "var(--text-sm)",
                      minWidth: "36px",
                      opacity: options.length <= 2 ? 0.4 : 1,
                    }}
                  >
                    ✕
                  </button>
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

          {/* Deadline Picker */}
          <div>
            <label className="form-label">Voting Deadline</label>
            <input
              type="datetime-local"
              value={deadline}
              min={minDeadline}
              onChange={(e) => setDeadline(e.target.value)}
              className={
                "input-field " + (errors.deadline ? "error" : "")
              }
            />
            {utcEquivalent && (
              <p
                style={{
                  fontSize: "var(--text-xs)",
                  color: "var(--ink-muted)",
                  marginTop: "var(--space-1)",
                }}
              >
                UTC equivalent: {utcEquivalent}
              </p>
            )}
            {errors.deadline && (
              <p className="field-error">{errors.deadline}</p>
            )}
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
              "Create Ballot"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}