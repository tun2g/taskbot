import { RedisClientType, SetOptions } from 'redis';
import * as redis from 'redis';
import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';

export class RedisService {
  private instance: RedisClientType;

  constructor() {
    const { host, port, database } = configService.database.redis;
    const url = `redis://${host}:${port}/${database}`;

    this.instance = redis.createClient({ url });

    this.instance
      .connect()
      .then(() => {
        logger.info('Connected to Redis successfully');
      })
      .catch((err) => {
        logger.error(`Error connecting to Redis due to error: ${err}`);
      });
  }

  set(key: string, value: string, options?: SetOptions) {
    return this.instance.set(key, value, options);
  }

  get(key: string) {
    return this.instance.get(key);
  }

  del(key: string) {
    return this.instance.del(key);
  }

  hSet(key: string, field: string, value: string) {
    return this.instance.hSet(key, field, value);
  }

  hGet(key: string, field: string) {
    return this.instance.hGet(key, field);
  }

  expire(key: string, ttl: number) {
    return this.instance.expire(key, ttl);
  }

  incr(key: string) {
    return this.instance.incr(key);
  }

  ttl(key: string) {
    return this.instance.ttl(key);
  }

  lPush(key: string, value: string | string[]) {
    return this.instance.lPush(key, value);
  }

  lRange(key: string, start: number, stop: number) {
    return this.instance.lRange(key, start, stop);
  }

  lTrim(key: string, start: number, stop: number) {
    return this.instance.lTrim(key, start, stop);
  }

  lLen(key: string) {
    return this.instance.lLen(key);
  }
}

export const redisService = new RedisService();
