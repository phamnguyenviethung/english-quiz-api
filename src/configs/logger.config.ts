import winston from 'winston';
import { DiscordTransport } from 'winston-transport-discord';
import NewRelicTransport from 'winston-newrelic-logs-transport';

const discordTransport = new DiscordTransport({
  discord: {
    bot: {
      token: process.env.DISCORD_BOT_TOKEN as string,
      channel: process.env.LOG_CHANNEL_ID as string
    }
  },
  level: 'warn'
});

const NEW_RELIC_LICENSE_KEY = process.env.NEW_RELIC_LICENSE_KEY;
const NEW_RELIC_API_URL = process.env.NEW_RELIC_API_URL ?? 'https://log-api.newrelic.com';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const transports: winston.transport[] = [new winston.transports.Console(), discordTransport];

if (IS_PRODUCTION) {
  if (NEW_RELIC_LICENSE_KEY) {
    transports.push(
      new NewRelicTransport({
        licenseKey: NEW_RELIC_LICENSE_KEY,
        apiUrl: NEW_RELIC_API_URL,
        batchSize: true,
        batchThrottle: true,
        format: winston.format.uncolorize()
      })
    );
  } else {
    console.warn('[Logger] NEW_RELIC_LICENSE_KEY chưa được cấu hình, bỏ qua New Relic log transport');
  }
}

const logger = winston.createLogger({
  defaultMeta: { 'service.name': 'englishQuiz' },
  format: winston.format.combine(
    winston.format.splat(),
    winston.format.timestamp({
      format: 'DD/MM HH:mm:ss'
    }),
    winston.format.colorize(),
    winston.format.printf((log: winston.Logform.TransformableInfo) => {
      if (log.stack) return `[${log.timestamp}] [${log.level}] ${log.stack}`;
      return `[${log.timestamp}] [${log.level}] ${log.message}`;
    })
  ),
  transports
});

logger.on('error', (err) => {
  console.error('[Logger] transport error:', err);
});

export default logger;
