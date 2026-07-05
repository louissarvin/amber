import './dotenv.ts';

import Fastify from 'fastify';
import { APP_PORT, IS_DEV } from './src/config/main-config.ts';

const fastify = Fastify({ logger: { level: IS_DEV ? 'debug' : 'info' } });

fastify.get('/', async () => ({ success: true, message: 'AMBER backend online', error: null, data: null }));


const start = async (): Promise<void> => {
  try {
    await fastify.listen({ port: APP_PORT, host: '0.0.0.0' });
    console.log(`Server started on port ${APP_PORT}`);
  } catch (error) {
    console.log('Error starting server:', error);
    process.exit(1);
  }
};

start();
