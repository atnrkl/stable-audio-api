import request from "supertest";
import express from "express";
import axios from "axios";
import fs from "fs";
import path from "path";

// Mock external dependencies
jest.mock("axios");
jest.mock("fs");
jest.mock("path");

describe("Music Generation API", () => {
  let app: express.Application;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    // Set required env variable
    process.env.TOKEN = "test-token";
    // Import app fresh for each test
    jest.isolateModules(() => {
      app = require("../server").default;
    });
  });

  describe("GET /health", () => {
    it("should return status ok", async () => {
      const response = await request(app).get("/health");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok" });
    });
  });

  describe("POST /generate-audio", () => {
    let mockAxios: jest.Mock;

    beforeEach(() => {
      // Create a fresh mock for each test
      mockAxios = jest.fn();
      (axios as any).default = mockAxios;
      (axios as any).post = mockAxios;
    });

    it("should validate input parameters", async () => {
      const response = await request(app).post("/generate-audio").send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain(
        "prompt (string) and lengthSeconds (number) are required"
      );
    });

    it("should generate and return audio file", async () => {
      // First mock the API call
      mockAxios.mockResolvedValueOnce({
        data: {
          data: [
            {
              links: {
                result: "https://fake-url/audio.mp3",
              },
            },
          ],
        },
      });

      // Then mock the file download
      mockAxios.mockResolvedValueOnce({
        status: 200,
        data: {
          pipe: jest.fn().mockImplementation((writer) => {
            process.nextTick(() => writer.emit("finish"));
            return writer;
          }),
        },
      });

      // Mock file system operations
      const mockWriteStream = {
        on: jest.fn().mockImplementation((event: string, cb: () => void) => {
          if (event === "finish") process.nextTick(cb);
          return mockWriteStream;
        }),
        emit: jest.fn(),
      };

      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);
      (fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream);
      (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);
      (path.join as jest.Mock).mockReturnValue("/fake/path/audio.mp3");

      const response = await request(app).post("/generate-audio").send({
        prompt: "test music",
        lengthSeconds: 30,
      });

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(
        /application\/octet-stream/
      );
      expect(mockAxios).toHaveBeenCalledTimes(2);
    });

    it("should handle API errors", async () => {
      mockAxios.mockRejectedValueOnce(new Error("API Error"));

      const response = await request(app).post("/generate-audio").send({
        prompt: "test music",
        lengthSeconds: 30,
      });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe("Internal server error");
    });
  });
});
