# Frontend Error Handling

## Overview

Comprehensive error handling system for the AnonVote frontend that prevents white screens, provides user-friendly error messages, and enables proper error recovery.

## Components

### 1. ErrorBoundary

React error boundary that catches rendering errors and prevents the entire app from crashing.

**Location**: `src/components/ErrorBoundary.tsx`

**Usage**:
```tsx
<ErrorBoundary>
  <YourComponent />
</ErrorBoundary>
```

**Features**:
- Catches React component errors
- Displays user-friendly error message
- Provides "Try Again" button to reset state
- Provides "Go to Home" button for navigation
- Logs errors to console (production: send to error tracking)
- Shows component stack in development mode

### 2. ErrorMessage

Inline error message component for displaying API errors and validation messages.

**Location**: `src/components/ErrorMessage.tsx`

**Usage**:
```tsx
<ErrorMessage
  title="Error Title"
  message="Error description"
  severity="error"  // 'error' | 'warning' | 'info'
  onDismiss={() => clearError()}
  action={{ label: "Retry", onClick: handleRetry }}
/>
```

**Features**:
- Three severity levels (error, warning, info)
- Dismissible with X button
- Optional action button
- Color-coded styling
- Icon indicators

### 3. ErrorPage

Full-page error component for critical errors.

**Location**: `src/components/ErrorPage.tsx`

**Usage**:
```tsx
<ErrorPage
  title="Page Not Found"
  message="The page you're looking for doesn't exist"
  showRetry={false}
  showHome={true}
  showBack={true}
/>
```

**Features**:
- Full-page error display
- Customizable title and message
- Configurable action buttons
- Navigation helpers

### 4. ErrorContext

Global error handling context for showing toast notifications.

**Location**: `src/context/ErrorContext.tsx`

**Usage**:
```tsx
import { useGlobalError } from '../context/ErrorContext';

function Component() {
  const { showError, clearError } = useGlobalError();
  
  try {
    // operation
  } catch (error) {
    showError(error);
  }
}
```

**Features**:
- Global error toast notifications
- Auto-dismisses after 10 seconds
- Positioned in top-right corner
- Parses errors automatically

## Utilities

### parseError

Converts various error types into a standardized format.

**Location**: `src/utils/errorHandler.ts`

**Features**:
- Handles AxiosError (API errors)
- Handles Error objects
- Handles string errors
- Extracts user-friendly messages
- Determines if error is retryable
- Maps HTTP status codes to messages
- Recognizes custom error codes

**Error Types Handled**:
- Network errors (connection failed, timeout)
- Authentication errors (401, SESSION_EXPIRED)
- Authorization errors (403)
- Not found errors (404)
- Validation errors (400, 422)
- Rate limiting (429)
- Server errors (500, 502, 503, 504)
- Custom application errors

**Usage**:
```tsx
import { parseError, getErrorMessage, isRetryableError } from '../utils/errorHandler';

try {
  await api.submitVote(data);
} catch (error) {
  const parsed = parseError(error);
  console.log(parsed.title);      // "Network Error"
  console.log(parsed.message);    // "Unable to connect..."
  console.log(parsed.retryable);  // true
  
  // Or use utility functions
  const message = getErrorMessage(error);
  const canRetry = isRetryableError(error);
}
```

## Hooks

### useErrorHandler

React hook for component-level error handling.

**Location**: `src/hooks/useErrorHandler.ts`

**Usage**:
```tsx
import { useErrorHandler } from '../hooks/useErrorHandler';

function Component() {
  const { error, setError, clearError, handleError } = useErrorHandler();
  
  const fetchData = async () => {
    try {
      const result = await api.getData();
    } catch (err) {
      handleError(err);
    }
  };
  
  return (
    <div>
      {error && (
        <ErrorMessage
          title={error.title}
          message={error.message}
          onDismiss={clearError}
        />
      )}
      {/* component content */}
    </div>
  );
}
```

## Implementation Guide

### 1. Basic Error Handling in Component

```tsx
import { useState } from 'react';
import { useErrorHandler } from '../hooks/useErrorHandler';
import ErrorMessage from '../components/ErrorMessage';
import { submitVote } from '../api/client';

function VoteComponent() {
  const { error, handleError, clearError } = useErrorHandler();
  const [loading, setLoading] = useState(false);
  
  const handleSubmit = async () => {
    setLoading(true);
    clearError();
    
    try {
      await submitVote({ ballotId, token, optionId });
      // Success handling
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div>
      {error && (
        <ErrorMessage
          title={error.title}
          message={error.message}
          severity="error"
          onDismiss={clearError}
          action={error.retryable ? {
            label: "Try Again",
            onClick: handleSubmit
          } : undefined}
        />
      )}
      
      <button onClick={handleSubmit} disabled={loading}>
        Submit Vote
      </button>
    </div>
  );
}
```

