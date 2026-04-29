import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { uploadEligibilityList, createBallot } from "../api/client";
import Navbar from "../components/Navbar";

export default function CreateBallotPage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [deadline, setDeadline] = useState("");
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
    if (options.some((o) => !o.trim()))
      e.options = "All options must have text";
    if (options.filter((o) => o.trim()).length < 2)
      e.options = "At least two options are required";
    if (!deadline) e.deadline = "Deadline is required";
    else if (new Date(deadline) <= new Date())
      e.deadline = "Deadline must be in the future";
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
      });
      navigate("/dashboard");
    } catch (err: any) {
      setErrors({
        general: err.response?.data?.message || "Failed to create ballot",
      });
    } finally {
      setLoading(false);
    }
  };

  const minDeadline = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  return (
    <div className="min-h-screen bg-grid-overlay glow-indigo glow-emerald">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <div className="section-eyebrow mb-2">Create Ballot</div>
        <h1 className="text-3xl font-space-grotesk font-bold mb-2">
          Create Ballot
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-8">
          Define the topic, options, deadline, and eligible voters.
        </p>

        {errors.general && (
          <div className="error-message">
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span>{errors.general}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Ballot Topic
            </label>
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
                className="input-field has-icon"
                placeholder="e.g. Adopt new remote work policy"
              />
            </div>
            {errors.topic && (
              <p className="text-red-500 text-xs mt-1">{errors.topic}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Options
            </label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <div className="input-wrapper flex-1">
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
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                    </span>
                    <input
                      type="text"
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      className="input-field has-icon"
                      placeholder={`Option ${i + 1}`}
                    />
                  </div>
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="text-gray-500 hover:text-red-500 px-2 transition"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {errors.options && (
              <p className="text-red-500 text-xs mt-1">{errors.options}</p>
            )}
            <button
              type="button"
              onClick={addOption}
              className="mt-2 text-primary hover:text-primary-hover text-sm font-medium transition"
            >
              + Add option
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Voting Deadline
            </label>
            <div className="input-wrapper">
              <span className="input-icon">
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
                className="input-field has-icon"
              />
            </div>
            {errors.deadline && (
              <p className="text-red-500 text-xs mt-1">{errors.deadline}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Eligible Voters List
            </label>
            <p className="text-gray-500 text-xs mb-2">
              Upload a CSV or plain-text file with one voter identifier per line
              (max 10MB)
            </p>
            <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center hover:border-primary transition cursor-pointer">
              <input
                type="file"
                accept=".csv,.txt,text/plain,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <svg
                  className="w-10 h-10 mx-auto text-gray-400 mb-2"
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
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  {file ? file.name : "Click to upload or drag and drop"}
                </p>
                {file && (
                  <p className="text-gray-500 text-xs mt-1">
                    {(file.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </label>
            </div>
            {errors.file && (
              <p className="text-red-500 text-xs mt-1">{errors.file}</p>
            )}
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
              "Launch Ballot"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
