import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import organizationsRouter from "./routes/organizations";
import ballotsRouter from "./routes/ballots";
import eligibilityRouter from "./routes/eligibility";
import tokensRouter from "./routes/tokens";
import votesRouter from "./routes/votes";
import resultsRouter from "./routes/results";
import auditRouter from "./routes/audit";
import delegationsRouter from "./routes/delegations";
import verificationRouter from "./routes/verification";
import adminRouter from "./routes/admin";
import healthRouter from "./routes/health";

const app = express();

app.use(
  cors({
    origin: config.frontendOrigin,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

// Health check must be publicly accessible (no auth) and registered before any
// authenticated routes so monitoring systems and load balancers can probe it.
app.use("/api/health", healthRouter);

app.use("/api/organizations", organizationsRouter);
app.use("/api/ballots", ballotsRouter);
app.use("/api/eligibility", eligibilityRouter);
app.use("/api/tokens", tokensRouter);
app.use("/api/votes", votesRouter);
app.use("/api/results", resultsRouter);
app.use("/api/audit", auditRouter);
app.use("/api/delegations", delegationsRouter);
app.use("/api/verification", verificationRouter);
app.use("/api/admin", adminRouter);

app.use(errorHandler);

export default app;
