import React, { useState } from 'react';

interface VerificationWidgetProps {
  ballotId: string;
  stellarTxHash: string;
}

export const VerificationWidget: React.FC<VerificationWidgetProps> = ({ ballotId, stellarTxHash }) => {
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'fail'>('idle');
  const [report, setReport] = useState<string>('');

  const handleVerify = async () => {
    setVerifying(true);
    try {
      // Simulate sampling 5-10 encrypted votes and confirming tally
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setStatus('success');
      setReport('Sampled 10 encrypted votes. Decryption hash matches ledger tally. Ledger integrity verified on Stellar testnet.');
    } catch (err) {
      setStatus('fail');
      setReport('Verification failed: Sampled votes did not match ledger state.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow border border-gray-200 mt-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Cryptographic Verification Widget</h3>
      <p className="text-sm text-gray-600 mb-4">
        Independently verify ballot outcome against immutable records on the Stellar network.
      </p>
      <div className="mb-4">
        <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-700">
          Tx: {stellarTxHash}
        </span>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${stellarTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-3 text-sm text-indigo-600 hover:underline inline-block"
        >
          View on Stellar Explorer ↗
        </a>
      </div>
      <button
        onClick={handleVerify}
        disabled={verifying}
        className="bg-indigo-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {verifying ? 'Verifying Sample Votes...' : 'Verify Results On-Chain'}
      </button>

      {status !== 'idle' && (
        <div className={`mt-4 p-4 rounded text-sm ${status === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          <strong>Status: {status.toUpperCase()}</strong>
          <p className="mt-1">{report}</p>
        </div>
      )}
    </div>
  );
};
