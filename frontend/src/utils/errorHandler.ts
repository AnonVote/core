import { AxiosError } from "axios";

export interface ParsedError {
  title: string;
  message: string;
  statusCode?: number;
  retryable: boolean;
}

const ERROR_MESSAGES: Record<string, { title: string; message: string; retryable: boolean }> = {
  // Network errors
  NETWORK_ERROR: {
    title: "Network Error",
    message: "Unable to connect to the server. Please check your internet connection and try again.",
    retryable: true,
  },
  TIMEOUT_ERROR: {
    title: "Request Timeout",
    message: "The request took too long to complete. Please try again.",
    retryable: true,
  },
  
  // Authentication errors
  SESSION_EXPIRED: {
    title: "Session Expired",
    message: "Your session has expired. Please log in again.",
    retryable: false,
  },
  UNAUTHORIZED: {
    title: "Unauthorized",
    message: "You don't have permission to perform this action.",
    retryable: false,
  },
  
  // Ballot errors
  BALLOT_NOT_FOUND: {
    title: "Ballot Not Found",
    message: "The requested ballot could not be found.",
    retryable: false,
  },
  BALLOT_CLOSED: {
    title: "Ballot Closed",
    message: "This ballot is no longer accepting votes.",
    retryable: false,
  },
  BALLOT_NOT_STARTED: {
    title: "Ballot Not Started",
    message: "Voting for this ballot has not started yet.",
    retryable: false,
  },
  
  // Token errors
  INVALID_TOKEN: {
    title: "Invalid Token",
    message: "The provided voter token is invalid or has already been used.",
    retryable: false,
  },
  TOKEN_ALREADY_USED: {
    title: "Token Already Used",
    message: "This token has already been used to vote.",
    retryable: false,
  },
  TOKEN_NOT_FOUND: {
    title: "Token Not Found",
    message: "No token found for the provided identifier.",
    retryable: false,
  },
  
  // Rate limiting
  RATE_LIMIT_EXCEEDED: {
    title: "Too Many Requests",
    message: "You've made too many requests. Please wait a moment and try again.",
    retryable: true,
  },
  
  // Validation errors
  VALIDATION_ERROR: {
    title: "Validation Error",
    message: "The data you submitted is invalid. Please check your input and try again.",
    retryable: false,
  },
  
  // Server errors
  SERVER_ERROR: {
    title: "Server Error",
    message: "Something went wrong on our end. Please try again later.",
    retryable: true,
  },
  
  // Generic
  UNKNOWN_ERROR: {
    title: "Error",
    message: "An unexpected error occurred. Please try again.",
    retryable: true,
  },
};

export function parseError(error: unknown): ParsedError {
  // Handle AxiosError
  if (error && typeof error === "object" && "isAxiosError" in error) {
    const axiosError = error as AxiosError<{ error?: string; message?: string }>;
    
    // Network errors
    if (!axiosError.response) {
      // `message` is optional on the wire: an error handler must never itself throw.
      if (axiosError.code === "ECONNABORTED" || axiosError.message?.includes("timeout")) {
        return { ...ERROR_MESSAGES.TIMEOUT_ERROR, statusCode: 0 };
      }
      return { ...ERROR_MESSAGES.NETWORK_ERROR, statusCode: 0 };
    }
    
    const status = axiosError.response.status;
    const errorCode = axiosError.response.data?.error;
    const errorMessage = axiosError.response.data?.message;
    
    // Check for known error codes
    if (errorCode && ERROR_MESSAGES[errorCode]) {
      return { ...ERROR_MESSAGES[errorCode], statusCode: status };
    }
    
    // Handle by status code
    switch (status) {
      case 400:
        return {
          title: "Bad Request",
          message: errorMessage || "The request was invalid. Please check your input.",
          statusCode: status,
          retryable: false,
        };
      
      case 401:
        return { ...ERROR_MESSAGES.UNAUTHORIZED, statusCode: status };
      
      case 403:
        return {
          title: "Forbidden",
          message: errorMessage || "You don't have permission to access this resource.",
          statusCode: status,
          retryable: false,
        };
      
      case 404:
        return {
          title: "Not Found",
          message: errorMessage || "The requested resource was not found.",
          statusCode: status,
          retryable: false,
        };
      
      case 409:
        return {
          title: "Conflict",
          message: errorMessage || "A conflict occurred with the current state.",
          statusCode: status,
          retryable: false,
        };
      
      case 422:
        return { ...ERROR_MESSAGES.VALIDATION_ERROR, statusCode: status };
      
      case 429:
        return { ...ERROR_MESSAGES.RATE_LIMIT_EXCEEDED, statusCode: status };
      
      case 500:
      case 502:
      case 503:
      case 504:
        return { ...ERROR_MESSAGES.SERVER_ERROR, statusCode: status };
      
      default:
        return {
          title: "Error",
          message: errorMessage || `An error occurred (${status})`,
          statusCode: status,
          retryable: status >= 500,
        };
    }
  }
  
  // Handle Error objects
  if (error instanceof Error) {
    return {
      title: "Error",
      message: error.message || "An unexpected error occurred.",
      retryable: false,
    };
  }
  
  // Handle string errors
  if (typeof error === "string") {
    return {
      title: "Error",
      message: error,
      retryable: false,
    };
  }
  
  // Unknown error type
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

export function getErrorMessage(error: unknown): string {
  const parsed = parseError(error);
  return parsed.message;
}

export function getErrorTitle(error: unknown): string {
  const parsed = parseError(error);
  return parsed.title;
}

export function isRetryableError(error: unknown): boolean {
  const parsed = parseError(error);
  return parsed.retryable;
}
