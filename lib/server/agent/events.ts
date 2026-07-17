import { EventEmitter } from 'node:events';
import type { AgentEvent } from './types.js';

class AgentEventBus {
  private readonly emitter = new EventEmitter();

  emit(event: AgentEvent): void {
    this.emitter.emit('event', event);
    this.emitter.emit(event.type, event);
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  on<T extends AgentEvent['type']>(
    type: T,
    listener: (event: Extract<AgentEvent, { type: T }>) => void
  ): () => void {
    const wrapped = listener as (event: AgentEvent) => void;
    this.emitter.on(type, wrapped);
    return () => this.emitter.off(type, wrapped);
  }
}

export const agentEventBus = new AgentEventBus();
export { AgentEventBus };
