import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { parseError, type ParsedError } from "../utils/errorHandler";
import ErrorMessage from "../components/ErrorMessage";

interface ErrorContextType {
  showError: (error: unknown) => void;
  clearError: () => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<ParsedError | null>(null);

  const showError = useCallback((err: unknown) => {
    const parsed = parseError(err);
    setError(parsed);
    console.error("[Global Error]", parsed);
    
    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      setError(null);
    }, 10000);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <ErrorContext.Provider value={{ showError, clearError }}>
      {children}
      
      {error && (
        <div className="fixed top-4 right-4 z-50 max-w-md w-full animate-slide-in-right">
          <ErrorMessage
            title={error.title}
            message={error.message}
            severity="error"
            onDismiss={clearError}
            className="shadow-lg"
          />
        </div>
      )}
    </ErrorContext.Provider>
  );
}

export function useGlobalError() {
  const context = useContext(ErrorContext);
  if (context === undefined) {
    throw new Error("useGlobalError must be used within ErrorProvider");
  }
  return context;
}
