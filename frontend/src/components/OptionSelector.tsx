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
              ? "border-indigo-500 bg-indigo-900/30 text-white"
              : "border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500 hover:text-white"
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-4 h-4 rounded-full border-2 shrink-0 ${selected === opt.id ? "border-indigo-400 bg-indigo-400" : "border-gray-500"}`}
            />
            {opt.text}
          </div>
        </button>
      ))}
    </div>
  );
}
