import redis from 'ioredis';
import logger from './logger.config';

const redisClient = new redis(process.env.REDIS_URL!);
redisClient.on('error', (error) => {
  logger.error(`[Redis] Error: ${error}`);
});
export default redisClient;
