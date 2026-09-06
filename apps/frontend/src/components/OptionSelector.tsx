import type { Option } from "../types";

interface Props {
  options: Option[];
  selected: string;
  onChange: (id: string) => void;
}

export default function OptionSelector({ options, selected, onChange }: Props) {
  return (
    <div className="space-y-3" role="radiogroup" aria-label="Vote options">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={selected === opt.id}
          onClick={() => onChange(opt.id)}
          className={`w-full text-left px-5 py-4 rounded-xl border-2 transition font-medium ${
            selected === opt.id
              ? "border-primary bg-primary/10 text-gray-900 dark:text-white"
              : "border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-primary hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-4 h-4 rounded-full border-2 shrink-0 ${selected === opt.id ? "border-primary bg-primary" : "border-gray-400 dark:border-gray-500"}`}
            />
            {opt.text}
          </div>
        </button>
      ))}
    </div>
  );
}
