const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
require("dotenv").config(); // To use environment variables

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON requests
app.use(express.json());

// Helper function to download file
const downloadFile = async (url, filePath) => {
  try {
    let response;
    let retryCount = 0;
    const maxRetries = 50;
    const retryDelay = 3000; // 3 seconds

    while (retryCount < maxRetries) {
      response = await axios({
        url: url,
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.TOKEN}`,
          Accept: "*/*",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "en-US,en;q=0.9",
        },
        responseType: "stream",
      });

      if (response.status === 200) {
        const writer = fs.createWriteStream(filePath);

        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
        });

        console.log("File downloaded successfully!");
        return;
      } else if (response.status === 202) {
        console.log("Generation in progress, retrying in 3 seconds...");
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        retryCount++;
      } else {
        console.error("Error downloading file:", response.status);
        return;
      }
    }

    console.error(
      "Maximum number of retries reached, unable to download file."
    );
  } catch (error) {
    console.error("Error downloading file:", error);
  }
};

// Route to generate audio
app.post("/generate-audio", async (req, res) => {
  try {
    const { prompt, lengthSeconds = 178, seed = 123 } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const options = {
      method: "POST",
      url: "https://api.stableaudio.com/v1alpha/generations/stable-audio-audiosparx-v2-0/text-to-music",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TOKEN}`,
      },
      data: {
        data: {
          type: "generations",
          attributes: {
            prompts: [
              {
                text: prompt,
                weight: 1,
              },
            ],
            length_seconds: lengthSeconds,
            seed: seed,
          },
        },
      },
    };

    const response = await axios(options);

    if (response.status === 200) {
      const resultUrl = response.data.data[0].links.result;
      const filePath = path.join(__dirname, "audio_file.mp3");
      await downloadFile(resultUrl, filePath);

      return res
        .status(200)
        .json({
          message: "Audio generated and downloaded successfully",
          filePath,
        });
    } else {
      return res
        .status(response.status)
        .json({ error: "Failed to generate audio", details: response.data });
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    return res
      .status(500)
      .json({ error: "Internal Server Error", details: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
