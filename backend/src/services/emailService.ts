import { Resend } from "resend";
import { config } from "../config";

/**
 * Email notification service using Resend.
 *
 * To activate:
 * 1. Sign up at https://resend.com (free tier: 3,000 emails/month)
 * 2. Create an API key in the Resend dashboard
 * 3. Add RESEND_API_KEY=re_... to backend/.env
 * 4. Optionally add EMAIL_FROM=AnonVote <noreply@yourdomain.com>
 *
 * If RESEND_API_KEY is not set, all email functions are no-ops (silent skip).
 */

function getClient(): Resend | null {
  if (!config.resendApiKey) {
    return null;
  }
  return new Resend(config.resendApiKey);
}

// ── Email templates ───────────────────────────────────────────────────────────

function ballotCreatedHtml(
  orgName: string,
  topic: string,
  deadline: string,
  voterLink: string,
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;margin:0;padding:32px 16px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#1c7ed6,#339af0);padding:32px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">AnonVote</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">Private voting infrastructure</p>
    </div>
    <div style="padding:32px;">
      <h2 style="color:#1d1d1f;font-size:20px;margin:0 0 8px;">New ballot created</h2>
      <p style="color:#4a4a4f;font-size:14px;margin:0 0 24px;">Hi <strong>${orgName}</strong>, your ballot is now live and accepting votes.</p>

      <div style="background:#f5f5f7;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="color:#7a7a80;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 4px;font-family:monospace;">Ballot Topic</p>
        <p style="color:#1d1d1f;font-size:16px;font-weight:600;margin:0 0 16px;">${topic}</p>
        <p style="color:#7a7a80;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 4px;font-family:monospace;">Closes</p>
        <p style="color:#1d1d1f;font-size:14px;margin:0;">${deadline}</p>
      </div>

      <p style="color:#4a4a4f;font-size:14px;margin:0 0 16px;">Share this link with your eligible voters:</p>
      <a href="${voterLink}" style="display:block;background:#1c7ed6;color:white;text-decoration:none;padding:14px 24px;border-radius:10px;text-align:center;font-weight:700;font-size:14px;margin-bottom:24px;">
        Copy Voter Link →
      </a>
      <p style="color:#7a7a80;font-size:12px;word-break:break-all;margin:0;">${voterLink}</p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e0e0e5;text-align:center;">
      <p style="color:#7a7a80;font-size:12px;margin:0;">AnonVote · Private voting for organizations</p>
    </div>
  </div>
</body>
</html>`;
}

function ballotClosedHtml(
  orgName: string,
  topic: string,
  totalVotes: number,
  resultsLink: string,
): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;margin:0;padding:32px 16px;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#059669,#20c997);padding:32px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:24px;font-weight:700;">AnonVote</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">Results are ready</p>
    </div>
    <div style="padding:32px;">
      <h2 style="color:#1d1d1f;font-size:20px;margin:0 0 8px;">Ballot closed — results published</h2>
      <p style="color:#4a4a4f;font-size:14px;margin:0 0 24px;">Hi <strong>${orgName}</strong>, voting has ended and results are now available.</p>

      <div style="background:#f5f5f7;border-radius:10px;padding:20px;margin-bottom:24px;">
        <p style="color:#7a7a80;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 4px;font-family:monospace;">Ballot</p>
        <p style="color:#1d1d1f;font-size:16px;font-weight:600;margin:0 0 16px;">${topic}</p>
        <p style="color:#7a7a80;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin:0 0 4px;font-family:monospace;">Total Votes Cast</p>
        <p style="color:#1d1d1f;font-size:24px;font-weight:700;margin:0;">${totalVotes}</p>
      </div>

      <a href="${resultsLink}" style="display:block;background:#059669;color:white;text-decoration:none;padding:14px 24px;border-radius:10px;text-align:center;font-weight:700;font-size:14px;margin-bottom:24px;">
        View Results →
      </a>
      <p style="color:#7a7a80;font-size:12px;word-break:break-all;margin:0;">${resultsLink}</p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #e0e0e5;text-align:center;">
      <p style="color:#7a7a80;font-size:12px;margin:0;">AnonVote · Private voting for organizations</p>
    </div>
  </div>
</body>
</html>`;
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Send a ballot creation confirmation to the organization admin.
 * Includes the voter link to share with eligible voters.
 */
export async function sendBallotCreatedEmail(params: {
  to: string;
  orgName: string;
  topic: string;
  deadline: Date;
  ballotId: string;
}): Promise<void> {
  const client = getClient();
  if (!client) {
    console.log(
      "[Email] RESEND_API_KEY not set — skipping ballot created email",
    );
    return;
  }

  const voterLink = `${config.frontendOrigin}/vote/${params.ballotId}/token`;
  const deadline = params.deadline.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  try {
    const response = await client.emails.send({
      from: config.emailFrom,
      to: params.to,
      subject: `Ballot created: "${params.topic}"`,
      html: ballotCreatedHtml(
        params.orgName,
        params.topic,
        deadline,
        voterLink,
      ),
    });
    console.log(
      `[Email] Ballot created email sent to ${params.to} — response:`,
      JSON.stringify(response),
    );
  } catch (err) {
    console.error(
      "[Email] Failed to send ballot created email:",
      JSON.stringify(err),
    );
  }
}

/**
 * Send a results notification to the organization admin when a ballot closes.
 */
export async function sendBallotClosedEmail(params: {
  to: string;
  orgName: string;
  topic: string;
  totalVotes: number;
  ballotId: string;
}): Promise<void> {
  const client = getClient();
  if (!client) {
    console.log(
      "[Email] RESEND_API_KEY not set — skipping ballot closed email",
    );
    return;
  }

  const resultsLink = `${config.frontendOrigin}/results/${params.ballotId}`;

  try {
    await client.emails.send({
      from: config.emailFrom,
      to: params.to,
      subject: `Results published: "${params.topic}" — ${params.totalVotes} votes`,
      html: ballotClosedHtml(
        params.orgName,
        params.topic,
        params.totalVotes,
        resultsLink,
      ),
    });
    console.log(`[Email] Ballot closed email sent to ${params.to}`);
  } catch (err) {
    console.error("[Email] Failed to send ballot closed email:", err);
  }
}

/**
 * Send a voter token email containing the one-time token link.
 */
export async function sendVoterTokenEmail(params: {
  to: string;
  ballotId: string;
  token: string;
}): Promise<void> {
  const client = getClient();
  if (!client) {
    console.log("[Email] RESEND_API_KEY not set — skipping voter token email");
    return;
  }

  const voteLink = `${config.frontendOrigin}/vote/${params.ballotId}/token?token=${params.token}`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;">
  <h2 style="margin:0 0 8px">Your voter token</h2>
  <p style="margin:0 0 16px">Use the button below to open the voting page. This token is one-time use only.</p>
  <a href="${voteLink}" style="display:inline-block;background:#1c7ed6;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700;">Vote now</a>
  <p style="margin-top:12px;color:#6b7280;word-break:break-all;">Or paste this token into the voting page: <strong>${params.token}</strong></p>
</div>`;

  try {
    await client.emails.send({
      from: config.emailFrom,
      to: params.to,
      subject: `Your voting token for ballot ${params.ballotId}`,
      html,
    });
    console.log(`[Email] Voter token email sent to ${params.to}`);
  } catch (err) {
    console.error("[Email] Failed to send voter token email:", err);
    throw err;
  }
}
