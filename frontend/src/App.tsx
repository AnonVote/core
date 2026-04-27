import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import RegisterPage from "./pages/RegisterPage";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CreateBallotPage from "./pages/CreateBallotPage";
import TokenRequestPage from "./pages/TokenRequestPage";
import VotePage from "./pages/VotePage";
import ResultsPage from "./pages/ResultsPage";
import AuditPage from "./pages/AuditPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/ballots/new" element={<CreateBallotPage />} />
        <Route path="/vote/:ballotId/token" element={<TokenRequestPage />} />
        <Route path="/vote/:ballotId" element={<VotePage />} />
        <Route path="/results/:ballotId" element={<ResultsPage />} />
        <Route path="/audit/:ballotId" element={<AuditPage />} />
      </Routes>
    </BrowserRouter>
  );
}
