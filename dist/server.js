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
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const fs_2 = require("fs");
dotenv_1.default.config();
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, "../.env") });
if (!process.env.TOKEN) {
    throw new Error("TOKEN environment variable is required");
}
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use(express_1.default.json());
// API Configuration
const apiConfig = {
    allowedOrigins: ((_a = process.env.ALLOWED_ORIGINS) === null || _a === void 0 ? void 0 : _a.split(",")) || [
        "http://localhost:3000",
    ],
    allowedIPs: ((_b = process.env.ALLOWED_IPS) === null || _b === void 0 ? void 0 : _b.split(",")) || [],
    apiKeys: ((_c = process.env.API_KEYS) === null || _c === void 0 ? void 0 : _c.split(",")) || [],
    rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100,
    },
    audioRateLimit: {
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 10,
    },
};
// API Key middleware
const validateApiKey = (req, res, next) => {
    const apiKey = req.header("X-API-Key");
    if (!apiKey || !apiConfig.apiKeys.includes(apiKey)) {
        res.status(401).json({ error: "Invalid API key" });
        return;
    }
    next();
};
// IP validation middleware
const validateIP = (req, res, next) => {
    const clientIP = req.ip || req.socket.remoteAddress || "";
    if (apiConfig.allowedIPs.length > 0 &&
        !apiConfig.allowedIPs.includes(clientIP)) {
        res.status(403).json({ error: "IP not allowed" });
        return;
    }
    next();
};
// Replace the existing CORS setup with:
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        if (!origin)
            return callback(null, true);
        if (apiConfig.allowedOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
    exposedHeaders: ["Content-Disposition"],
    credentials: true,
}));
// Add request logging middleware
const logRequest = (req, res, next) => {
    const timestamp = new Date().toISOString();
    const { method, originalUrl, ip } = req;
    console.log(`[${timestamp}] ${method} ${originalUrl} - IP: ${ip}`);
    next();
};
app.use(logRequest);
// Update rate limiters with config
const limiter = (0, express_rate_limit_1.default)({
    windowMs: apiConfig.rateLimit.windowMs,
    max: apiConfig.rateLimit.max,
    message: { error: "Too many requests, please try again later" },
});
const audioLimiter = (0, express_rate_limit_1.default)({
    windowMs: apiConfig.audioRateLimit.windowMs,
    max: apiConfig.audioRateLimit.max,
    message: { error: "Audio generation limit reached, please try again later" },
});
// Apply security middleware
app.use((0, helmet_1.default)());
app.use(limiter);
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
app.get("/queue-status", validateApiKey, (req, res) => {
    const averageProcessingTime = queueStats.totalProcessed > 0
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
        yield logError(error);
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
app.post("/generate-audio", validateApiKey, validateIP, audioLimiter, (req, res) => {
    requestQueue.push({ req, res });
    processQueue();
});
// Add an endpoint to check API key validity
app.get("/verify-key", validateApiKey, (req, res) => {
    res.status(200).json({ status: "valid" });
});
function logError(error) {
    return __awaiter(this, void 0, void 0, function* () {
        const logDir = path_1.default.join(__dirname, "../logs");
        const logFile = path_1.default.join(logDir, "error.log");
        try {
            yield fs_2.promises.mkdir(logDir, { recursive: true });
            const timestamp = new Date().toISOString();
            const errorMessage = `[${timestamp}] ${error.stack || error}\n`;
            yield fs_2.promises.appendFile(logFile, errorMessage);
        }
        catch (e) {
            console.error("Failed to write to error log:", e);
        }
    });
}
exports.default = app;
if (require.main === module) {
    app.listen(Number(PORT), "0.0.0.0", () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
