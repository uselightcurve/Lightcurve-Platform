import * as os from 'os';
import * as crypto from 'crypto';

export class RuntimeClient {
  public apiKey: string;
  public baseUrl: string;
  public name: string;
  public instanceKey: string;
  public runtimeId?: string;
  public instanceId?: string;
  public maxCapacity: number;

  public workers: any[] = [];
  public workerSessions: Map<any, string> = new Map();
  public outputTracks: Map<string, Set<any>> = new Map();
  public events: Map<string, any[]> = new Map();
  public transcripts: Map<string, any[]> = new Map();
  public captureStarted: Map<string, number> = new Map();
  public seenFrameIds: Map<string, Set<string>> = new Map();
  public agentAudio: Map<string, Buffer> = new Map();
  public agentAudioFormat: Map<string, { sampleRate: number; channels: number }> = new Map();
  public botStoppedEvents: Map<string, () => void> = new Map();
  public sequence: number = 0;

  constructor() {
    this.apiKey = (process.env.LIGHTCURVE_API_KEY || '').trim();
    this.baseUrl = (process.env.LIGHTCURVE_BASE_URL || 'https://app.uselightcurve.com').replace(/\/$/, '');
    this.name = (process.env.LIGHTCURVE_AGENT_NAME || 'Node.js Agent').trim() || 'Node.js Agent';
    this.instanceKey = process.env.LIGHTCURVE_INSTANCE_ID || `${os.hostname()}-${process.pid}`;
    this.maxCapacity = Math.max(1, parseInt(process.env.LIGHTCURVE_CAPACITY || '1', 10));
  }

