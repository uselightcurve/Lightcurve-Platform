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
    // TODO: implement wrtc for Node.js capture
  }

  private async runReplay(command: any, worker: any) {
    const jobId = command.jobId;
    const sessionId = `replay:${jobId}`;
    const graph = command.case?.behaviorGraph || {};
    const manifest = command.manifest || {};
    
    let path = graph.observedPath;
    if (!Array.isArray(path)) path = graph.nodes || [];
    
    const nodesById: Record<string, any> = {};
    for (const node of path) {
      if (typeof node === 'object' && node.id) nodesById[node.id] = node;
    }
    
    let humanNodes: any[] = [];
    const manifestPath = manifest.graphPath;
    if (Array.isArray(manifestPath) && manifestPath.length > 0) {
      humanNodes = manifestPath.map((id: any) => nodesById[String(id)]).filter((n: any) => n && n.speaker === 'human');
    } else {
      humanNodes = path.filter((n: any) => typeof n === 'object' && n.speaker === 'human');
    }

    this.captureStarted.set(sessionId, performance.now());
    this.events.set(sessionId, []);
    this.transcripts.set(sessionId, []);
    this.seenFrameIds.set(sessionId, new Set());
    this.agentAudio.set(sessionId, Buffer.alloc(0));
    
    let botStoppedResolver: () => void = () => {};
    this.botStoppedEvents.set(sessionId, () => botStoppedResolver());

    const graphPath: string[] = [];
    const callerArtifacts: any[] = [];

    try {
      for (let index = 0; index < humanNodes.length; index++) {
        const node = humanNodes[index];
        const nodeId = String(node.id || '');
        if (!nodeId) continue;

        const agentText = this.normalizedTranscript(sessionId)
          .filter(i => i.speaker === 'agent')
          .map(i => i.text)
          .join(' ').slice(-1500);

        const turn = await this.request('POST', `/api/sdk/replays/${jobId}/turn`, {
          nodeId,
          previousAgentText: agentText,
        });

        const audioBuffer = Buffer.from(turn.audioBase64, 'base64');
        const sampleRate = parseInt(turn.sampleRate || '16000', 10);
        const channels = parseInt(turn.channels || '1', 10);

        this.transcripts.get(sessionId)!.push({
          speaker: 'human',
          text: turn.text,
          startedAtMs: Math.floor(performance.now() - this.captureStarted.get(sessionId)!),
        });

        if (typeof turn.artifacts === 'object' && turn.artifacts) {
          callerArtifacts.push(turn.artifacts);
        }

        const timing = turn.timing || {};
        const responseDelay = Math.max(0, Math.min(5000, parseInt(timing.responseDelayMs || '0', 10)));
        if (responseDelay > 0) await new Promise(r => setTimeout(r, responseDelay));

        await this.feedPcm(worker, audioBuffer, sampleRate, channels, turn.transport || {}, (command.replaySeed || 42) + index);
        
        const silence = Buffer.alloc(sampleRate * channels * 2 * 0.5);
        await this.feedPcm(worker, silence, sampleRate, channels, {}, (command.replaySeed || 42) + index + 1);

        const interruptionOffset = index + 1 < humanNodes.length ? timing.interruptionOffsetMs : undefined;
        if (interruptionOffset !== undefined) {
          const waitTime = Math.max(0, Math.min(5000, parseInt(interruptionOffset, 10)));
          await new Promise(r => setTimeout(r, waitTime));
        } else {
          await Promise.race([
            new Promise<void>(resolve => { botStoppedResolver = resolve; }),
            new Promise(r => setTimeout(r, 45000))
          ]);
        }

        graphPath.push(nodeId);
      }

      const agentAudioUrl = await this.uploadReplayAgentAudio(jobId, sessionId);
      await this.request('POST', `/api/sdk/replays/${jobId}/complete`, {
        transcript: this.normalizedTranscript(sessionId),
        graphPath,
        artifacts: { callerTurns: callerArtifacts, agentAudioUrl },
        events: this.events.get(sessionId) || [],
        durationMs: Math.floor(performance.now() - this.captureStarted.get(sessionId)!),
      });

    } catch (error: any) {
      console.error('Lightcurve replay failed:', error);
      try {
        await this.request('POST', `/api/sdk/replays/${jobId}/failed`, { error: String(error) });
      } catch (e) {
        console.warn('Lightcurve could not report replay failure:', e);
      }
    } finally {
      this.botStoppedEvents.delete(sessionId);
      this.releaseWorker(worker);
    }
  }

  private async feedPcm(worker: any, audio: Buffer, sampleRate: number, channels: number, transport: any, seed: number) {
    const isPipecat = typeof worker.pushFrame === 'function' || typeof worker.queue_frame === 'function' || typeof worker.push_frame === 'function';

    const chunkSize = Math.max(2, Math.floor(sampleRate * channels * 2 * 0.02));
    const chunks: Buffer[] = [];
    for (let i = 0; i < audio.length; i += chunkSize) {
      chunks.push(audio.subarray(i, i + chunkSize));
    }

    const baseLatency = Math.max(0, Math.min(5000, parseInt(transport.baseLatencyMs || '0', 10)));
    const jitterMs = Math.max(0, Math.min(1000, parseInt(transport.jitterMs || '0', 10)));
    if (baseLatency > 0) await new Promise(r => setTimeout(r, baseLatency));

    let currentSeed = seed;
    const nextRandom = () => {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      return currentSeed / 233280;
    };

    const packetLoss = Math.max(0, Math.min(0.5, parseFloat(transport.packetLoss || '0')));
    const burstLoss = Math.max(0, Math.min(0.8, parseFloat(transport.burstLoss || '0')));
    let burst = false;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const lossProbability = burst ? burstLoss : packetLoss;
      
      if (nextRandom() < lossProbability) {
        burst = true;
        continue;
      }
      burst = false;

      if (isPipecat) {
        try {
          const pipecat = require('@pipecat-ai/pipecat');
          if (pipecat.InputAudioRawFrame) {
            const frame = new pipecat.InputAudioRawFrame(chunk, sampleRate, channels);
            if (typeof worker.pushFrame === 'function') await worker.pushFrame(frame);
            else if (typeof worker.push_frame === 'function') await worker.push_frame(frame);
            else if (typeof worker.queue_frame === 'function') await worker.queue_frame(frame);
          }
        } catch (e) {
          // ignore if pipecat not present
        }
      }
      
      const jitter = jitterMs > 0 ? (nextRandom() * 2 - 1) * jitterMs : 0;
      await new Promise(r => setTimeout(r, Math.max(0, 20 + jitter)));
    }
  }

  private async uploadReplayAgentAudio(jobId: string, sessionId: string): Promise<string | null> {
    const audioData = this.agentAudio.get(sessionId);
    const format = this.agentAudioFormat.get(sessionId);
    if (!audioData || audioData.length === 0 || !format) return null;

    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + audioData.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(format.channels, 22);
    header.writeUInt32LE(format.sampleRate, 24);
    header.writeUInt32LE(format.sampleRate * format.channels * 2, 28);
    header.writeUInt16LE(format.channels * 2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(audioData.length, 40);

    const wavBuffer = Buffer.concat([header, audioData]);
    try {
      const result = await this.request('POST', `/api/sdk/replays/${jobId}/audio`, {
        audioBase64: wavBuffer.toString('base64'),
      });
      return result.audioUrl || null;
    } catch (e) {
      console.warn("Agent audio upload failed:", e);
      return null;
    }
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
