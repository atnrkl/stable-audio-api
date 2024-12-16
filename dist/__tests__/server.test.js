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
const supertest_1 = __importDefault(require("supertest"));
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Mock external dependencies
jest.mock("axios");
jest.mock("fs");
jest.mock("path");
describe("Music Generation API", () => {
    let app;
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
        it("should return status ok", () => __awaiter(void 0, void 0, void 0, function* () {
            const response = yield (0, supertest_1.default)(app).get("/health");
            expect(response.status).toBe(200);
            expect(response.body).toEqual({ status: "ok" });
        }));
    });
    describe("POST /generate-audio", () => {
        let mockAxios;
        beforeEach(() => {
            // Create a fresh mock for each test
            mockAxios = jest.fn();
            axios_1.default.default = mockAxios;
            axios_1.default.post = mockAxios;
        });
        it("should validate input parameters", () => __awaiter(void 0, void 0, void 0, function* () {
            const response = yield (0, supertest_1.default)(app).post("/generate-audio").send({});
            expect(response.status).toBe(400);
            expect(response.body.error).toContain("prompt (string) and lengthSeconds (number) are required");
        }));
        it("should generate and return audio file", () => __awaiter(void 0, void 0, void 0, function* () {
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
                on: jest.fn().mockImplementation((event, cb) => {
                    if (event === "finish")
                        process.nextTick(cb);
                    return mockWriteStream;
                }),
                emit: jest.fn(),
            };
            fs_1.default.existsSync.mockReturnValue(true);
            fs_1.default.mkdirSync.mockReturnValue(undefined);
            fs_1.default.createWriteStream.mockReturnValue(mockWriteStream);
            fs_1.default.unlinkSync.mockReturnValue(undefined);
            path_1.default.join.mockReturnValue("/fake/path/audio.mp3");
            const response = yield (0, supertest_1.default)(app).post("/generate-audio").send({
                prompt: "test music",
                lengthSeconds: 30,
            });
            expect(response.status).toBe(200);
            expect(response.headers["content-type"]).toMatch(/application\/octet-stream/);
            expect(mockAxios).toHaveBeenCalledTimes(2);
        }));
        it("should handle API errors", () => __awaiter(void 0, void 0, void 0, function* () {
            mockAxios.mockRejectedValueOnce(new Error("API Error"));
            const response = yield (0, supertest_1.default)(app).post("/generate-audio").send({
                prompt: "test music",
                lengthSeconds: 30,
            });
            expect(response.status).toBe(500);
            expect(response.body.error).toBe("Internal server error");
        }));
    });
});
