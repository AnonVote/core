import type { TallyEntry } from "../types";

interface Props {
  entries: TallyEntry[];
}

export default function ResultChart({ entries }: Props) {
  const max = Math.max(...entries.map((e) => e.count), 1);

  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <div key={entry.optionId}>
          <div className="flex justify-between items-center mb-1">
            <span className="text-gray-900 dark:text-white font-medium text-sm">
              {entry.optionText}
            </span>
            <span className="text-gray-600 dark:text-gray-400 text-sm">
              {entry.count} votes ({entry.percentage.toFixed(1)}%)
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div
              className="bg-primary h-3 rounded-full transition-all duration-500"
              style={{ width: `${(entry.count / max) * 100}%` }}
              role="progressbar"
              aria-valuenow={entry.count}
              aria-valuemin={0}
              aria-valuemax={max}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
