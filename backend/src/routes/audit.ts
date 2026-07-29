import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../prisma/client";
import { requireAuth } from "../middleware/auth";
import { badRequest, notFound } from "../utils/errors";

const router = Router();

// GET /api/audit/:ballotId — Public: audit event counts + event log
router.get(
  "/:ballotId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ballotId } = req.params;

      const [tokensIssued, votesCast, events] = await Promise.all([
        prisma.auditEvent.count({
          where: { ballotId, eventType: "TOKEN_ISSUED" },
        }),
        prisma.auditEvent.count({
          where: { ballotId, eventType: "VOTE_CAST" },
        }),
        prisma.auditEvent.findMany({
          where: { ballotId },
          select: {
            eventType: true,
            stellarTxId: true,
            stellarLedgerAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" },
        }),
      ]);

      res.status(200).json({
        data: { ballotId, tokensIssued, votesCast, events },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/admin/audit/:ballotId — Admin: full structured export (JSON or CSV)
// Mounted separately in app.ts as /api/admin/audit/:ballotId
// Exported as a named function to be wired by the admin audit sub-router.
export async function adminAuditHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { ballotId } = req.params;
    const format = (req.query.format as string) ?? "json";

    if (!["json", "csv"].includes(format)) {
      throw badRequest("format must be 'json' or 'csv'");
    }

    // Verify ownership
    const ballot = await prisma.ballot.findUnique({
      where: { id: ballotId },
      include: { options: true },
    });
    if (!ballot) throw notFound("Ballot not found");
    if (ballot.organizationId !== req.organization!.id)
      throw badRequest("You can only export audit data for your own ballots");

    // Gather full data
    const [events, result, tokensIssued, voterTokens] = await Promise.all([
      prisma.auditEvent.findMany({
        where: { ballotId },
        orderBy: { createdAt: "asc" },
      }),
      prisma.result.findUnique({ where: { ballotId } }),
      prisma.auditEvent.count({
        where: { ballotId, eventType: "TOKEN_ISSUED" },
      }),
      prisma.voterToken.count({ where: { ballotId } }),
    ]);

    const votesCast = events.filter((e) => e.eventType === "VOTE_CAST").length;
    const participationRate =
      voterTokens > 0
        ? Math.round((votesCast / voterTokens) * 10000) / 100
        : 0;

    // Vote count timeline: rolling totals of VOTE_CAST events
    const voteCounts = events
      .filter((e) => e.eventType === "VOTE_CAST")
      .reduce<{ timestamp: string; cumulativeVotes: number }[]>(
        (acc, e, idx) => {
          acc.push({
            timestamp: e.createdAt.toISOString(),
            cumulativeVotes: idx + 1,
          });
          return acc;
        },
        [],
      );

    // Deduplicated Stellar tx IDs
    const stellarTransactions = [
      ...new Set(
        [
          ...events.map((e) => e.stellarTxId),
          result?.stellarTxId,
          result?.sorobanTxId,
        ].filter(Boolean),
      ),
    ];

    const summary = {
      ballotId: ballot.id,
      topic: ballot.topic,
      status: ballot.status,
      deadline: ballot.deadline.toISOString(),
      totalOptions: ballot.options.length,
      tokensIssued,
      votesCast,
      participationRate,
      isConsistent: result?.isConsistent ?? null,
      totalVotes: result?.totalVotes ?? 0,
      finalised: result?.finalised ?? false,
      finalisedAt: result?.finalisedAt?.toISOString() ?? null,
      stellarTxId: result?.stellarTxId ?? null,
      sorobanTxId: result?.sorobanTxId ?? null,
    };

    if (format === "csv") {
      const csvRows = [
        // Headers
        "eventType,createdAt,stellarTxId,stellarLedgerAt",
        // Rows
        ...events.map((e) =>
          [
            e.eventType,
            e.createdAt.toISOString(),
            e.stellarTxId ?? "",
            e.stellarLedgerAt?.toISOString() ?? "",
          ]
            .map((v) => `"${v}"`)
            .join(","),
        ),
      ];

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-${ballotId}.csv"`,
      );
      return res.status(200).send(csvRows.join("\n"));
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-${ballotId}.json"`,
    );
    res.status(200).json({
      data: {
        summary,
        eventLog: events,
        voteCounts,
        stellarTransactions,
      },
    });
  } catch (err) {
    next(err);
  }
}

export default router;
