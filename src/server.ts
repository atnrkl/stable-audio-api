import express, { Application, Request, Response, NextFunction } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { promises as fsPromises } from "fs";

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../.env") });

if (!process.env.TOKEN) {
  throw new Error("TOKEN environment variable is required");
}

const app: Application = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Add these new types
interface ApiConfig {
  allowedOrigins: string[];
  rateLimit: {
    windowMs: number;
    max: number;
  };
  audioRateLimit: {
    windowMs: number;
    max: number;
  };
}

// API Configuration
const apiConfig: ApiConfig = {
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",") || ["*"],
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100,
  },
  audioRateLimit: {
    windowMs: 60 * 60 * 1000,
    max: 10,
  },
};

// Replace the existing CORS setup with:
app.use(
  cors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, origin?: boolean) => void
    ) => {
      // If allowedOrigins includes "*", allow all origins
      if (apiConfig.allowedOrigins.includes("*")) {
        callback(null, true);
        return;
      }

      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        callback(null, true);
        return;
      }

      // Check if origin is in allowed list
      if (apiConfig.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Disposition"],
    credentials: true,
  })
);

// Add request logging middleware
const logRequest = (req: Request, res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  const { method, originalUrl, ip } = req;
  console.log(`[${timestamp}] ${method} ${originalUrl} - IP: ${ip}`);
  next();
};

app.use(logRequest);

// Update rate limiters with config
const limiter = rateLimit({
  windowMs: apiConfig.rateLimit.windowMs,
  max: apiConfig.rateLimit.max,
  message: { error: "Too many requests, please try again later" },
});

const audioLimiter = rateLimit({
  windowMs: apiConfig.audioRateLimit.windowMs,
  max: apiConfig.audioRateLimit.max,
  message: { error: "Audio generation limit reached, please try again later" },
});

// Apply security middleware
app.use(helmet());
app.use(limiter);

// Ensure the downloads directory exists
const ensureDownloadsDir = (): void => {
  const downloadsDir = path.join(__dirname, "../downloads");
  if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
    console.log("Created downloads directory:", downloadsDir);
  }
};

// Helper function to download a file
const downloadFile = async (url: string, filePath: string): Promise<void> => {
  let retryCount = 0;
  const maxRetries = 50;
  const retryDelay = 3000;

  while (retryCount < maxRetries) {
    const response = await axios({
      url,
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.TOKEN}`,
        Accept: "*/*",
      },
      responseType: "stream",
    });

    if (response.status === 200) {
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      console.log("File downloaded successfully!");
      return;
    } else if (response.status === 202) {
      console.log("Generation in progress, retrying...");
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retryCount++;
    } else {
      throw new Error(`Unexpected status: ${response.status}`);
    }
  }

  throw new Error("Maximum number of retries reached");
};

// Queue to manage requests
type QueueItem = {
  jobId?: string;
  req: Request;
  res: Response;
  onProgress?: (progress: string) => void;
};

const requestQueue: QueueItem[] = [];
let isProcessing = false;

// Add these types and constants
interface QueueStats {
  totalProcessed: number;
  totalProcessingTime: number;
}

const queueStats: QueueStats = {
  totalProcessed: 0,
  totalProcessingTime: 0,
};

const ESTIMATED_PROCESSING_TIME = 60000; // 60 seconds baseline

// Add queue status endpoint
app.get("/queue-status", (req: Request, res: Response) => {
  const averageProcessingTime =
    queueStats.totalProcessed > 0
      ? queueStats.totalProcessingTime / queueStats.totalProcessed
      : 60000;

  res.json({
    queueLength: requestQueue.length,
    isProcessing,
    estimatedWaitTime: requestQueue.length * averageProcessingTime,
    stats: {
      totalProcessed: queueStats.totalProcessed,
      averageProcessingTime,
    },
  });
});

// Add a map to store job statuses
const jobStatuses = new Map<
  string,
  {
    status: "processing" | "complete" | "error";
    result?: string;
    error?: string;
  }
>();

// Add near the top of the file, after other imports
const DEBUG = process.env.NODE_ENV !== "production";

// Add this function
function debugLog(...args: any[]) {
  if (DEBUG) {
    console.log("[Debug]", ...args);
  }
}

// Modify processQueue to include debug logging
const processQueue = async (): Promise<void> => {
  if (isProcessing || requestQueue.length === 0) {
    debugLog("Queue status:", {
      isProcessing,
      queueLength: requestQueue.length,
    });
    return;
  }

  isProcessing = true;
  const { jobId, req, res } = requestQueue.shift()!;
  debugLog("Processing job:", jobId);
  const startTime = Date.now();

  try {
    const {
      prompt,
      lengthSeconds = 60,
      seed = Math.floor(Math.random() * 1000),
    } = req.body;

    if (!prompt || typeof lengthSeconds !== "number") {
      jobStatuses.set(jobId!, { status: "error", error: "Invalid input" });
      return;
    }

    const response = await axios.post(
      "https://api.stableaudio.com/v1alpha/generations/stable-audio-audiosparx-v2-0/text-to-music",
      {
        data: {
          type: "generations",
          attributes: {
            prompts: [{ text: prompt, weight: 1 }],
            length_seconds: lengthSeconds,
            seed,
          },
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.TOKEN}`,
        },
      }
    );

    const resultUrl = response.data.data[0].links.result;
    const fileName = `audio_${Date.now()}.mp3`;
    const filePath = path.join(__dirname, "../downloads", fileName);

    ensureDownloadsDir();
    await downloadFile(resultUrl, filePath);

    jobStatuses.set(jobId!, {
      status: "complete",
      result: fileName,
    });

    // Update statistics
    const processingTime = Date.now() - startTime;
    queueStats.totalProcessed++;
    queueStats.totalProcessingTime += processingTime;

    debugLog("Job completed:", jobId);
  } catch (error: any) {
    debugLog("Job failed:", jobId, error);
    await logError(error);
    jobStatuses.set(jobId!, {
      status: "error",
      error: error.response?.data || error.message,
    });
  } finally {
    isProcessing = false;
    processQueue();
  }
};

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// 1. Start generation - update path
app.post("/api/generate-audio", audioLimiter, (req: Request, res: Response) => {
  const jobId = Date.now().toString();

  // Set initial job status
  jobStatuses.set(jobId, { status: "processing" });

  requestQueue.push({ jobId, req, res });
  processQueue();
  res.json({ jobId, status: "processing" });
});

// 2. Check status - update path
app.get(
  "/api/generate-audio/status/:jobId",
  (req: Request, res: Response): void => {
    const { jobId } = req.params;
    debugLog("Checking status for job:", jobId);
    const status = jobStatuses.get(jobId);
    debugLog("Current status:", status);

    if (!status) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    if (status.status === "complete") {
      const filePath = path.join(__dirname, "../downloads", status.result!);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${status.result}"`
      );
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      fileStream.on("end", () => {
        fs.unlinkSync(filePath);
        jobStatuses.delete(jobId);
      });
    } else {
      res.json(status);
    }
  }
);

async function logError(error: any) {
  const logDir = path.join(__dirname, "../logs");
  const logFile = path.join(logDir, "error.log");

  try {
    await fsPromises.mkdir(logDir, { recursive: true });
    const timestamp = new Date().toISOString();
    const errorMessage = `[${timestamp}] ${error.stack || error}\n`;
    await fsPromises.appendFile(logFile, errorMessage);
  } catch (e) {
    console.error("Failed to write to error log:", e);
  }
}

export default app;

if (require.main === module) {
  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
  });
}
