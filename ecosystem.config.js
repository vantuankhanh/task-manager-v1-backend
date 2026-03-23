module.exports = {
  apps: [
    {
      name: "task-manager-v1-backend",
      script: "./src/server.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },

      // ── Logging ──────────────────────────────────
      output: "./logs/out.log",
      error: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      // ── Auto Restart Behavior ────────────────────
      watch: false, // set true in dev to auto-reload on file change
      max_memory_restart: "1G", // restart if RAM exceeds 1GB
      restart_delay: 3000, // wait 3s before restart

      // ── Graceful Shutdown ────────────────────────
      kill_timeout: 5000, // wait 5s before force kill
      wait_ready: true, // wait for app to signal ready
      listen_timeout: 10000, // wait 10s for app to start listening
    },
  ],
};
