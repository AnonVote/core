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
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-3xl font-bold mb-2">Create Ballot</h1>
        <p className="text-gray-400 mb-8">
          Define the topic, options, deadline, and eligible voters.
        </p>

        {errors.general && (
          <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 mb-6 text-sm">
            {errors.general}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Ballot Topic
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className={`w-full bg-gray-900 border ${errors.topic ? "border-red-500" : "border-gray-700"} rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500`}
              placeholder="e.g. Adopt new remote work policy"
            />
            {errors.topic && (
              <p className="text-red-400 text-xs mt-1">{errors.topic}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Options
            </label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => updateOption(i, e.target.value)}
                    className={`flex-1 bg-gray-900 border ${errors.options ? "border-red-500" : "border-gray-700"} rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500`}
                    placeholder={`Option ${i + 1}`}
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      className="text-gray-500 hover:text-red-400 px-2 transition"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {errors.options && (
              <p className="text-red-400 text-xs mt-1">{errors.options}</p>
            )}
            <button
              type="button"
              onClick={addOption}
              className="mt-2 text-indigo-400 hover:text-indigo-300 text-sm transition"
            >
              + Add option
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Voting Deadline
            </label>
            <input
              type="datetime-local"
              value={deadline}
              min={minDeadline}
              onChange={(e) => setDeadline(e.target.value)}
              className={`w-full bg-gray-900 border ${errors.deadline ? "border-red-500" : "border-gray-700"} rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500`}
            />
            {errors.deadline && (
              <p className="text-red-400 text-xs mt-1">{errors.deadline}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Eligible Voters List
            </label>
            <p className="text-gray-500 text-xs mb-2">
              Upload a CSV or plain-text file with one voter identifier per line
              (max 10MB)
            </p>
            <input
              type="file"
              accept=".csv,.txt,text/plain,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className={`w-full bg-gray-900 border ${errors.file ? "border-red-500" : "border-gray-700"} rounded-lg px-4 py-2.5 text-gray-300 file:mr-4 file:py-1 file:px-3 file:rounded file:border-0 file:bg-indigo-600 file:text-white file:text-sm file:cursor-pointer focus:outline-none`}
            />
            {file && (
              <p className="text-gray-400 text-xs mt-1">
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
            {errors.file && (
              <p className="text-red-400 text-xs mt-1">{errors.file}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition"
          >
            {loading ? "Creating ballot..." : "Create Ballot"}
          </button>
        </form>
      </div>
    </div>
  );
}
