import { useState, useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PageLoader from "./components/PageLoader";
import ProtectedRoute from "./components/ProtectedRoute";
import { NotificationProvider } from "./context/NotificationContext";

// Lazy-loaded pages — each chunk only downloads when the route is visited
const LandingPage = lazy(() => import("./pages/LandingPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const CreateBallotPage = lazy(() => import("./pages/CreateBallotPage"));
const EditBallotPage = lazy(() => import("./pages/EditBallotPage"));
const TokenRequestPage = lazy(() => import("./pages/TokenRequestPage"));
const VotePage = lazy(() => import("./pages/VotePage"));
const ResultsPage = lazy(() => import("./pages/ResultsPage"));
const AuditPage = lazy(() => import("./pages/AuditPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

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
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
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
            <Route
              path="/ballots/:ballotId/edit"
              element={
                <ProtectedRoute>
                  <EditBallotPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/vote/:ballotId/token"
              element={<TokenRequestPage />}
            />
            <Route path="/vote/:ballotId" element={<VotePage />} />
            <Route path="/results/:ballotId" element={<ResultsPage />} />
            <Route path="/audit/:ballotId" element={<AuditPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </NotificationProvider>
  );
}
