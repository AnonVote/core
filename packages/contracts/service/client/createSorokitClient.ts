import type { SorokitResult } from "../shared/response";

export interface SorokitNetworkConfig {
  rpcUrl: string;
  networkPassphrase: string;
}

export interface SorokitInvokeRequest {
  contractId: string;
  method: string;
  args: unknown[];
  networkPassphrase: string;
  sourceAccount: string;
  timeoutMs?: number;
}

export interface SorokitClient {
  networkConfig: SorokitNetworkConfig;
  soroban: {
    invoke(
      request: SorokitInvokeRequest,
      sign: (xdr: string) => Promise<SorokitResult<string>>,
    ): Promise<SorokitResult<string>>;
  };
}

export type Client = SorokitClient;