### 2. Using Global Error Toast

```tsx
import { useGlobalError } from '../context/ErrorContext';

function Component() {
  const { showError } = useGlobalError();
  
  const handleAction = async () => {
    try {
      await api.doSomething();
    } catch (error) {
      showError(error);  // Shows toast notification
    }
  };
}
```

### 3. Critical Error with ErrorPage

```tsx
import { useState, useEffect } from 'react';
import ErrorPage from '../components/ErrorPage';

function CriticalComponent() {
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState(null);
  
  useEffect(() => {
    loadData().catch(setError);
  }, []);
  
  if (error) {
    return (
      <ErrorPage
        title="Failed to Load Data"
        message="We couldn't load the required data. Please try again."
        onRetry={() => {
          setError(null);
          loadData().catch(setError);
        }}
      />
    );
  }
  
  return <div>{/* normal content */}</div>;
}
```

### 4. Wrapping with ErrorBoundary

```tsx
import ErrorBoundary from '../components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <YourApp />
    </ErrorBoundary>
  );
}

// Or with custom fallback
function Page() {
  return (
    <ErrorBoundary fallback={<CustomErrorUI />}>
      <PageContent />
    </ErrorBoundary>
  );
}
```

## Custom Error Codes

The system recognizes these custom error codes from the API:

| Code | Title | Retryable |
|------|-------|-----------|
| SESSION_EXPIRED | Session Expired | No |
| BALLOT_NOT_FOUND | Ballot Not Found | No |
| BALLOT_CLOSED | Ballot Closed | No |
| BALLOT_NOT_STARTED | Ballot Not Started | No |
| INVALID_TOKEN | Invalid Token | No |
| TOKEN_ALREADY_USED | Token Already Used | No |
| RATE_LIMIT_EXCEEDED | Too Many Requests | Yes |
| VALIDATION_ERROR | Validation Error | No |

To add new error codes, update `ERROR_MESSAGES` in `src/utils/errorHandler.ts`.

## Best Practices

### 1. Always Handle Errors

```tsx
// ❌ Bad
async function submitForm() {
  await api.submit(data);
}

// ✅ Good
async function submitForm() {
  try {
    await api.submit(data);
  } catch (error) {
    handleError(error);
  }
}
```

### 2. Clear Errors When Retrying

```tsx
// ✅ Good
const handleRetry = () => {
  clearError();  // Clear previous error
  performAction();
};
```

### 3. Show Contextual Errors

```tsx
// ✅ Good - Show error near the form
<form>
  {error && <ErrorMessage {...error} />}
  <input />
  <button>Submit</button>
</form>
```

### 4. Use Appropriate Error Display

```tsx
// For inline validation errors
<ErrorMessage message="Email is required" severity="warning" />

// For API errors
<ErrorMessage 
  title={error.title}
  message={error.message}
  severity="error"
  onDismiss={clearError}
/>

// For critical failures
<ErrorPage 
  title="Failed to load ballot"
  message="The ballot could not be loaded"
  onRetry={retry}
/>
```

### 5. Provide Recovery Actions

```tsx
// ✅ Good - Always provide a way forward
<ErrorMessage
  message="Failed to submit vote"
  action={{ label: "Try Again", onClick: handleRetry }}
  onDismiss={clearError}
/>
```

## Testing

Run error handling tests:

```bash
cd frontend
npm test -- errorHandling.test.tsx
```

Tests cover:
- ErrorBoundary error catching
- ErrorMessage rendering and interactions
- ErrorPage functionality
- Error parsing for various error types
- Utility functions

## Troubleshooting

### Error boundary not catching errors

- Error boundaries only catch errors during rendering
- They don't catch errors in event handlers, async code, or server-side rendering
- For async errors, use try-catch and error state

### Errors not displaying

1. Check if ErrorBoundary is wrapped around your app
2. Verify error handling in components
3. Check console for error details
4. Ensure ErrorContext is provided

### Retryable errors not working

- Check `parseError` logic for your error type
- Verify HTTP status codes are mapped correctly
- Ensure custom error codes are in ERROR_MESSAGES

## Future Enhancements

- Integration with error tracking services (Sentry, LogRocket)
- Offline error queue
- Error analytics dashboard
- User feedback on errors
- Automatic error recovery strategies
