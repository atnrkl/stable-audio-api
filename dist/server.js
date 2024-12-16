"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
dotenv_1.default.config();
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "../.env") });
if (!process.env.TOKEN) {
    throw new Error("TOKEN environment variable is required");
}
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use(express_1.default.json());
// Replace the custom CORS middleware with:
app.use((0, cors_1.default)());
// Ensure the downloads directory exists
const ensureDownloadsDir = () => {
    const downloadsDir = path_1.default.join(__dirname, "../downloads");
    if (!fs_1.default.existsSync(downloadsDir)) {
        fs_1.default.mkdirSync(downloadsDir, { recursive: true });
        console.log("Created downloads directory:", downloadsDir);
    }
};
// Helper function to download a file
const downloadFile = (url, filePath) => __awaiter(void 0, void 0, void 0, function* () {
    let retryCount = 0;
    const maxRetries = 50;
    const retryDelay = 3000;
    while (retryCount < maxRetries) {
        const response = yield (0, axios_1.default)({
            url,
            method: "GET",
            headers: {
                Authorization: `Bearer ${process.env.TOKEN}`,
                Accept: "*/*",
            },
            responseType: "stream",
        });
        if (response.status === 200) {
            const writer = fs_1.default.createWriteStream(filePath);
            response.data.pipe(writer);
            yield new Promise((resolve, reject) => {
                writer.on("finish", resolve);
                writer.on("error", reject);
            });
            console.log("File downloaded successfully!");
            return;
        }
        else if (response.status === 202) {
            console.log("Generation in progress, retrying...");
            yield new Promise((resolve) => setTimeout(resolve, retryDelay));
            retryCount++;
        }
        else {
            throw new Error(`Unexpected status: ${response.status}`);
        }
    }
    throw new Error("Maximum number of retries reached");
});
const requestQueue = [];
let isProcessing = false;
const queueStats = {
    totalProcessed: 0,
    totalProcessingTime: 0,
};
const ESTIMATED_PROCESSING_TIME = 60000; // 60 seconds baseline
// Add queue status endpoint
app.get("/queue-status", (req, res) => {
    const averageProcessingTime = queueStats.totalProcessed > 0
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
const processQueue = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    if (isProcessing || requestQueue.length === 0) {
        return;
    }
    isProcessing = true;
    const { req, res } = requestQueue.shift();
    const startTime = Date.now();
    try {
        const { prompt, lengthSeconds = 60, seed = Math.floor(Math.random() * 1000), } = req.body;
        if (!prompt || typeof lengthSeconds !== "number") {
            res.status(400).json({
                error: "Invalid input: prompt (string) and lengthSeconds (number) are required",
            });
            return;
        }
        const response = yield axios_1.default.post("https://api.stableaudio.com/v1alpha/generations/stable-audio-audiosparx-v2-0/text-to-music", {
            data: {
                type: "generations",
                attributes: {
                    prompts: [{ text: prompt, weight: 1 }],
                    length_seconds: lengthSeconds,
                    seed,
                },
            },
        }, {
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.TOKEN}`,
            },
        });
        const resultUrl = response.data.data[0].links.result;
        const fileName = `audio_${Date.now()}.mp3`;
        const filePath = path_1.default.join(__dirname, "../downloads", fileName);
        ensureDownloadsDir();
        yield downloadFile(resultUrl, filePath);
        // Send file with proper headers
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        // Use a stream to send the file
        const fileStream = fs_1.default.createReadStream(filePath);
        fileStream.pipe(res);
        // Clean up file after sending
        fileStream.on("end", () => {
            fs_1.default.unlinkSync(filePath);
        });
        // Update statistics after successful processing
        const processingTime = Date.now() - startTime;
        queueStats.totalProcessed++;
        queueStats.totalProcessingTime += processingTime;
    }
    catch (error) {
        console.error("Error generating audio:", ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
        res.status(500).json({
            error: "Internal server error",
            details: ((_b = error.response) === null || _b === void 0 ? void 0 : _b.data) || error.message,
        });
    }
    finally {
        isProcessing = false;
        processQueue();
    }
});
// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});
// POST route for generating audio
app.post("/generate-audio", (req, res) => {
    requestQueue.push({ req, res });
    processQueue();
});
exports.default = app;
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
