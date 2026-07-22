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
import { subscriptionRoutes } from './src/routes/subscriptionRoutes.ts';
import { reportRoutes } from './src/routes/reportRoutes.ts';
import { sealRoutes } from './src/routes/sealRoutes.ts';
import { portraitRoutes } from './src/routes/portraitRoutes.ts';
import { socialRoutes } from './src/routes/socialRoutes.ts';
import { discoveryRoutes } from './src/routes/discoveryRoutes.ts';
import { agentMetaRoutes } from './src/routes/agentMetaRoutes.ts';
import { analyticsRoutes } from './src/routes/analyticsRoutes.ts';
import { graphRoutes } from './src/routes/graphRoutes.ts';
import { publicRoutes } from './src/routes/publicRoutes.ts';
import { demoRoutes } from './src/routes/demoRoutes.ts';
import { startErrorLogCleanupWorker } from './src/workers/errorLogCleanup.ts';
import { startAttestationBatcher } from './src/workers/attestationBatcher.ts';

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
fastify.register(subscriptionRoutes, { prefix: '/subscription' });
fastify.register(reportRoutes, { prefix: '/report' });
fastify.register(sealRoutes, { prefix: '/seal' });
fastify.register(portraitRoutes, { prefix: '/portrait' });
fastify.register(socialRoutes, { prefix: '/social' });
fastify.register(discoveryRoutes);
fastify.register(agentMetaRoutes);
fastify.register(analyticsRoutes, { prefix: '/analytics' });
fastify.register(graphRoutes, { prefix: '/graph' });
fastify.register(publicRoutes, { prefix: '/public' });
fastify.register(demoRoutes, { prefix: '/demo' });

const start = async (): Promise<void> => {
  try {
    startErrorLogCleanupWorker();
    startAttestationBatcher();
    await fastify.listen({ port: APP_PORT, host: '0.0.0.0' });
    console.log(`Server started on port ${APP_PORT}`);
  } catch (error) {
    console.log('Error starting server:', error);
    process.exit(1);
  }
};

start();
