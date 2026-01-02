#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { FreeAgentClient } from './freeagent-client.js';
import { TimeslipAttributes, CreditNoteAttributes } from './types.js';

const CLIENT_ID = process.env.FREEAGENT_CLIENT_ID as string;
const CLIENT_SECRET = process.env.FREEAGENT_CLIENT_SECRET as string;
const ACCESS_TOKEN = process.env.FREEAGENT_ACCESS_TOKEN as string;
const REFRESH_TOKEN = process.env.FREEAGENT_REFRESH_TOKEN as string;

if (!CLIENT_ID || !CLIENT_SECRET || !ACCESS_TOKEN || !REFRESH_TOKEN) {
  throw new Error('Missing required environment variables for FreeAgent authentication');
}

function extractIdFromUrl(url: string | undefined, resourceType: string): string | undefined {
  if (!url) return undefined;

  // Extract ID from URL like "https://api.sandbox.freeagent.com/v2/credit_notes/123"
  const match = url.match(/\/(\d+)$/);

  if (!match) {
    console.error(`[Warning] Failed to extract ${resourceType} ID from URL: ${url}`);
    return undefined;
  }

  return match[1];
}

function validateTimeslipAttributes(data: unknown): TimeslipAttributes {
  if (typeof data !== 'object' || !data) {
    throw new Error('Invalid timeslip data: must be an object');
  }

  const attrs = data as Record<string, unknown>;

  if (typeof attrs.task !== 'string' ||
    typeof attrs.user !== 'string' ||
    typeof attrs.project !== 'string' ||
    typeof attrs.dated_on !== 'string' ||
    typeof attrs.hours !== 'string') {
    throw new Error('Invalid timeslip data: missing required fields');
  }

  return {
    task: attrs.task,
    user: attrs.user,
    project: attrs.project,
    dated_on: attrs.dated_on,
    hours: attrs.hours,
    comment: attrs.comment as string | undefined
  };
}

function validateCreditNoteItemAttributes(data: unknown): any {
  if (typeof data !== 'object' || !data) {
    throw new Error('Invalid credit note item: must be an object');
  }

  const item = data as Record<string, unknown>;

  // TODO: Validate description is non-empty string
  if (typeof item.description !== 'string') {
    throw new Error('Invalid credit note item: description must be a string');
  }

  // Validate price is a valid number or numeric string
  let priceValue: number;
  if (typeof item.price === 'number') {
    priceValue = item.price;
  } else if (typeof item.price === 'string') {
    priceValue = parseFloat(item.price);
    if (isNaN(priceValue)) {
      throw new Error('Invalid credit note item: price must be a valid number');
    }
  } else {
    throw new Error('Invalid credit note item: price must be a string or number');
  }

  // Price MUST be negative for credit notes
  if (priceValue >= 0) {
    throw new Error('Invalid credit note item: price must be negative (credit notes reduce amounts owed)');
  }

  if (typeof item.quantity !== 'number') {
    throw new Error('Invalid credit note item: quantity must be a number');
  }

  // Validate optional sales_tax_rate if provided
  if (item.sales_tax_rate !== undefined) {
    if (typeof item.sales_tax_rate !== 'string' && typeof item.sales_tax_rate !== 'number') {
      throw new Error('Invalid credit note item: sales_tax_rate must be a string or number');
    }
  }

  // Validate optional sales_tax_status if provided
  if (item.sales_tax_status !== undefined) {
    const validStatuses = ['TAXABLE', 'EXEMPT', 'OUT_OF_SCOPE'];
    if (typeof item.sales_tax_status !== 'string' || !validStatuses.includes(item.sales_tax_status)) {
      throw new Error('Invalid credit note item: sales_tax_status must be one of: TAXABLE, EXEMPT, OUT_OF_SCOPE');
    }
  }

  // TODO: Add validation for other optional item fields (item_type)

  const validatedItem: any = {
    description: item.description,
    price: item.price,
    quantity: item.quantity
  };

  // Include optional fields if provided
  if (item.sales_tax_rate !== undefined) {
    validatedItem.sales_tax_rate = item.sales_tax_rate;
  }
  if (item.sales_tax_status !== undefined) {
    validatedItem.sales_tax_status = item.sales_tax_status;
  }

  return validatedItem;
}

