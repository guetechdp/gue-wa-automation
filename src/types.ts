import { Message, Chat } from 'whatsapp-web.js';
import { Collection } from 'lokijs';

// Environment variables interface
export interface Environment {
  NODE_ENV?: string;
  M_WAITING_TIME?: string;
  CHROMIUM_PATH?: string;
  WHITELISTED_NUMBERS?: string;
  FW_ENDPOINT?: string;
  FW_AUTH_TOKEN?: string;
  JWT_SECRET?: string;
  AI_AGENT?: string;
  PORT?: string;
}

// AI Agent response interface
export interface AIAgentResponse {
  text: string;
  session: string | null;
}

// Configuration interfaces
export interface FWConfig {
  question: string;
  overrideConfig: {
    sessionId?: string;
  };
}

// Database interfaces
export interface NumberEntry {
  number: string;
  campaign?: string | undefined;
  session?: string | undefined;
}

export interface Database {
  getCollection: (name: string) => Collection<NumberEntry> | null;
  addCollection: (name: string) => Collection<NumberEntry>;
  loadDatabase: (options: any, callback: () => void) => void;
}

// Message queue interfaces
export interface QueuedMessage {
  message: Message;
  timestamp: number;
}

export interface MessageQueue {
  [key: string]: QueuedMessage[];
}

// Processing state interface
export interface ProcessingState {
  [key: string]: number; // user -> timestamp
}

// Chat message interface for conversation context
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// API request interfaces
export interface GreetingRequest {
  sender: string;
  message: string;
  campaign: string;
}

export interface GreetingResponse {
  success: boolean;
  message: string;
}

export interface ErrorResponse {
  error: string;
}

// WhatsApp client interfaces
export interface WhatsAppClient {
  info?: {
    wid: {
      _serialized: string;
    };
  };
  initialize: () => void;
  sendMessage: (chatId: string, content: string) => Promise<Message>;
  on: (event: string, callback: (...args: any[]) => void) => void;
}

// Express app interface
export interface ExpressApp {
  use: (middleware: any) => void;
  post: (path: string, handler: (req: any, res: any) => void) => void;
  get: (path: string, handler: (req: any, res: any) => void) => void;
  listen: (port: number, callback: () => void) => void;
} 