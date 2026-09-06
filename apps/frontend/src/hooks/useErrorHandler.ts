import { useState, useCallback } from "react";
import { parseError, type ParsedError } from "../utils/errorHandler";

interface UseErrorHandlerReturn {
  error: ParsedError | null;
  setError: (error: unknown) => void;
  clearError: () => void;
  handleError: (error: unknown) => void;
}

export function useErrorHandler(): UseErrorHandlerReturn {
  const [error, setErrorState] = useState<ParsedError | null>(null);

  const setError = useCallback((error: unknown) => {
    const parsed = parseError(error);
    setErrorState(parsed);
    console.error("[Error]", parsed);
  }, []);

  const clearError = useCallback(() => {
    setErrorState(null);
  }, []);

  const handleError = useCallback((error: unknown) => {
    setError(error);
  }, [setError]);

  return {
    error,
    setError,
    clearError,
    handleError,
  };
}
