import swaggerJsdoc from 'swagger-jsdoc';
import { SwaggerDefinition } from 'swagger-jsdoc';

const swaggerDefinition: SwaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'WhatsApp Bot API',
    version: '1.0.0',
    description: 'A comprehensive WhatsApp bot API with multi-client support, session management, and AI integration',
    contact: {
      name: 'WhatsApp Bot API Support',
      email: 'support@example.com'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  servers: [
    {
      url: 'http://localhost:3003',
      description: 'Development server'
    },
    {
      url: 'https://your-production-domain.com',
      description: 'Production server'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false
          },
          error: {
            type: 'string',
            example: 'Error message'
          },
          message: {
            type: 'string',
            example: 'An error occurred'
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2025-09-22T07:49:22.461Z'
          }
        },
        required: ['success', 'error']
      },
      SuccessResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true
          },
          message: {
            type: 'string',
            example: 'Operation completed successfully'
          },
          data: {
            type: 'object',
            description: 'Response data (varies by endpoint)'
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2025-09-22T07:49:22.461Z'
          }
        },
        required: ['success', 'message']
      },
      Error: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false
          },
          error: {
            type: 'string',
            example: 'Error message'
          }
        }
      },
      Success: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true
          },
          message: {
            type: 'string',
            example: 'Operation completed successfully'
          }
        }
      },
      ClientInfo: {
        type: 'object',
        properties: {
          clientId: {
            type: 'string',
            example: 'javear-account'
          },
          status: {
            type: 'string',
            enum: ['initializing', 'qr_required', 'ready', 'authenticated', 'error', 'session_saved'],
            example: 'ready'
          },
          isReady: {
            type: 'boolean',
            example: true
          },
          phoneNumber: {
            type: 'string',
            example: '6285128007906@c.us'
          },
          hasQrCode: {
            type: 'boolean',
            example: false
          },
          lastActivity: {
            type: 'string',
            format: 'date-time',
            example: '2025-09-22T07:49:22.461Z'
          },
          ai_agent_code: {
            type: 'string',
            nullable: true,
            example: 'FW001',
            description: 'The AI agent code assigned to this client'
          }
        }
      },
      CreateClientRequest: {
        type: 'object',
        required: ['clientId'],
        properties: {
          clientId: {
            type: 'string',
            example: 'my-whatsapp-client',
            description: 'Unique identifier for the WhatsApp client'
          }
        }
      },
      SendMessageRequest: {
        type: 'object',
        required: ['number', 'message'],
        properties: {
          number: {
            type: 'string',
            example: '6282121547121',
            description: 'Phone number to send message to (without @c.us suffix)'
          },
          message: {
            type: 'string',
            example: 'Hello, this is a test message',
            description: 'Message content to send'
          }
        }
      },
      RecoverClientRequest: {
        type: 'object',
        properties: {
          forceReset: {
            type: 'boolean',
            example: false,
            description: 'Force reset client to QR scanning mode'
          }
        }
      },
      TestAIApiRequest: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            example: 'hai',
            description: 'Test message to send to AI API'
          },
          phoneNumber: {
            type: 'string',
            example: '6282121547121',
            description: 'Phone number for testing'
          },
          clientId: {
            type: 'string',
            example: 'test-client',
            description: 'Client ID for testing'
          }
        }
      },
      HealthStatus: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true
          },
          message: {
            type: 'string',
            example: 'WhatsApp Bot API is healthy'
          },
          status: {
            type: 'object',
            properties: {
              totalClients: {
                type: 'number',
                example: 2
              },
              readyClients: {
                type: 'number',
                example: 1
              },
              errorClients: {
                type: 'number',
                example: 0
              },
              isHealthy: {
                type: 'boolean',
                example: true
              },
              clients: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/ClientInfo'
                }
              }
            }
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2025-09-22T07:49:22.461Z'
          }
        }
      },
      QRCodeResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true
          },
          message: {
            type: 'string',
            example: 'QR code generated successfully'
          },
          data: {
            type: 'object',
            properties: {
              qrCode: {
                type: 'string',
                example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
                description: 'Base64 encoded PNG image of the QR code'
              },
              clientId: {
                type: 'string',
                example: 'javear-account'
              }
            }
          }
        }
      },
      MongoDBStatus: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true
          },
          message: {
            type: 'string',
            example: 'MongoDB debug information retrieved'
          },
          totalCollections: {
            type: 'number',
            example: 6
          },
          sessionCollectionsCount: {
            type: 'number',
            example: 4
          },
          allCollections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  example: 'whatsapp-RemoteAuth-javear-account.files'
                },
                type: {
                  type: 'string',
                  example: 'collection'
                }
              }
            }
          },
          sessionCollections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  example: 'whatsapp-RemoteAuth-javear-account.files'
                },
                type: {
                  type: 'string',
                  example: 'collection'
                }
              }
            }
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2025-09-22T07:49:22.461Z'
          }
        }
      },
      AgentAssignment: {
        type: 'object',
        properties: {
          clientId: {
            type: 'string',
            example: 'javear-account'
          },
          ai_agent_code: {
            type: 'string',
            example: 'FW001'
          },
          assignedAt: {
            type: 'string',
            format: 'date-time',
            example: '2025-09-22T07:49:22.461Z'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2025-09-22T07:49:22.461Z'
          }
        }
      },
      AssignAgentRequest: {
        type: 'object',
        required: ['ai_agent_code'],
        properties: {
          ai_agent_code: {
            type: 'string',
            example: 'FW001',
            description: 'The AI agent code to assign to the client'
          }
        }
      }
    }
  },
  tags: [
    {
      name: 'Client Management',
      description: 'Core WhatsApp client operations for managing multiple client sessions. Create new clients, monitor their status and health, disconnect and remove clients, and recover failed clients. Each client operates independently with its own session stored in MongoDB.'
    },
    {
      name: 'QR Code Management',
      description: 'QR code authentication for WhatsApp clients. Generate QR codes for new client authentication, get QR code images as base64 PNG, refresh QR codes when they expire, and monitor QR code status. QR codes are automatically generated when clients need authentication.'
    },
    {
      name: 'Message Operations',
      description: 'Message sending and management through authenticated WhatsApp clients. Send text messages to any phone number with automatic message formatting for WhatsApp, support for multiple clients, and message delivery confirmation. Messages are sent through the first available ready client.'
    },
    {
      name: 'Health & Status',
      description: 'System health monitoring for the WhatsApp Bot API. Check system health and client status, view detailed client information, monitor memory usage and performance, and get real-time status updates. Essential for monitoring and debugging the bot system.'
    },
    {
      name: 'Testing & Debugging',
      description: 'Testing and development tools for debugging the WhatsApp Bot API. Test AI API integration, test client functionality, debug message handling, and test event system. Useful for development, testing, and troubleshooting.'
    },
    {
      name: 'MongoDB Operations',
      description: 'MongoDB session management and debugging operations. View MongoDB connection status, debug session collections, monitor session storage, and clean up corrupted sessions. Essential for understanding and managing session persistence.'
    },
    {
      name: 'Authentication',
      description: 'JWT authentication for API access. All API endpoints require valid JWT tokens in the Authorization header. Tokens must be generated locally using the secure token generation script for authorized developers only.'
    }
  ]
};

const options = {
  definition: swaggerDefinition,
  apis: [
    './src/controllers/*.ts',
    './src/routes/*.ts',
    './src/app.ts'
  ]
};

export const swaggerSpec = swaggerJsdoc(options);
