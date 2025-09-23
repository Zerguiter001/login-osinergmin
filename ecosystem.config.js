module.exports = {
  apps: [
    {
      name: 'osigermin-Scoop',
      script: 'server.js',
      instances: 1, // Usa 1 instancia para evitar problemas con Puppeteer
      exec_mode: 'fork', // Modo fork para aplicaciones simples
      watch: false, // No reiniciar si cambian archivos en producción
      max_memory_restart: '1G', // Reiniciar si el uso de memoria excede 1GB
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      env_development: {
        NODE_ENV: 'development'
      },
      out_file: './logs/out.log', // Archivo para logs de consola
      error_file: './logs/error.log', // Archivo para logs de errores
      combine_logs: true, // Combinar logs de todas las instancias
      time: true, // Agregar timestamp a los logs
      autorestart: true, // Reiniciar automáticamente si la app falla
      max_restarts: 10, // Máximo número de reinicios en caso de fallo
      restart_delay: 5000, // Esperar 5 segundos antes de reiniciar
    }
  ]
};