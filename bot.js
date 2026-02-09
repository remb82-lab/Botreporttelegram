const TelegramBot = require('node-telegram-bot-api');
const ReportHandler = require('./src/handlers/reportHandler');
const CommandHandler = require('./src/handlers/commandHandler');
const ExcelService = require('./src/services/excelService');
const EmailService = require('./src/services/emailService');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');

class ReportBot {
  constructor(token, options = {}) {
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN не указан в .env файле');
    }
    
    this.bot = new TelegramBot(token, { 
      polling: options.polling !== false,
      request: {
        timeout: 60000,
        url: 'https://api.telegram.org'
      }
    });
    
    // Сервисы
    this.excelService = new ExcelService();
    this.emailService = new EmailService();
    
    // Инициализация обработчиков с передачей this
    this.reportHandler = new ReportHandler(this.bot, this);
    this.commandHandler = new CommandHandler(this.bot, this);
    
    // Хранилища
    this.userSessions = new Map();
    this.reportsStorage = new Map();
    
    this.setupHandlers();
    console.log('✅ Бот инициализирован');
  }

  setupHandlers() {
    // Команды
    this.bot.onText(/\/start/, (msg) => this.commandHandler.handleStart(msg));
    this.bot.onText(/\/new_report/, (msg) => this.reportHandler.startNewReport(msg));
    this.bot.onText(/\/my_reports/, (msg) => this.commandHandler.handleMyReports(msg));
    this.bot.onText(/\/excel/, (msg) => this.commandHandler.handleExcelExport(msg));
    this.bot.onText(/\/summary/, (msg) => this.commandHandler.handleDailySummary(msg));
    this.bot.onText(/\/help/, (msg) => this.commandHandler.handleHelp(msg));
    this.bot.onText(/\/stats/, (msg) => this.commandHandler.handleStats(msg));
    this.bot.onText(/\/admin/, (msg) => this.commandHandler.handleAdmin(msg));
    
    // Обработка callback-ов
    this.bot.on('callback_query', (callbackQuery) => {
      this.reportHandler.handleCallbackQuery(callbackQuery);
    });

    // Обработка текстовых сообщений
    this.bot.on('message', (msg) => {
      if (!msg.text) return;
      if (!msg.text.startsWith('/')) {
        this.reportHandler.handleMessage(msg);
      }
    });

    // Обработка ошибок
    this.bot.on('polling_error', (error) => {
      console.error('❌ Ошибка polling:', error.message);
    });

    this.bot.on('error', (error) => {
      console.error('❌ Общая ошибка бота:', error.message);
    });

    console.log('✅ Обработчики бота настроены');
  }

  // Метод для отправки отчётов (используется другими модулями)
  async sendReportToChannels(reportData, chatId) {
    try {
      console.log(`📤 Отправка отчёта от пользователя ${chatId}`);
      
      // 1. Сохраняем отчёт
      const savedReport = this.saveReport(chatId, reportData);
      
      // 2. Отправка пользователю
      const userMessage = this.formatReportForUser(reportData);
      await this.bot.sendMessage(chatId, userMessage, { 
        parse_mode: 'HTML',
        disable_web_page_preview: true 
      });

      // 3. Отправка администратору на email
      if (this.emailService.transporter) {
        const emailSent = await this.emailService.sendReport(reportData);
        if (emailSent) {
          await this.bot.sendMessage(chatId, '📧 Отчёт отправлен на email администратора');
        }
      }

      // 4. Генерация Excel
      try {
        await this.bot.sendMessage(chatId, '📊 Генерация Excel файла...');
        const excelPath = await this.excelService.generateSingleReport(reportData);
        
        await this.bot.sendDocument(chatId, excelPath, {
          caption: '📊 Ваш отчёт в формате Excel'
        });
        
        // Очищаем временный файл
        await fs.unlink(excelPath).catch(() => {});
        
      } catch (excelError) {
        console.error('Ошибка генерации Excel:', excelError);
        await this.bot.sendMessage(chatId, '⚠️ Не удалось сгенерировать Excel файл');
      }

      // 5. Отправка в канал (если настроен)
      if (process.env.TELEGRAM_CHANNEL_ID && process.env.TELEGRAM_CHANNEL_ID.startsWith('@')) {
        try {
          const channelMessage = this.formatReportForChannel(reportData);
          await this.bot.sendMessage(process.env.TELEGRAM_CHANNEL_ID, channelMessage, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
          });
          await this.bot.sendMessage(chatId, '📢 Отчёт опубликован в канале');
        } catch (channelError) {
          console.error('Ошибка отправки в канал:', channelError.message);
        }
      }

      console.log(`✅ Отчёт успешно обработан для пользователя ${chatId}`);
      return savedReport;

    } catch (error) {
      console.error('❌ Критическая ошибка отправки отчёта:', error);
      await this.bot.sendMessage(chatId, 
        '⚠️ Произошла ошибка при отправке отчёта. Основные данные сохранены.'
      );
      return null;
    }
  }

  formatReportForUser(data) {
    const totalItems = (data.sockets || 0) + (data.koBig || 0) + 
                      (data.koSmall || 0) + (data.manholes || 0);
    const totalLength = (data.vok1 || 0) + (data.boxes || 0) + 
                       (data.corrugation || 0) + (data.trench || 0);

    let message = `<b>📊 ВАШ ОТЧЁТ УСПЕШНО СОХРАНЁН</b>\n\n`;

    message += `<b>🏢 Заказчик:</b> ${data.customerType === 'абонент' ? 'Абонент' : 'Юридическое лицо'}\n`;
    message += `<b>📝 Название:</b> ${data.customerName}\n`;
    message += `<b>📍 Адрес:</b> ${data.address}\n`;
    message += `<b>📞 Телефон:</b> ${data.phone}\n`;
    message += `<b>👷 Сотрудник:</b> ${data.employee}\n`;
    message += `<b>📅 Дата:</b> ${data.date}\n\n`;

    message += `<b>🔧 Монтажные работы:</b>\n`;
    message += `• Розетки: <b>${data.sockets}</b> шт.\n`;
    message += `• ВОК1: <b>${data.vok1}</b> м\n`;
    message += `• Коробы: <b>${data.boxes}</b> м\n`;
    message += `• Гофра: <b>${data.corrugation}</b> м\n`;
    message += `• КО большая: <b>${data.koBig}</b> шт.\n`;
    message += `• КО малая: <b>${data.koSmall}</b> шт.\n`;
    message += `• Минимуфта: <b>${data.minimuff ? '✅ сварена' : '❌ не сварена'}</b>\n\n`;

    message += `<b>🏗️ Земляные работы:</b>\n`;
    message += `• Траншея: <b>${data.trench}</b> м\n`;
    message += `• Колодцы: <b>${data.manholes}</b> шт.\n\n`;

    if (data.comment && data.comment !== 'нет') {
      message += `<b>💬 Комментарий:</b>\n${data.comment}\n\n`;
    }

    message += `<b>📈 ИТОГО:</b>\n`;
    message += `• Всего элементов: <b>${totalItems}</b> шт.\n`;
    message += `• Общая длина: <b>${totalLength.toFixed(2)}</b> м\n\n`;

    message += `<i>Отчёт сохранён в системе.</i>`;

    return message;
  }

  formatReportForChannel(data) {
    const totalItems = (data.sockets || 0) + (data.manholes || 0);
    
    return `<b>📊 НОВЫЙ ОТЧЁТ О РАБОТАХ</b>\n\n` +
           `<b>Заказчик:</b> ${data.customerName}\n` +
           `<b>Адрес:</b> ${data.address}\n` +
           `<b>Сотрудник:</b> ${data.employee}\n\n` +
           `<b>Основные показатели:</b>\n` +
           `• Розетки: ${data.sockets} шт.\n` +
           `• Траншея: ${data.trench} м\n` +
           `• Колодцы: ${data.manholes} шт.\n` +
           `• Всего элементов: ${totalItems} шт.\n\n` +
           `<b>Дата:</b> ${data.date}\n\n` +
           `#отчет #${data.employee.replace(/\s+/g, '_')}`;
  }

  saveReport(chatId, data) {
    if (!this.reportsStorage.has(chatId)) {
      this.reportsStorage.set(chatId, []);
    }
    
    const userReports = this.reportsStorage.get(chatId);
    const reportWithId = {
      ...data,
      id: Date.now(),
      chatId: chatId,
      timestamp: new Date().toISOString()
    };
    
    userReports.push(reportWithId);
    
    // Сохраняем в файл для резервного копирования
    const backupPath = path.join(__dirname, 'storage', `reports_${chatId}.json`);
    try {
      fs.writeJsonSync(backupPath, userReports, { spaces: 2 });
    } catch (error) {
      console.error('Ошибка сохранения резервной копии:', error);
    }
    
    return reportWithId;
  }

  getUserReports(chatId) {
    return this.reportsStorage.get(chatId) || [];
  }

  getAllReports() {
    const allReports = [];
    for (const [chatId, reports] of this.reportsStorage) {
      allReports.push(...reports.map(r => ({ ...r, chatId })));
    }
    return allReports;
  }

  getStatistics() {
    const allReports = this.getAllReports();
    const totalReports = allReports.length;
    const totalSockets = allReports.reduce((sum, r) => sum + (r.sockets || 0), 0);
    const totalTrench = allReports.reduce((sum, r) => sum + (r.trench || 0), 0);
    const uniqueUsers = new Set(allReports.map(r => r.chatId)).size;
    
    return {
      totalReports,
      totalSockets,
      totalTrench,
      uniqueUsers,
      lastActivity: allReports.length > 0 ? 
        new Date(allReports[0].timestamp).toLocaleString('ru-RU') : 
        'нет данных'
    };
  }
}

module.exports = ReportBot;
