module.exports = {
  apps: [
    {
      name: 'osigermin-Scoop',
      script: 'server.js',
      instances: 1,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3006,
        START_DATE: '01/09/2025',
        SAVE_SCREENSHOTS: 'false',
        SAVE_LIGHT: '1'
      },
      env_development: {
        NODE_ENV: 'development'
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      combine_logs: true,
      time: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    }
  ]
};