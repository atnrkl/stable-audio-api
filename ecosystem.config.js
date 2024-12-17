module.exports = {
  apps: [
    {
      name: "stable-audio-api",
      script: "./dist/server.js",
      env: {
        NODE_ENV: "production",
        PORT: "3001",
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
    },
  ],
};
