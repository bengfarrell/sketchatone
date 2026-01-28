/**
 * Unit Tests for Strummer WebSocket Client
 *
 * Tests for the StrummerWebSocketClient class including:
 * - Connection management
 * - Event handling
 * - Auto-reconnect behavior
 * - Message parsing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  StrummerWebSocketClient,
  getSharedStrummerClient,
  resetSharedStrummerClient,
  type ConnectionState,
} from '../../src/utils/strummer-websocket-client.js';
import type {
  TabletEventData,
  StrumEventData,
  ServerConfigData,
} from '../../src/types/tablet-events.js';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  private sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close'));
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }

  simulateMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  getSentMessages(): string[] {
    return this.sentMessages;
  }
}

// Store reference to created WebSocket instances
let mockWebSocketInstances: MockWebSocket[] = [];

// Mock global WebSocket
const originalWebSocket = globalThis.WebSocket;

describe('StrummerWebSocketClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockWebSocketInstances = [];
    
    // Mock WebSocket constructor
    (globalThis as any).WebSocket = vi.fn((url: string) => {
      const ws = new MockWebSocket(url);
      mockWebSocketInstances.push(ws);
      return ws;
    });
    (globalThis.WebSocket as any).CONNECTING = MockWebSocket.CONNECTING;
    (globalThis.WebSocket as any).OPEN = MockWebSocket.OPEN;
    (globalThis.WebSocket as any).CLOSING = MockWebSocket.CLOSING;
    (globalThis.WebSocket as any).CLOSED = MockWebSocket.CLOSED;
  });

  afterEach(() => {
    vi.useRealTimers();
    resetSharedStrummerClient();
    globalThis.WebSocket = originalWebSocket;
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const client = new StrummerWebSocketClient();
      expect(client.connectionState).toBe('disconnected');
      expect(client.isConnected).toBe(false);
      expect(client.config).toBeNull();
    });

    it('should create with custom URL', () => {
      const client = new StrummerWebSocketClient({ url: 'ws://custom:9000' });
      client.connect();
      expect(mockWebSocketInstances[0].url).toBe('ws://custom:9000');
      client.cleanup();
    });
  });

  describe('connection management', () => {
    it('should connect to WebSocket server', () => {
      const client = new StrummerWebSocketClient();
      const stateCallback = vi.fn();
      client.onConnectionStateChange(stateCallback);

      client.connect();

      expect(stateCallback).toHaveBeenCalledWith('connecting');
      expect(mockWebSocketInstances.length).toBe(1);

      // Simulate successful connection
      mockWebSocketInstances[0].simulateOpen();

      expect(stateCallback).toHaveBeenCalledWith('connected');
      expect(client.isConnected).toBe(true);

      client.cleanup();
    });

    it('should disconnect from WebSocket server', () => {
      const client = new StrummerWebSocketClient();
      const stateCallback = vi.fn();
      client.onConnectionStateChange(stateCallback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      client.disconnect();

      expect(stateCallback).toHaveBeenCalledWith('disconnected');
      expect(client.isConnected).toBe(false);
    });

    it('should not create multiple connections when already connecting', () => {
      const client = new StrummerWebSocketClient();

      client.connect();
      client.connect();
      client.connect();

      expect(mockWebSocketInstances.length).toBe(1);

      client.cleanup();
    });

    it('should not create multiple connections when already connected', () => {
      const client = new StrummerWebSocketClient();

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      client.connect();
      client.connect();

      expect(mockWebSocketInstances.length).toBe(1);

      client.cleanup();
    });
  });

  describe('auto-reconnect', () => {
    it('should auto-reconnect on disconnect', () => {
      const client = new StrummerWebSocketClient({
        autoReconnect: true,
        reconnectDelay: 1000,
      });

      client.connect();
      mockWebSocketInstances[0].simulateOpen();
      mockWebSocketInstances[0].simulateClose();

      expect(mockWebSocketInstances.length).toBe(1);

      // Advance time to trigger reconnect
      vi.advanceTimersByTime(1000);

      expect(mockWebSocketInstances.length).toBe(2);

      client.cleanup();
    });

    it('should not auto-reconnect when disabled', () => {
      const client = new StrummerWebSocketClient({
        autoReconnect: false,
      });

      client.connect();
      mockWebSocketInstances[0].simulateOpen();
      mockWebSocketInstances[0].simulateClose();

      vi.advanceTimersByTime(5000);

      expect(mockWebSocketInstances.length).toBe(1);

      client.cleanup();
    });

    it('should respect max reconnect attempts', () => {
      const client = new StrummerWebSocketClient({
        autoReconnect: true,
        reconnectDelay: 100,
        maxReconnectAttempts: 3,
      });

      client.connect();
      mockWebSocketInstances[0].simulateClose();

      // First reconnect attempt
      vi.advanceTimersByTime(100);
      expect(mockWebSocketInstances.length).toBe(2);
      mockWebSocketInstances[1].simulateClose();

      // Second reconnect attempt
      vi.advanceTimersByTime(100);
      expect(mockWebSocketInstances.length).toBe(3);
      mockWebSocketInstances[2].simulateClose();

      // Third reconnect attempt
      vi.advanceTimersByTime(100);
      expect(mockWebSocketInstances.length).toBe(4);
      mockWebSocketInstances[3].simulateClose();

      // Should not reconnect anymore (max attempts reached)
      vi.advanceTimersByTime(100);
      expect(mockWebSocketInstances.length).toBe(4);

      client.cleanup();
    });

    it('should reset reconnect attempts on successful connection', () => {
      const client = new StrummerWebSocketClient({
        autoReconnect: true,
        reconnectDelay: 100,
        maxReconnectAttempts: 2,
      });

      client.connect();
      mockWebSocketInstances[0].simulateClose();

      // First reconnect attempt
      vi.advanceTimersByTime(100);
      mockWebSocketInstances[1].simulateOpen();
      mockWebSocketInstances[1].simulateClose();

      // Should be able to reconnect again (attempts reset)
      vi.advanceTimersByTime(100);
      expect(mockWebSocketInstances.length).toBe(3);

      client.cleanup();
    });

    it('should cancel reconnect on disconnect()', () => {
      const client = new StrummerWebSocketClient({
        autoReconnect: true,
        reconnectDelay: 1000,
      });

      client.connect();
      mockWebSocketInstances[0].simulateOpen();
      mockWebSocketInstances[0].simulateClose();

      // Disconnect before reconnect timer fires
      client.disconnect();

      vi.advanceTimersByTime(2000);

      // Should not have reconnected
      expect(mockWebSocketInstances.length).toBe(1);
    });
  });

  describe('tablet events', () => {
    it('should emit tablet events', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      client.onTabletEvent(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      const tabletData: TabletEventData = {
        x: 0.5,
        y: 0.3,
        pressure: 0.7,
        tiltX: 10,
        tiltY: -5,
        tiltXY: 11.18,
        primaryButtonPressed: true,
        secondaryButtonPressed: false,
        state: 'contact',
        timestamp: 1234567890,
      };

      mockWebSocketInstances[0].simulateMessage({
        type: 'tablet',
        data: tabletData,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(tabletData);

      client.cleanup();
    });

    it('should update lastTabletData on tablet event', () => {
      const client = new StrummerWebSocketClient();

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      const tabletData: TabletEventData = {
        x: 0.5,
        y: 0.3,
        pressure: 0.7,
        tiltX: 10,
        tiltY: -5,
        tiltXY: 11.18,
        primaryButtonPressed: true,
        secondaryButtonPressed: false,
        state: 'contact',
        timestamp: 1234567890,
      };

      mockWebSocketInstances[0].simulateMessage({
        type: 'tablet',
        data: tabletData,
      });

      expect(client.lastTabletData).toEqual({
        x: 0.5,
        y: 0.3,
        pressure: 0.7,
        tiltX: 10,
        tiltY: -5,
        tiltXY: 11.18,
        primaryButtonPressed: true,
        secondaryButtonPressed: false,
        state: 'contact',
        timestamp: 1234567890,
      });

      client.cleanup();
    });

    it('should unsubscribe from tablet events', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      const unsubscribe = client.onTabletEvent(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      mockWebSocketInstances[0].simulateMessage({
        type: 'tablet',
        data: { x: 0.5, y: 0.5, pressure: 0.5, tiltX: 0, tiltY: 0, tiltXY: 0, primaryButtonPressed: false, secondaryButtonPressed: false, state: 'contact', timestamp: 0 },
      });

      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      mockWebSocketInstances[0].simulateMessage({
        type: 'tablet',
        data: { x: 0.6, y: 0.6, pressure: 0.6, tiltX: 0, tiltY: 0, tiltXY: 0, primaryButtonPressed: false, secondaryButtonPressed: false, state: 'contact', timestamp: 0 },
      });

      expect(callback).toHaveBeenCalledTimes(1);

      client.cleanup();
    });
  });

  describe('strum events', () => {
    it('should emit strum events', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      client.onStrumEvent(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      const strumData: StrumEventData = {
        type: 'strum',
        notes: [
          { note: { notation: 'C', octave: 4, midiNote: 60 }, velocity: 100 },
        ],
        velocity: 100,
        timestamp: 1234567890,
      };

      mockWebSocketInstances[0].simulateMessage({
        type: 'strum',
        data: strumData,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(strumData);

      client.cleanup();
    });

    it('should unsubscribe from strum events', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      const unsubscribe = client.onStrumEvent(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      mockWebSocketInstances[0].simulateMessage({
        type: 'strum',
        data: { type: 'strum', notes: [], velocity: 100, timestamp: 0 },
      });

      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      mockWebSocketInstances[0].simulateMessage({
        type: 'strum',
        data: { type: 'strum', notes: [], velocity: 110, timestamp: 0 },
      });

      expect(callback).toHaveBeenCalledTimes(1);

      client.cleanup();
    });
  });

  describe('config events', () => {
    it('should emit config on connection', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      client.onConfig(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      const configData: ServerConfigData = {
        mode: 'tablet',
        throttleMs: 16,
        notes: [
          { notation: 'C', octave: 4 },
          { notation: 'E', octave: 4 },
        ],
        chord: 'C',
      };

      mockWebSocketInstances[0].simulateMessage({
        type: 'config',
        data: configData,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(configData);
      expect(client.config).toEqual(configData);

      client.cleanup();
    });
  });

  describe('mode change events', () => {
    it('should emit mode change events', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      client.onModeChange(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      mockWebSocketInstances[0].simulateMessage({
        type: 'mode-change',
        data: { mode: 'strum' },
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('strum');

      client.cleanup();
    });
  });

  describe('sending messages', () => {
    it('should send set-mode message', () => {
      const client = new StrummerWebSocketClient();

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      client.setMode('strum');

      const sentMessages = mockWebSocketInstances[0].getSentMessages();
      expect(sentMessages.length).toBe(1);
      expect(JSON.parse(sentMessages[0])).toEqual({
        type: 'set-mode',
        mode: 'strum',
      });

      client.cleanup();
    });

    it('should send set-throttle message', () => {
      const client = new StrummerWebSocketClient();

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      client.setThrottle(32);

      const sentMessages = mockWebSocketInstances[0].getSentMessages();
      expect(sentMessages.length).toBe(1);
      expect(JSON.parse(sentMessages[0])).toEqual({
        type: 'set-throttle',
        throttleMs: 32,
      });

      client.cleanup();
    });

    it('should not send messages when disconnected', () => {
      const client = new StrummerWebSocketClient();

      client.setMode('strum');
      client.setThrottle(32);

      // No WebSocket created, so no messages sent
      expect(mockWebSocketInstances.length).toBe(0);

      client.cleanup();
    });
  });

  describe('error handling', () => {
    it('should emit error on WebSocket error', () => {
      const client = new StrummerWebSocketClient();
      const errorCallback = vi.fn();
      const stateCallback = vi.fn();
      client.on('error', errorCallback);
      client.onConnectionStateChange(stateCallback);

      client.connect();
      mockWebSocketInstances[0].simulateError();

      expect(errorCallback).toHaveBeenCalledTimes(1);
      expect(stateCallback).toHaveBeenCalledWith('error');

      client.cleanup();
    });

    it('should handle invalid JSON messages gracefully', () => {
      const client = new StrummerWebSocketClient();
      const tabletCallback = vi.fn();
      client.onTabletEvent(tabletCallback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      // Send invalid JSON
      if (mockWebSocketInstances[0].onmessage) {
        mockWebSocketInstances[0].onmessage(
          new MessageEvent('message', { data: 'not valid json' })
        );
      }

      // Should not crash, and callback should not be called
      expect(tabletCallback).not.toHaveBeenCalled();

      client.cleanup();
    });
  });

  describe('shared client', () => {
    it('should return same instance', () => {
      const client1 = getSharedStrummerClient();
      const client2 = getSharedStrummerClient();

      expect(client1).toBe(client2);
    });

    it('should reset shared client', () => {
      const client1 = getSharedStrummerClient();
      resetSharedStrummerClient();
      const client2 = getSharedStrummerClient();

      expect(client1).not.toBe(client2);
    });

    it('should use options only on first creation', () => {
      const client1 = getSharedStrummerClient({ url: 'ws://first:1111' });
      const client2 = getSharedStrummerClient({ url: 'ws://second:2222' });

      client1.connect();

      // Should use first URL
      expect(mockWebSocketInstances[0].url).toBe('ws://first:1111');
      expect(client1).toBe(client2);
    });
  });

  describe('cleanup', () => {
    it('should cleanup all resources', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      client.onTabletEvent(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      client.cleanup();

      // Should be disconnected
      expect(client.isConnected).toBe(false);

      // Listeners should be cleared (emit won't call callback)
      mockWebSocketInstances[0].simulateMessage({
        type: 'tablet',
        data: { x: 0.5, y: 0.5, pressure: 0.5, tiltX: 0, tiltY: 0, tiltXY: 0, primaryButtonPressed: false, secondaryButtonPressed: false, state: 'contact', timestamp: 0 },
      });

      // Callback should not be called after cleanup
      // Note: The WebSocket is closed, so this won't actually trigger
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('device status events', () => {
    it('should have null deviceStatus initially', () => {
      const client = new StrummerWebSocketClient();
      expect(client.deviceStatus).toBeNull();
      client.cleanup();
    });

    it('should have isDeviceConnected as false initially', () => {
      const client = new StrummerWebSocketClient();
      expect(client.isDeviceConnected).toBe(false);
      client.cleanup();
    });

    it('should emit device status events when receiving status messages', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      client.onDeviceStatus(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      mockWebSocketInstances[0].simulateMessage({
        type: 'status',
        status: 'connected',
        deviceConnected: true,
        message: 'Device connected',
        timestamp: 1234567890,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({
        status: 'connected',
        deviceConnected: true,
        message: 'Device connected',
        timestamp: 1234567890,
      });

      client.cleanup();
    });

    it('should update deviceStatus property when receiving status messages', () => {
      const client = new StrummerWebSocketClient();

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      mockWebSocketInstances[0].simulateMessage({
        type: 'status',
        status: 'connected',
        deviceConnected: true,
        message: 'Device connected',
        timestamp: 1234567890,
      });

      expect(client.deviceStatus).toEqual({
        status: 'connected',
        deviceConnected: true,
        message: 'Device connected',
        timestamp: 1234567890,
      });

      client.cleanup();
    });

    it('should update isDeviceConnected based on status message', () => {
      const client = new StrummerWebSocketClient();

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      // Device connected
      mockWebSocketInstances[0].simulateMessage({
        type: 'status',
        status: 'connected',
        deviceConnected: true,
        message: 'Device connected',
        timestamp: 1234567890,
      });

      expect(client.isDeviceConnected).toBe(true);

      // Device disconnected
      mockWebSocketInstances[0].simulateMessage({
        type: 'status',
        status: 'disconnected',
        deviceConnected: false,
        message: 'Device disconnected',
        timestamp: 1234567891,
      });

      expect(client.isDeviceConnected).toBe(false);

      client.cleanup();
    });

    it('should handle disconnected status', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      client.onDeviceStatus(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      mockWebSocketInstances[0].simulateMessage({
        type: 'status',
        status: 'disconnected',
        deviceConnected: false,
        message: 'No tablet connected',
        timestamp: 1234567890,
      });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({
        status: 'disconnected',
        deviceConnected: false,
        message: 'No tablet connected',
        timestamp: 1234567890,
      });
      expect(client.isDeviceConnected).toBe(false);

      client.cleanup();
    });

    it('should unsubscribe from device status events', () => {
      const client = new StrummerWebSocketClient();
      const callback = vi.fn();
      const unsubscribe = client.onDeviceStatus(callback);

      client.connect();
      mockWebSocketInstances[0].simulateOpen();

      mockWebSocketInstances[0].simulateMessage({
        type: 'status',
        status: 'connected',
        deviceConnected: true,
        message: 'Device connected',
        timestamp: 1234567890,
      });

      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      mockWebSocketInstances[0].simulateMessage({
        type: 'status',
        status: 'disconnected',
        deviceConnected: false,
        message: 'Device disconnected',
        timestamp: 1234567891,
      });

      // Should not have been called again after unsubscribe
      expect(callback).toHaveBeenCalledTimes(1);

      client.cleanup();
    });
  });
});