function validateCreditNoteAttributes(data: unknown): CreditNoteAttributes {
  if (typeof data !== 'object' || !data) {
    throw new Error('Invalid credit note data: must be an object');
  }

  const attrs = data as Record<string, unknown>;

  // Validate required fields exist and are correct type
  if (typeof attrs.contact !== 'string' ||
    typeof attrs.dated_on !== 'string' ||
    typeof attrs.payment_terms_in_days !== 'number') {
    throw new Error('Invalid credit note data: missing or invalid required fields (contact, dated_on, payment_terms_in_days)');
  }

  // TODO: Validate dated_on format (YYYY-MM-DD regex)
  // TODO: Validate contact is valid URI format
  // TODO: Validate payment_terms_in_days is non-negative integer

  // Validate credit_note_items array
  if (!Array.isArray(attrs.credit_note_items) || attrs.credit_note_items.length === 0) {
    throw new Error('Invalid credit note data: credit_note_items must be a non-empty array');
  }

  // Validate each item in the array
  const validatedItems = attrs.credit_note_items.map((item, index) => {
    try {
      return validateCreditNoteItemAttributes(item);
    } catch (error: any) {
      throw new Error(`Invalid credit note item at index ${index}: ${error.message}`);
    }
  });

  // Validate optional comments if provided
  if (attrs.comments !== undefined && typeof attrs.comments !== 'string') {
    throw new Error('Invalid credit note data: comments must be a string');
  }

  // Validate optional involves_sales_tax if provided
  if (attrs.involves_sales_tax !== undefined && typeof attrs.involves_sales_tax !== 'boolean') {
    throw new Error('Invalid credit note data: involves_sales_tax must be a boolean');
  }

  // TODO: Add validation for other optional fields (reference, currency, project)

  const validatedCreditNote: any = {
    contact: attrs.contact,
    dated_on: attrs.dated_on,
    payment_terms_in_days: attrs.payment_terms_in_days,
    credit_note_items: validatedItems
  };

  // Include optional header fields if provided
  if (attrs.comments !== undefined) {
    validatedCreditNote.comments = attrs.comments;
  }
  if (attrs.involves_sales_tax !== undefined) {
    validatedCreditNote.involves_sales_tax = attrs.involves_sales_tax;
  }

  return validatedCreditNote;
}

class FreeAgentServer {
  private server: Server;
  private client: FreeAgentClient;

