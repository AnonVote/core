import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchBallotResults, BallotResult } from '../api/ballots';
import { VerificationWidget } from '../components/VerificationWidget';

export const ResultsPage: React.FC = () => {
  const { ballotId } = useParams<{ ballotId: string }>();
  const [data, setData] = useState<BallotResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    if (!ballotId) return;
    fetchBallotResults(ballotId)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        const code = err.response?.status || 500;
        setErrorStatus(code);
        setLoading(false);
      });
  }, [ballotId]);

  if (loading) {
    return <div className="p-8 text-center text-gray-600">Loading verified election results...</div>;
  }

  if (errorStatus === 404) {
    return <div className="p-8 text-center text-red-600">404: Ballot not found.</div>;
  }

  if (errorStatus === 202) {
    return <div className="p-8 text-center text-amber-600">202: Ballot results are still being tallied. Please check back shortly.</div>;
  }

  if (errorStatus || !data) {
    return <div className="p-8 text-center text-red-600">Network or server error encountered while fetching results.</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6 flex justify-between items-center">
        <Link to="/" className="text-sm text-indigo-600 hover:underline">← Back to Ballots</Link>
        <span className="text-xs uppercase font-semibold bg-gray-100 px-3 py-1 rounded text-gray-600">
          Status: {data.status}
        </span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">{data.title}</h1>
      <p className="text-gray-600 mb-6">{data.description}</p>

      <div className="bg-white shadow rounded-lg p-6 border border-gray-200 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Final Tally</h2>
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Option</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Vote Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.tally.map((item, index) => (
              <tr key={index}>
                <td className="px-4 py-3 text-sm text-gray-900">{item.option}</td>
                <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">{item.votes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <VerificationWidget ballotId={data.ballotId} stellarTxHash={data.stellarTxHash} />
    </div>
  );
};
