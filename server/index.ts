import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { getTtsReadiness, listVoices, synthesizeSpeech } from './audio.js';
import { appendSections, cancelExportJob, createExportDownload, createExportJob, getExportJob } from './export-jobs.js';
import { validateAppendSectionsPayload, validateCreateExportJobPayload, validateSpeakPayload } from './validation.js';

export interface LuminaServerOptions {
  staticDir?: string;
  corsEnabled?: boolean;
}

export function createLuminaApp(options: LuminaServerOptions = {}) {
  const app = express();
  const staticDir = options.staticDir;
  const corsEnabled = options.corsEnabled ?? true;

  if (corsEnabled) {
    app.use(cors());
  }

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/readiness', (_req, res) => {
    const readiness = getTtsReadiness();
    res.status(readiness.ready ? 200 : 503).json(readiness);
  });

  app.get('/api/voices', async (_req, res) => {
    try {
      const voices = await listVoices();
      res.json({ voices });
    } catch (error) {
      console.error('Failed to list Kokoro voices', error);
      res.status(503).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/speak', async (req, res) => {
    try {
      const payload = validateSpeakPayload(req.body);
      const { wavBuffer, contentType } = await synthesizeSpeech(payload);
      res.setHeader('Content-Type', contentType);
      res.send(wavBuffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const statusCode = /required/.test(message) ? 400 : 503;
      console.error('Failed to synthesize speech', error);
      res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/export-jobs', async (req, res) => {
    try {
      const payload = validateCreateExportJobPayload(req.body);
      const job = await createExportJob(payload);
      res.status(201).json(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/export-jobs/:jobId/sections', async (req, res) => {
    try {
      const payload = validateAppendSectionsPayload(req.body);
      const job = await appendSections(req.params.jobId, payload.sections, payload.isFinalBatch);
      if (!job) {
        return res.status(404).json({ error: 'Export job not found' });
      }

      res.json(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const statusCode = /not found/.test(message) ? 404 : 400;
      res.status(statusCode).json({ error: message });
    }
  });

  app.get('/api/export-jobs/:jobId', (req, res) => {
    const job = getExportJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found' });
    }

    res.json(job.snapshot);
  });

  app.post('/api/export-jobs/:jobId/cancel', (req, res) => {
    const job = cancelExportJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found' });
    }

    res.json(job);
  });

  app.get('/api/export-jobs/:jobId/download', (req, res) => {
    const download = createExportDownload(req.params.jobId);
    if (!download) {
      return res.status(404).json({ error: 'Export is not ready for download' });
    }

    res.setHeader('Content-Type', download.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${download.fileName}"`);
    download.stream.pipe(res);
  });

  app.get('/api', (_req, res) => {
    res.json({
      ok: true,
      endpoints: [
        '/api/health',
        '/api/readiness',
        '/api/voices',
        '/api/speak',
        '/api/export-jobs',
      ],
    });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (staticDir) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return app;
}

export function startLuminaServer(port = Number(process.env.LUMINA_API_PORT || 3001), options: LuminaServerOptions = {}) {
  const app = createLuminaApp(options);
  const server = app.listen(port, '127.0.0.1', () => {
    const address = server.address() as AddressInfo | null;
    const resolvedPort = address?.port ?? port;
    console.log(`Lumina Kokoro API listening on http://127.0.0.1:${resolvedPort}`);
  });

  return server;
}

export function getLuminaServerUrl(server: Server) {
  const address = server.address() as AddressInfo | null;
  const port = address?.port;
  if (!port) {
    throw new Error('Lumina server has not started listening yet');
  }

  return `http://127.0.0.1:${port}`;
}

export async function stopLuminaServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  startLuminaServer(Number(process.env.LUMINA_API_PORT || 3001), {
    staticDir: process.env.LUMINA_STATIC_DIR,
  });
}