  constructor() {
    console.error('[Setup] Initializing FreeAgent MCP server...');

    this.client = new FreeAgentClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN
    });

    this.server = new Server(
      {
        name: 'freeagent-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'list_timeslips',
          description: 'List timeslips with optional filtering',
          inputSchema: {
            type: 'object',
            properties: {
              from_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
              to_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
              updated_since: { type: 'string', description: 'ISO datetime' },
              view: {
                type: 'string',
                enum: ['all', 'unbilled', 'running'],
                description: 'Filter view type'
              },
              user: { type: 'string', description: 'Filter by user URL' },
              task: { type: 'string', description: 'Filter by task URL' },
              project: { type: 'string', description: 'Filter by project URL' },
              nested: { type: 'boolean', description: 'Include nested resources' }
            }
          }
        },
        {
          name: 'get_timeslip',
          description: 'Get a single timeslip by ID',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Timeslip ID' }
            },
            required: ['id']
          }
        },
        {
          name: 'create_timeslip',
          description: 'Create a new timeslip',
          inputSchema: {
            type: 'object',
            properties: {
              task: { type: 'string', description: 'Task URL' },
              user: { type: 'string', description: 'User URL' },
              project: { type: 'string', description: 'Project URL' },
              dated_on: { type: 'string', description: 'Date (YYYY-MM-DD)' },
              hours: { type: 'string', description: 'Hours worked (e.g. "1.5")' },
              comment: { type: 'string', description: 'Optional comment' }
            },
            required: ['task', 'user', 'project', 'dated_on', 'hours']
          }
        },
        {
          name: 'update_timeslip',
          description: 'Update an existing timeslip',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Timeslip ID' },
              task: { type: 'string', description: 'Task URL' },
              user: { type: 'string', description: 'User URL' },
              project: { type: 'string', description: 'Project URL' },
              dated_on: { type: 'string', description: 'Date (YYYY-MM-DD)' },
              hours: { type: 'string', description: 'Hours worked (e.g. "1.5")' },
              comment: { type: 'string', description: 'Optional comment' }
            },
            required: ['id']
          }
        },
        {
          name: 'delete_timeslip',
          description: 'Delete a timeslip',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Timeslip ID' }
            },
            required: ['id']
          }
        },
        {
          name: 'start_timer',
          description: 'Start a timer for a timeslip',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Timeslip ID' }
            },
            required: ['id']
          }
        },
        {
          name: 'stop_timer',
          description: 'Stop a running timer for a timeslip',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Timeslip ID' }
            },
            required: ['id']
          }
        },
        {
          name: 'create_credit_note',
          description: 'Create a new credit note for a contact',
          inputSchema: {
            type: 'object',
            properties: {
              contact: {
                type: 'string',
                description: 'Contact URI (e.g., https://api.sandbox.freeagent.com/v2/contacts/123)'
              },
              dated_on: {
                type: 'string',
                description: 'Credit note date in YYYY-MM-DD format'
              },
              payment_terms_in_days: {
                type: 'number',
                description: 'Payment terms in days (use 0 for "Due on Receipt")'
              },
              credit_note_items: {
                type: 'array',
                description: 'Array of line items (at least one required)',
                items: {
                  type: 'object',
                  properties: {
                    description: {
                      type: 'string',
                      description: 'Item description'
                    },
                    price: {
                      type: ['string', 'number'],
                      description: 'Item price (MUST be negative - e.g., -10.50 to credit £10.50)'
                    },
                    quantity: {
                      type: 'number',
                      description: 'Item quantity'
                    },
                    sales_tax_rate: {
                      type: ['string', 'number'],
                      description: 'Optional sales tax rate (e.g., 20 for 20%)'
                    },
                    sales_tax_status: {
                      type: 'string',
                      enum: ['TAXABLE', 'EXEMPT', 'OUT_OF_SCOPE'],
                      description: 'Optional sales tax status'
                    },
                    item_type: {
                      type: 'string',
                      enum: ['Hours', 'Days', 'Weeks', 'Months', 'Years', 'Products', 'Services', 'Training', 'Expenses', 'Comment', 'Bills', 'Discount', 'Credit', 'VAT', ''],
                      description: 'Optional item type (blank string for no unit)'
                    },
                    category: {
                      type: 'string',
                      description: 'Optional category URI (e.g., https://api.freeagent.com/v2/categories/123)'
                    },
                    project: {
                      type: 'string',
                      description: 'Optional project URI for this specific item'
                    }
                  },
                  required: ['description', 'price', 'quantity']
                }
              },
              comments: {
                type: 'string',
                description: 'Optional comments for the credit note'
              },
              involves_sales_tax: {
                type: 'boolean',
                description: 'Optional flag indicating whether credit note involves sales tax'
              },
              reference: {
                type: 'string',
                description: 'Optional credit note reference (auto-generated if omitted)'
              },
              currency: {
                type: 'string',
                description: 'Optional currency code (e.g., "GBP", "USD", "EUR" - defaults to company currency)'
              },
              project: {
                type: 'string',
                description: 'Optional project URI (e.g., https://api.freeagent.com/v2/projects/123)'
              },
              ec_status: {
                type: 'string',
                enum: ['UK/Non-EC', 'EC Goods', 'EC Services', 'Reverse Charge', 'EC VAT MOSS'],
                description: 'Optional VAT status for EC transactions'
              },
              omit_header: {
                type: 'boolean',
                description: 'Optional flag to hide logo and company address'
              },
              bank_account: {
                type: 'string',
                description: 'Optional bank account URI for remittance advice display'
              }
            },
            required: ['contact', 'dated_on', 'payment_terms_in_days', 'credit_note_items']
          }
        },
        {
          name: 'mark_credit_note_as_sent',
          description: 'Mark a credit note as sent',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Credit note ID (e.g., "123" from the credit note URL)'
              }
            },
            required: ['id']
          }
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      console.error(`[Tool] Executing ${request.params.name}:`, request.params.arguments);

      try {
        switch (request.params.name) {
          case 'list_timeslips': {
            const timeslips = await this.client.listTimeslips(request.params.arguments);
            return {
              content: [{ type: 'text', text: JSON.stringify(timeslips, null, 2) }]
            };
          }

          case 'get_timeslip': {
            const { id } = request.params.arguments as { id: string };
            const timeslip = await this.client.getTimeslip(id);
            return {
              content: [{ type: 'text', text: JSON.stringify(timeslip, null, 2) }]
            };
          }

          case 'create_timeslip': {
            const attributes = validateTimeslipAttributes(request.params.arguments);
            const timeslip = await this.client.createTimeslip(attributes);
            return {
              content: [{ type: 'text', text: JSON.stringify(timeslip, null, 2) }]
            };
          }

          case 'update_timeslip': {
            const { id, ...updates } = request.params.arguments as { id: string } & Record<string, unknown>;
            // Only include valid update fields
            const validUpdates: Partial<TimeslipAttributes> = {};
            if (typeof updates.task === 'string') validUpdates.task = updates.task;
            if (typeof updates.user === 'string') validUpdates.user = updates.user;
            if (typeof updates.project === 'string') validUpdates.project = updates.project;
            if (typeof updates.dated_on === 'string') validUpdates.dated_on = updates.dated_on;
            if (typeof updates.hours === 'string') validUpdates.hours = updates.hours;
            if (typeof updates.comment === 'string') validUpdates.comment = updates.comment;

            const timeslip = await this.client.updateTimeslip(id, validUpdates);
            return {
              content: [{ type: 'text', text: JSON.stringify(timeslip, null, 2) }]
            };
          }

          case 'delete_timeslip': {
            const { id } = request.params.arguments as { id: string };
            await this.client.deleteTimeslip(id);
            return {
              content: [{ type: 'text', text: 'Timeslip deleted successfully' }]
            };
          }

          case 'start_timer': {
            const { id } = request.params.arguments as { id: string };
            const timeslip = await this.client.startTimer(id);
            return {
              content: [{ type: 'text', text: JSON.stringify(timeslip, null, 2) }]
            };
          }

          case 'stop_timer': {
            const { id } = request.params.arguments as { id: string };
            const timeslip = await this.client.stopTimer(id);
            return {
              content: [{ type: 'text', text: JSON.stringify(timeslip, null, 2) }]
            };
          }

          case 'create_credit_note': {
            const attributes = validateCreditNoteAttributes(request.params.arguments);
            const creditNote = await this.client.createCreditNote(attributes);

            // Extract IDs from URLs for easier reference
            const credit_note_id = extractIdFromUrl(creditNote.url, 'credit_note');
            const contact_id = extractIdFromUrl(creditNote.contact, 'contact');

            // Return enhanced response with extracted IDs
            const enhancedResponse = {
              ...creditNote,
              credit_note_id,
              contact_id
            };

            return {
              content: [{ type: 'text', text: JSON.stringify(enhancedResponse, null, 2) }]
            };
          }

          case 'mark_credit_note_as_sent': {
            const { id } = request.params.arguments as { id: string };
            const creditNote = await this.client.markCreditNoteAsSent(id);
            return {
              content: [{ type: 'text', text: JSON.stringify(creditNote, null, 2) }]
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: any) {
        console.error(`[Error] Tool ${request.params.name} failed:`, error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('FreeAgent MCP server running on stdio');
  }
}

const server = new FreeAgentServer();
server.run().catch(console.error);
