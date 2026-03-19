module.exports = {
  apps: [
    {
      name: "task-manager-backend",
      script: "./src/server.js",
      instances: "max",
      exec_mode: "cluster",
      watch: true,
      ignore_watch: ["node_modules", "logs"],
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },
      error_file: "./logs/err.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
