import { expect, test, describe, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreateBallotPage from '../pages/CreateBallotPage';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '../context/ThemeContext';
import { NotificationProvider } from '../context/NotificationContext';

// Mock API calls
vi.mock('../api/client', () => ({
  uploadEligibilityList: vi.fn(),
  createBallot: vi.fn(),
  getMe: vi.fn(() => Promise.resolve({ data: { data: { id: '1', name: 'Test Org' } } })),
}));

const renderPage = () => {
  return render(
    <BrowserRouter>
      <ThemeProvider>
        <NotificationProvider>
          <CreateBallotPage />
        </NotificationProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
};

describe('CreateBallotPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders the form with initial state', () => {
    renderPage();
    expect(screen.getByText(/Create a Ballot/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Ballot Topic/i)).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText(/Option/i)).toHaveLength(2);
  });

  test('dynamic options: can add and remove options', () => {
    renderPage();
    const addButton = screen.getByText(/\+ Add option/i);

    // Add up to 3 options
    fireEvent.click(addButton);
    expect(screen.getAllByPlaceholderText(/Option/i)).toHaveLength(3);

    // Remove the last option
    const removeButtons = screen.getAllByTitle(/Remove option/i);
    fireEvent.click(removeButtons[removeButtons.length - 1]);
    expect(screen.getAllByPlaceholderText(/Option/i)).toHaveLength(2);
  });

  test('topic character count works', () => {
    renderPage();
    const topicInput = screen.getByPlaceholderText(/e.g. Adopt new remote work policy/i);
    fireEvent.change(topicInput, { target: { value: 'Test Topic' } });
    expect(screen.getByText('10/500')).toBeInTheDocument();
  });

  test('enforces max 10 options', () => {
    renderPage();
    const addButton = screen.getByText(/\+ Add option/i);
    for (let i = 0; i < 8; i++) {
      fireEvent.click(addButton);
    }
    expect(screen.getAllByPlaceholderText(/Option/i)).toHaveLength(10);
    expect(screen.queryByText(/\+ Add option/i)).toBeNull();
  });

  test('client-side validation for empty fields', () => {
    renderPage();
    const submitButton = screen.getByText(/Launch Ballot/i);
    fireEvent.click(submitButton);

    expect(screen.getByText(/Topic is required/i)).toBeInTheDocument();
    expect(screen.getByText(/Deadline is required/i)).toBeInTheDocument();
    expect(screen.getByText(/Eligibility list file is required/i)).toBeInTheDocument();
  });
});