  public async request(method: string, path: string, payload?: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
        'X-Lightcurve-SDK': 'node/0.2.0',
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Lightcurve API returned ${response.status}: ${text}`);
    }
    
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  public async start() {
    if (!this.apiKey) {
      console.warn('LIGHTCURVE_API_KEY is missing; Lightcurve auto-instrumentation is inactive.');
      return;
    }

    try {
      const registered = await this.request('POST', '/api/sdk/runtime/register', {
        name: this.name,
        instanceKey: this.instanceKey,
        version: process.env.LIGHTCURVE_AGENT_VERSION,
        gitSha: process.env.GITHUB_SHA || process.env.LIGHTCURVE_GIT_SHA,
        capacity: this.maxCapacity,
        metadata: { node: process.version, platform: os.platform() },
      });

      this.runtimeId = registered.runtime.id;
      this.instanceId = registered.instance.id;
      console.log(`Lightcurve enabled for ${this.name}`);

      this.heartbeatLoop();
      this.pollLoop();
      this.flushLoop();
    } catch (error) {
      console.error('Failed to start Lightcurve Runtime:', error);
    }
  }

  private async heartbeatLoop() {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 15000));
      try {
        await this.request('POST', '/api/sdk/runtime/heartbeat', {
          runtimeId: this.runtimeId,
          instanceId: this.instanceId,
          activeSessions: this.workerSessions.size,
          capacity: this.effectiveCapacity(),
        });
      } catch (error) {
        console.warn('Lightcurve heartbeat failed:', error);
      }
    }
  }

  private async pollLoop() {
    while (true) {
      try {
        const available = this.availableWorkers();
        const result = await this.request('POST', '/api/sdk/runtime/poll', {
          runtimeId: this.runtimeId,
          instanceId: this.instanceId,
          busy: available.length === 0,
          availableCapacity: available.length,
        });

        let commands = result.commands;
        if (!Array.isArray(commands)) {
          commands = result.command ? [result.command] : [];
        }

        for (const command of commands) {
          if (typeof command !== 'object') continue;
          
          const sessionId = command.type === 'capture.start' ? command.captureSessionId : `replay:${command.jobId}`;
          const worker = this.claimWorker(sessionId);
          
          if (!worker) break;
          
          if (command.type === 'capture.start') {
            this.startCaptureSafely(command, worker);
          } else if (command.type === 'replay.start') {
            this.runReplay(command, worker);
          } else {
            this.releaseWorker(worker);
          }
        }
      } catch (error) {
        console.warn('Lightcurve command poll failed:', error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  private async flushLoop() {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      for (const captureId of Array.from(this.events.keys())) {
        if (captureId.startsWith('replay:')) continue;
        
        const events = this.events.get(captureId) || [];
        if (events.length === 0) continue;
        
        this.events.set(captureId, []);
        try {
          await this.request('POST', `/api/sdk/captures/${captureId}/events`, {
            events,
            transcript: this.normalizedTranscript(captureId),
          });
        } catch (error) {
          const currentEvents = this.events.get(captureId) || [];
          this.events.set(captureId, [...events, ...currentEvents]);
          console.warn('Lightcurve event upload failed:', error);
        }
      }
    }
  }

  private effectiveCapacity(): number {
    return Math.min(this.maxCapacity, this.workers.length);
  }

  private availableWorkers(): any[] {
    return this.workers.filter(w => !this.workerSessions.has(w)).slice(0, this.maxCapacity);
  }

  private claimWorker(sessionId: string): any | null {
    const available = this.availableWorkers();
    if (available.length === 0) return null;
    const worker = available[0];
    this.workerSessions.set(worker, sessionId);
    return worker;
  }

  private releaseWorker(worker: any) {
    this.workerSessions.delete(worker);
  }

  private async startCaptureSafely(command: any, worker: any) {
    try {
      await this.startCapture(command, worker);
    } catch (error) {
      console.error('Lightcurve Playground connection failed:', error);
      this.releaseWorker(worker);
    }
  }

  private async startCapture(command: any, worker: any) {
    console.warn("WebRTC capture not fully implemented in JS yet.");
    // TODO: implement with @livekit/rtc-node
  }

  private async runReplay(command: any, worker: any) {
    console.warn("Replay not fully implemented in JS yet.");
    // TODO: implement with @livekit/rtc-node
  }

  public normalizedTranscript(sessionId: string): any[] {
    const normalized: any[] = [];
    const transcripts = this.transcripts.get(sessionId) || [];
    
    for (const item of transcripts) {
      const speaker = item.speaker;
      const text = String(item.text || '').trim();
      
      if (!['human', 'agent'].includes(speaker) || !text) continue;
      
      if (normalized.length > 0 && normalized[normalized.length - 1].speaker === speaker) {
        const separator = speaker === 'agent' ? '' : ' ';
        normalized[normalized.length - 1].text = `${normalized[normalized.length - 1].text}${separator}${text}`.trim();
      } else {
        normalized.push({ speaker, text });
      }
    }
    
    return normalized;
  }
}

export const runtime = new RuntimeClient();

export function installPipecatInstrumentation() {
  try {
    const pipecat = require('@pipecat-ai/pipecat');
    
    if (pipecat.PipelineWorker && !(pipecat.PipelineWorker as any).__lightcurve_instrumented__) {
      const OriginalWorkerInit = pipecat.PipelineWorker.prototype.constructor;
      
      pipecat.PipelineWorker = function(this: any, pipeline: any, ...args: any[]) {
        const kwargs = args.length > 0 ? args[0] : {};
        const observers = kwargs.observers || [];
        
        class LightcurveObserver extends pipecat.BaseObserver {
          constructor(private worker: any) {
            super();
          }

          async on_pipeline_started() {
            if (!runtime.workers.includes(this.worker)) {
              runtime.workers.push(this.worker);
            }
          }

          async on_push_frame(data: any) {
            // runtime.observeFrame(this.worker, data.frame); // To be implemented
          }
        }
        
        observers.push(new LightcurveObserver(this));
        kwargs.observers = observers;
        args[0] = kwargs;
        
        OriginalWorkerInit.apply(this, [pipeline, ...args]);
      };
      
      (pipecat.PipelineWorker as any).__lightcurve_instrumented__ = true;
      console.log("Lightcurve successfully instrumented Pipecat.");
    }
  } catch (error) {
    console.warn("Pipecat is not installed; Lightcurve cannot instrument this process.");
  }
}

export function start() {
  installPipecatInstrumentation();
  runtime.start();
}
