import express, { Application, Request, Response } from "express";
import axios from "axios";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../.env") });

if (!process.env.TOKEN) {
  throw new Error("TOKEN environment variable is required");
}

const app: Application = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());

// Replace the custom CORS middleware with:
app.use(cors());

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
  req: Request;
  res: Response;
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
      : ESTIMATED_PROCESSING_TIME;

  const estimatedWaitTime = requestQueue.length * averageProcessingTime;

  res.json({
    queueLength: requestQueue.length,
    isProcessing,
    estimatedWaitTime,
    stats: {
      averageProcessingTime,
      totalProcessed: queueStats.totalProcessed,
    },
  });
});

// Function to process the queue
const processQueue = async (): Promise<void> => {
  if (isProcessing || requestQueue.length === 0) {
    return;
  }

  isProcessing = true;
  const { req, res } = requestQueue.shift()!;
  const startTime = Date.now();

  try {
    const {
      prompt,
      lengthSeconds = 60,
      seed = Math.floor(Math.random() * 1000),
    } = req.body;

    if (!prompt || typeof lengthSeconds !== "number") {
      res.status(400).json({
        error:
          "Invalid input: prompt (string) and lengthSeconds (number) are required",
      });
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

    // Send file with proper headers
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    // Use a stream to send the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    // Clean up file after sending
    fileStream.on("end", () => {
      fs.unlinkSync(filePath);
    });

    // Update statistics after successful processing
    const processingTime = Date.now() - startTime;
    queueStats.totalProcessed++;
    queueStats.totalProcessingTime += processingTime;
  } catch (error: any) {
    console.error(
      "Error generating audio:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Internal server error",
      details: error.response?.data || error.message,
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

// POST route for generating audio
app.post("/generate-audio", (req: Request, res: Response): void => {
  requestQueue.push({ req, res });
  processQueue();
});

export default app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}
