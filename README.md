# Stable Audio API

## API Endpoints

### Generate Audio

`POST /generate-audio`

Generate music from a text prompt.

Request body:

```json
{
  "prompt": "Jazz fusion with smooth electric guitar",
  "lengthSeconds": 60,
  "seed": 12345 // optional
}
```

Response: Binary audio file (MP3) with headers:

```http
Content-Type: audio/mpeg
Content-Disposition: attachment; filename="audio_timestamp.mp3"
```

### Queue Status

`GET /queue-status`

Get current queue status.

Response:

```json
{
  "queueLength": 0,
  "isProcessing": false,
  "estimatedWaitTime": 0,
  "stats": {
    "averageProcessingTime": 60000,
    "totalProcessed": 0
  }
}
```

### Health Check

`GET /health`

Check API health.

Response:

```json
{
  "status": "ok"
}
```

## Queue System

- Requests are processed in FIFO (First In, First Out) order
- Each request is processed one at a time
- Estimated wait time is calculated based on queue length and average processing time
- Failed requests are removed from the queue and don't block subsequent requests

## Example Usage

### cURL

```bash
# Generate audio
curl -X POST http://localhost:3001/generate-audio \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Jazz fusion with smooth electric guitar",
    "lengthSeconds": 60
  }' \
  --output music.mp3

# Check queue status
curl http://localhost:3001/queue-status

# Check health
curl http://localhost:3001/health
```

### Node.js

```javascript
const axios = require("axios");
const fs = require("fs");

async function generateMusic(prompt, lengthSeconds = 60) {
  const response = await axios.post(
    "http://localhost:3001/generate-audio",
    {
      prompt,
      lengthSeconds,
    },
    {
      responseType: "stream",
    }
  );

  response.data.pipe(fs.createWriteStream("music.mp3"));
}
```

## Original Setup Instructions

[Previous instructions remain unchanged...]

## Error Responses

All endpoints return errors in this format:

```json
{
  "error": "Error message",
  "details": "Optional detailed error information"
}
```

Common HTTP status codes:

- 400: Bad Request (invalid input)
- 500: Internal Server Error
