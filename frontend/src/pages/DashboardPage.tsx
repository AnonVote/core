import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getBallots } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import Navbar from "../components/Navbar";
import BallotCard from "../components/BallotCard";
import type { Ballot } from "../types";

export default function DashboardPage() {
  const { isAuthenticated, loading: authLoading, orgName } = useAuth();
  const navigate = useNavigate();
  const [ballots, setBallots] = useState<Ballot[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBallots = async () => {
    try {
      const res = await getBallots();
      setBallots(res.data.data);
    } catch {
      // 401 handled by interceptor
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/login");
      return;
    }
    if (!authLoading) fetchBallots();
  }, [authLoading, isAuthenticated]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(fetchBallots, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            {orgName && <p className="text-gray-400 mt-1">{orgName}</p>}
          </div>
          <Link
            to="/ballots/new"
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-2.5 rounded-lg transition"
          >
            + Create Ballot
          </Link>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-gray-900 border border-gray-800 rounded-2xl p-6 animate-pulse h-48"
              />
            ))}
          </div>
        ) : ballots.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-gray-500 text-lg mb-4">No ballots yet.</p>
            <Link
              to="/ballots/new"
              className="text-indigo-400 hover:text-indigo-300"
            >
              Create your first ballot →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {ballots.map((b) => (
              <BallotCard key={b.id} ballot={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
