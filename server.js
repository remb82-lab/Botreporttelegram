require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs-extra');

const app = express();
const PORT = process.env.PORT || 3000;

// Создаем необходимые директории
const directories = [
  'temp/excel',
  'temp/pdf',
  'temp/uploads',
  'storage/backups',
  'storage/users',
  'public'
];

directories.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirsSync(dirPath);
    console.log(`📁 Создана директория: ${dir}`);
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Отложенная инициализация бота (чтобы сервер запустился даже без токена)
let bot = null;
let botInitialized = false;

function initializeBot() {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN не указан. Бот не будет запущен.');
      return;
    }
    
    const ReportBot = require('./bot');
    bot = new ReportBot(process.env.TELEGRAM_BOT_TOKEN);
    botInitialized = true;
    console.log('🤖 Telegram бот инициализирован');
  } catch (error) {
    console.error('❌ Ошибка инициализации бота:', error.message);
  }
}

// Основной маршрут
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Telegram Report Bot</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          max-width: 800px;
          width: 100%;
        }
        h1 {
          color: #333;
          margin-bottom: 20px;
          text-align: center;
        }
        .status {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 5px;
          margin: 20px 0;
          border-left: 4px solid ${botInitialized ? '#28a745' : '#dc3545'};
        }
        .btn {
          display: inline-block;
          padding: 10px 20px;
          background: #2E8B57;
          color: white;
          text-decoration: none;
          border-radius: 5px;
          margin: 5px;
          transition: background 0.3s;
        }
        .btn:hover {
          background: #267c4d;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 Telegram Report Bot</h1>
        
        <div class="status">
          <h3>${botInitialized ? '✅ Система работает' : '⚠️ Требуется настройка'}</h3>
          <p><strong>Порт:</strong> ${PORT}</p>
          <p><strong>Статус бота:</strong> ${botInitialized ? 'Активен' : 'Неактивен'}</p>
          <p><strong>Время запуска:</strong> ${new Date().toLocaleString('ru-RU')}</p>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="/admin" class="btn">Панель администратора</a>
          <a href="/api/health" class="btn">API Health Check</a>
          <a href="/api/docs" class="btn">Документация API</a>
        </div>
        
        <div style="color: #666; text-align: center; margin-top: 30px;">
          <p>© ${new Date().getFullYear()} Telegram Report Bot System v1.1.0</p>
          ${!botInitialized ? '<p style="color: #dc3545;">Для работы бота настройте TELEGRAM_BOT_TOKEN в .env файле</p>' : ''}
        </div>
      </div>
    </body>
    </html>
  `);
});

// Админ-панель
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API Endpoints

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    bot: botInitialized ? 'running' : 'disabled',
    server: 'running',
    version: '1.1.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Статистика системы
app.get('/api/stats', (req, res) => {
  try {
    if (!bot) {
      return res.json({
        totalReports: 0,
        activeUsers: 0,
        todayReports: 0,
        botActive: false,
        message: 'Бот не инициализирован'
      });
    }
    
    const stats = bot.getStatistics ? bot.getStatistics() : {};
    const allReports = bot.getAllReports ? bot.getAllReports() : [];
    
    const today = new Date().toDateString();
    const todayReports = allReports.filter(report => {
      const reportDate = new Date(report.timestamp || report.date).toDateString();
      return reportDate === today;
    }).length;
    
    res.json({
      totalReports: stats.totalReports || 0,
      activeUsers: stats.uniqueUsers || 0,
      todayReports: todayReports,
      totalSockets: stats.totalSockets || 0,
      totalTrench: stats.totalTrench || 0,
      lastActivity: stats.lastActivity || 'нет данных',
      botActive: true
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получение всех отчётов
app.get('/api/reports', (req, res) => {
  try {
    if (!bot) {
      return res.status(503).json({ 
        error: 'Бот не инициализирован',
        reports: [] 
      });
    }
    
    const allReports = bot.getAllReports ? bot.getAllReports() : [];
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    
    const paginatedReports = allReports.slice(startIndex, endIndex);
    
    res.json({
      success: true,
      data: paginatedReports,
      pagination: {
        page,
        limit,
        total: allReports.length,
        totalPages: Math.ceil(allReports.length / limit)
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Экспорт в Excel
app.get('/api/export/excel', async (req, res) => {
  try {
    if (!bot) {
      return res.status(503).json({ error: 'Бот не инициализирован' });
    }
    
    const ExcelService = require('./src/services/excelService');
    const excelService = new ExcelService();
    
    const allReports = bot.getAllReports ? bot.getAllReports() : [];
    
    if (allReports.length === 0) {
      return res.status(404).json({ error: 'Нет данных для экспорта' });
    }
    
    const filePath = await excelService.generateSummaryReport(allReports, 'полный экспорт');
    
    res.download(filePath, `reports_export_${new Date().toISOString().split('T')[0]}.xlsx`, (err) => {
      if (err) {
        console.error('Ошибка отправки файла:', err);
      }
      // Удаляем временный файл после отправки
      setTimeout(() => {
        fs.unlink(filePath).catch(() => {});
      }, 5000);
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Получение пользователей
app.get('/api/users', (req, res) => {
  try {
    if (!bot || !bot.reportsStorage) {
      return res.json({ users: [] });
    }
    
    const users = [];
    for (const [chatId, reports] of bot.reportsStorage) {
      if (reports.length > 0) {
        const lastReport = reports[reports.length - 1];
        users.push({
          chatId,
          name: lastReport.employee || 'Неизвестно',
          reportsCount: reports.length,
          lastActivity: lastReport.timestamp || lastReport.date,
          lastReport: lastReport.customerName
        });
      }
    }
    
    res.json({ users });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Создание резервной копии
app.get('/api/backup', async (req, res) => {
  try {
    const ReportService = require('./src/services/reportService');
    const reportService = new ReportService();
    
    const backupPath = await reportService.createBackup();
    const fileName = path.basename(backupPath);
    
    res.download(backupPath, fileName, (err) => {
      if (err) {
        console.error('Ошибка отправки бэкапа:', err);
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Документация API
app.get('/api/docs', (req, res) => {
  res.json({
    endpoints: {
      'GET /': 'Главная страница',
      'GET /admin': 'Панель администратора',
      'GET /api/health': 'Проверка здоровья системы',
      'GET /api/stats': 'Статистика системы',
      'GET /api/reports': 'Список отчётов (с пагинацией)',
      'GET /api/export/excel': 'Экспорт всех отчётов в Excel',
      'GET /api/users': 'Список пользователей',
      'GET /api/backup': 'Создание резервной копии'
    }
  });
});

// Обработка 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    availableEndpoints: [
      '/', '/admin', '/api/health', '/api/stats', 
      '/api/reports', '/api/export/excel', '/api/docs'
    ]
  });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error('❌ Ошибка сервера:', err);
  res.status(500).json({
    error: 'Внутренняя ошибка сервера',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Запуск сервера
const server = app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 Веб-интерфейс: http://localhost:${PORT}`);
  console.log(`📊 API health check: http://localhost:${PORT}/api/health`);
  console.log(`👨‍💼 Админ-панель: http://localhost:${PORT}/admin`);
  
  // Инициализируем бота после запуска сервера
  setTimeout(initializeBot, 1000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Получен сигнал SIGTERM');
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 Получен сигнал SIGINT (Ctrl+C)');
  server.close(() => {
    console.log('✅ Сервер остановлен');
    process.exit(0);
  });
});
