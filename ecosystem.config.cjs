module.exports = {
  apps: [
    {
      name: 'attendance',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      kill_timeout: 10000,
      listen_timeout: 10000,
      time: true,
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
