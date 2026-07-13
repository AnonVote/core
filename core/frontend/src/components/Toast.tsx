import { useEffect } from "react";
import { CheckIcon, Cross2Icon } from "@radix-ui/react-icons";

interface ToastProps {
  message: string;
  type: "success" | "error";
  onClose: () => void;
}

export default function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const isSuccess = type === "success";

  return (
    <div
      role={isSuccess ? "status" : "alert"}
      aria-live={isSuccess ? "polite" : "assertive"}
      aria-atomic="true"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg transform transition-all duration-300 ease-in-out animate-slide-in"
      style={{
        backgroundColor: "var(--surface-raised)",
        border: `1px solid ${isSuccess ? "var(--semantic-success-border)" : "var(--semantic-error-border)"}`,
        boxShadow: "var(--shadow-lg)",
        color: "var(--ink-primary)",
      }}
    >
      <div
        style={{
          color: isSuccess
            ? "var(--semantic-success)"
            : "var(--semantic-error)",
        }}
      >
        {isSuccess ? (
          <CheckIcon width="20" height="20" />
        ) : (
          <Cross2Icon width="20" height="20" />
        )}
      </div>
      <span
        style={{
          fontSize: "var(--text-sm)",
          fontWeight: "var(--weight-medium)",
        }}
      >
        {message}
      </span>
    </div>
  );
}
