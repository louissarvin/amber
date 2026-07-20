import './dotenv.ts';

import Fastify from 'fastify';
import FastifyCors from '@fastify/cors';
import FastifyHelmet from '@fastify/helmet';
import FastifyRateLimit from '@fastify/rate-limit';
import { APP_PORT, IS_DEV } from './src/config/main-config.ts';
import { redis } from './src/lib/redis.ts';
import { healthRoutes } from './src/routes/healthRoutes.ts';
import { memoryRoutes } from './src/routes/memoryRoutes.ts';
import { mcpRoutes } from './src/routes/mcpTransport.ts';
import { adminRoutes } from './src/routes/adminRoutes.ts';
import { attestationRoutes } from './src/routes/attestationRoutes.ts';
import { identityRoutes } from './src/routes/identityRoutes.ts';

const fastify = Fastify({ logger: { level: IS_DEV ? 'debug' : 'info' } });

fastify.register(FastifyHelmet, { contentSecurityPolicy: false });
fastify.register(FastifyCors, { origin: '*' });
fastify.register(FastifyRateLimit, { global: true, max: 200, timeWindow: '1 minute', redis });

fastify.get('/', async () => ({ success: true, message: 'AMBER backend online', error: null, data: null }));

fastify.register(healthRoutes);
fastify.register(memoryRoutes, { prefix: '/memory' });
fastify.register(mcpRoutes, { prefix: '/mcp' });
fastify.register(adminRoutes, { prefix: '/admin' });
fastify.register(attestationRoutes, { prefix: '/attestation' });
fastify.register(identityRoutes, { prefix: '/identity' });

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
