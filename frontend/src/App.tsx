import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CreateBallotPage from "./pages/CreateBallotPage";
import TokenRequestPage from "./pages/TokenRequestPage";
import VotePage from "./pages/VotePage";
import ResultsPage from "./pages/ResultsPage";
import AuditPage from "./pages/AuditPage";
import SettingsPage from "./pages/SettingsPage";
import ProtectedRoute from "./components/ProtectedRoute";
import PageLoader from "./components/PageLoader";
import { NotificationProvider } from "./context/NotificationContext";

export default function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  if (loading) return <PageLoader />;

  return (
    <NotificationProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ballots/new"
            element={
              <ProtectedRoute>
                <CreateBallotPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
          <Route path="/vote/:ballotId/token" element={<TokenRequestPage />} />
          <Route path="/vote/:ballotId" element={<VotePage />} />
          <Route path="/results/:ballotId" element={<ResultsPage />} />
          <Route path="/audit/:ballotId" element={<AuditPage />} />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  );
}
