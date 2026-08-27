/**
 * Vote Validation Middleware Tests
 * 
 * Tests request validation to ensure malformed or malicious payloads
 * are rejected before reaching the database or business logic.
 */

import request from "supertest";
import express, { Application } from "express";
import { errorHandler } from "../middleware/errorHandler";
import {
  validateVotePayload,
  validatePayloadSize,
  validateContentType,
  validateVoteRequest,
} from "../middleware/voteValidation";

describe("Vote Validation Middleware", () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
  });

  describe("validateVotePayload", () => {
    beforeEach(() => {
      app.post("/test", validateVotePayload, (req, res) => {
        res.status(200).json({ success: true });
      });
      app.use(errorHandler);
    });

    it("accepts valid vote payload with all required fields", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("accepts snake_case field names", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballot_id: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          option_id: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(200);
    });

    it("accepts voterToken as alias for token", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          voterToken: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(200);
    });

    it("accepts optional weight field", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
          weight: 5,
        });

      expect(res.status).toBe(200);
    });

    it("accepts optional rank field", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
          rank: 2,
        });

      expect(res.status).toBe(200);
    });

    it("rejects missing ballot_id", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
      expect(res.body.message).toContain("ballot_id is required");
    });

    it("rejects empty ballot_id", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "   ",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("ballot_id cannot be empty");
    });

    it("rejects invalid UUID format for ballot_id", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "not-a-valid-uuid",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("ballot_id must be a valid UUID");
    });

    it("rejects missing token", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("token is required");
    });

    it("rejects empty token", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("token cannot be empty");
    });

    it("rejects invalid token format", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "invalid token with spaces!",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("token has invalid format");
    });

    it("rejects missing option_id", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("option_id is required");
    });

    it("rejects invalid UUID format for option_id", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "invalid-option-id",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("option_id must be a valid UUID");
    });

    it("rejects negative weight", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
          weight: -5,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("weight cannot be negative");
    });

    it("rejects weight exceeding maximum", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
          weight: 1000001,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("weight exceeds maximum");
    });

    it("rejects non-numeric weight", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
          weight: "not-a-number",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("weight must be a valid number");
    });

    it("rejects rank less than 1", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
          rank: 0,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("rank must be at least 1");
    });

    it("rejects rank exceeding maximum", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
          rank: 101,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("rank exceeds maximum");
    });

    it("rejects non-integer rank", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
          rank: 2.5,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("rank must be an integer");
    });

    it("validates encrypted_option length bounds", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
          encryptedOption: "x".repeat(5000), // Exceeds MAX_ENCRYPTED_VOTE_LENGTH
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("encrypted_option length must be between");
    });

    it("reports multiple validation errors", async () => {
      const res = await request(app)
        .post("/test")
        .send({
          ballotId: "invalid-uuid",
          token: "short",
          optionId: "also-invalid",
          weight: -10,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
      // Should contain multiple error messages
      expect(res.body.message).toContain("ballot_id");
      expect(res.body.message).toContain("token");
      expect(res.body.message).toContain("option_id");
      expect(res.body.message).toContain("weight");
    });
  });

  describe("validatePayloadSize", () => {
    beforeEach(() => {
      app.post("/test", validatePayloadSize, (req, res) => {
        res.status(200).json({ success: true });
      });
      app.use(errorHandler);
    });

    it("accepts payload within size limit", async () => {
      const res = await request(app).post("/test").send({ data: "test" });

      expect(res.status).toBe(200);
    });

    it("rejects payload exceeding size limit", async () => {
      const originalMaxSize = process.env.MAX_VOTE_PAYLOAD_SIZE;
      process.env.MAX_VOTE_PAYLOAD_SIZE = "100"; // Set very small limit

      try {
        // Let superagent set the real Content-Length; the body itself is
        // comfortably over the 100-byte limit.
        const res = await request(app)
          .post("/test")
          .send({ data: "x".repeat(10000) });

        expect(res.status).toBe(413);
        expect(res.body.error).toBe("PAYLOAD_TOO_LARGE");
      } finally {
        // Restore unconditionally — a failed assertion must not leak the
        // shrunken limit into every subsequent test.
        if (originalMaxSize) {
          process.env.MAX_VOTE_PAYLOAD_SIZE = originalMaxSize;
        } else {
          delete process.env.MAX_VOTE_PAYLOAD_SIZE;
        }
      }
    });

    it("allows request without Content-Length header", async () => {
      // Request without explicit Content-Length should pass
      // (Express will handle it)
      const res = await request(app).post("/test").send({ data: "test" });

      expect(res.status).toBe(200);
    });
  });

  describe("validateContentType", () => {
    beforeEach(() => {
      app.post("/test", validateContentType, (req, res) => {
        res.status(200).json({ success: true });
      });
      app.use(errorHandler);
    });

    it("accepts application/json content type", async () => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ data: "test" }));

      expect(res.status).toBe(200);
    });

    it("accepts application/json with charset", async () => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "application/json; charset=utf-8")
        .send(JSON.stringify({ data: "test" }));

      expect(res.status).toBe(200);
    });

    it("rejects missing content type", async () => {
      const res = await request(app).post("/test").send("data");

      expect(res.status).toBe(415);
      expect(res.body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("rejects non-JSON content type", async () => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "text/plain")
        .send("plain text data");

      expect(res.status).toBe(415);
      expect(res.body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
    });
  });

  describe("validateVoteRequest (combined)", () => {
    beforeEach(() => {
      app.post("/test", validateVoteRequest, (req, res) => {
        res.status(200).json({ success: true });
      });
      app.use(errorHandler);
    });

    it("applies all validations in order", async () => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "application/json")
        .send({
          ballotId: "123e4567-e89b-42d3-a456-426614174000",
          token: "abcdefghijklmnopqrstuvwxyz123456",
          optionId: "123e4567-e89b-42d3-a456-426614174001",
        });

      expect(res.status).toBe(200);
    });

    it("fails fast on content type validation", async () => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "text/plain")
        .send("not json");

      expect(res.status).toBe(415);
      expect(res.body.error).toBe("UNSUPPORTED_MEDIA_TYPE");
    });

    it("validates payload after content type check", async () => {
      const res = await request(app)
        .post("/test")
        .set("Content-Type", "application/json")
        .send({
          ballotId: "invalid-uuid",
          // Missing required fields
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });
  });
});
