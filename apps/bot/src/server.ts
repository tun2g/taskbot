import express, { Express } from 'express';
import { errorHandler } from 'src/api/middlewares/error-handler.middleware';
import { apiRouter } from 'src/api/routes/index';
import { configService } from 'src/configs/configuration';

const app: Express = express();

app.use(express.json());

// CORS for the Mini App and the browser version (Bearer tokens via Authorization)
app.use((_req, res, next) => {
  const allowedOrigins = [configService.webappUrl, 'http://localhost:5173'].filter(Boolean);
  const origin = _req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, ngrok-skip-browser-warning');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Mount API routes
app.use('/api', apiRouter);

// Global error handler (must be last)
app.use(errorHandler);

export { app };
