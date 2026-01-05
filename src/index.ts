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
const API_URL = process.env.FREEAGENT_API_URL;

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

  if (typeof item.description !== 'string' || item.description.trim() === '') {
    throw new Error('Invalid credit note item: description must be a non-empty string');
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

  // Validate optional item_type if provided
  if (item.item_type !== undefined) {
    const validItemTypes = [
      'Hours', 'Days', 'Weeks', 'Months', 'Years',
      'Products', 'Services', 'Training', 'Expenses',
      'Comment', 'Bills', 'Discount', 'Credit', 'VAT', ''
    ];
    if (typeof item.item_type !== 'string' || !validItemTypes.includes(item.item_type)) {
      throw new Error('Invalid credit note item: item_type must be one of: Hours, Days, Weeks, Months, Years, Products, Services, Training, Expenses, Comment, Bills, Discount, Credit, VAT, or empty string');
    }
  }

  // Validate optional category if provided
  if (item.category !== undefined) {
    if (typeof item.category !== 'string' || !item.category.match(/^https?:\/\/.+\/categories\/\d+$/)) {
      throw new Error('Invalid credit note item: category must be a valid URI (e.g., https://api.freeagent.com/v2/categories/123)');
    }
  }

  // Validate optional project if provided
  if (item.project !== undefined) {
    if (typeof item.project !== 'string' || !item.project.match(/^https?:\/\/.+\/projects\/\d+$/)) {
      throw new Error('Invalid credit note item: project must be a valid URI (e.g., https://api.freeagent.com/v2/projects/123)');
    }
  }

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
  if (item.item_type !== undefined) {
    validatedItem.item_type = item.item_type;
  }
  if (item.category !== undefined) {
    validatedItem.category = item.category;
  }
  if (item.project !== undefined) {
    validatedItem.project = item.project;
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

  // Validate dated_on format (YYYY-MM-DD)
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(attrs.dated_on)) {
    throw new Error('Invalid credit note data: dated_on must be in YYYY-MM-DD format');
  }

  // Additional validation: check if it's a valid date
  const dateObj = new Date(attrs.dated_on);
  if (isNaN(dateObj.getTime())) {
    throw new Error('Invalid credit note data: dated_on must be a valid date');
  }

  // Validate contact is a valid URI format
  const contactUriRegex = /^https?:\/\/.+\/contacts\/\d+$/;
  if (!contactUriRegex.test(attrs.contact)) {
    throw new Error('Invalid credit note data: contact must be a valid URI (e.g., https://api.freeagent.com/v2/contacts/123)');
  }

  // Validate payment_terms_in_days is a non-negative integer
  if (!Number.isInteger(attrs.payment_terms_in_days) || attrs.payment_terms_in_days < 0) {
    throw new Error('Invalid credit note data: payment_terms_in_days must be a non-negative integer');
  }

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

  // Validate optional reference
  if (attrs.reference !== undefined) {
    if (typeof attrs.reference !== 'string' || attrs.reference.trim() === '') {
      throw new Error('Invalid credit note data: reference must be a non-empty string');
    }
  }

  // Validate optional currency (ISO 4217 currency codes - 3 uppercase letters)
  if (attrs.currency !== undefined) {
    const currencyRegex = /^[A-Z]{3}$/;
    if (typeof attrs.currency !== 'string' || !currencyRegex.test(attrs.currency)) {
      throw new Error('Invalid credit note data: currency must be a 3-letter ISO currency code (e.g., GBP, USD, EUR)');
    }
  }

  // Validate optional project
  if (attrs.project !== undefined) {
    const projectUriRegex = /^https?:\/\/.+\/projects\/\d+$/;
    if (typeof attrs.project !== 'string' || !projectUriRegex.test(attrs.project)) {
      throw new Error('Invalid credit note data: project must be a valid URI (e.g., https://api.freeagent.com/v2/projects/123)');
    }
  }

  // Validate optional ec_status
  if (attrs.ec_status !== undefined) {
    const validEcStatuses = ['UK/Non-EC', 'EC Goods', 'EC Services', 'Reverse Charge', 'EC VAT MOSS'];
    if (typeof attrs.ec_status !== 'string' || !validEcStatuses.includes(attrs.ec_status)) {
      throw new Error('Invalid credit note data: ec_status must be one of: UK/Non-EC, EC Goods, EC Services, Reverse Charge, EC VAT MOSS');
    }
  }

  // Validate optional omit_header
  if (attrs.omit_header !== undefined && typeof attrs.omit_header !== 'boolean') {
    throw new Error('Invalid credit note data: omit_header must be a boolean');
  }

  // Validate optional bank_account
  if (attrs.bank_account !== undefined) {
    const bankAccountUriRegex = /^https?:\/\/.+\/bank_accounts\/\d+$/;
    if (typeof attrs.bank_account !== 'string' || !bankAccountUriRegex.test(attrs.bank_account)) {
      throw new Error('Invalid credit note data: bank_account must be a valid URI (e.g., https://api.freeagent.com/v2/bank_accounts/123)');
    }
  }

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
  if (attrs.reference !== undefined) {
    validatedCreditNote.reference = attrs.reference;
  }
  if (attrs.currency !== undefined) {
    validatedCreditNote.currency = attrs.currency;
  }
  if (attrs.project !== undefined) {
    validatedCreditNote.project = attrs.project;
  }
  if (attrs.ec_status !== undefined) {
    validatedCreditNote.ec_status = attrs.ec_status;
  }
  if (attrs.omit_header !== undefined) {
    validatedCreditNote.omit_header = attrs.omit_header;
  }
  if (attrs.bank_account !== undefined) {
    validatedCreditNote.bank_account = attrs.bank_account;
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
      refreshToken: REFRESH_TOKEN,
      apiUrl: API_URL
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
        },
        {
          name: 'check_connection_status',
          description: 'Check connection status to FreeAgent API and show configured endpoint',
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        {
          name: 'list_credit_notes',
          description: 'List credit notes with optional filtering, sorting, and pagination. Returns up to 25 items by default (max 100 per page).',
          inputSchema: {
            type: 'object',
            properties: {
              view: {
                type: 'string',
                enum: ['all', 'recent_open_or_overdue', 'open', 'overdue', 'open_or_overdue', 'draft', 'refunded'],
                description: 'Filter by status view. Also supports "last_N_months" format (e.g., "last_6_months")'
              },
              updated_since: {
                type: 'string',
                description: 'Date or datetime to filter credit notes updated since. Accepts YYYY-MM-DD (e.g., 2024-01-01) or full ISO datetime (e.g., 2024-01-01T00:00:00.000Z)'
              },
              contact: {
                type: 'string',
                description: 'Filter by contact URI (e.g., https://api.freeagent.com/v2/contacts/123)'
              },
              project: {
                type: 'string',
                description: 'Filter by project URI (e.g., https://api.freeagent.com/v2/projects/456)'
              },
              sort: {
                type: 'string',
                enum: ['created_at', 'updated_at', '-created_at', '-updated_at'],
                description: 'Sort order (prefix with - for descending)'
              },
              page: {
                type: 'number',
                description: 'Page number for pagination (default: 1)'
              },
              per_page: {
                type: 'number',
                description: 'Number of items per page (default: 25, max: 100)'
              },
              nested: {
                type: 'boolean',
                description: 'Include nested credit note items (default: false)'
              }
            }
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

          case 'check_connection_status': {
            const status = await this.client.checkConnection();
            return {
              content: [{ type: 'text', text: JSON.stringify(status, null, 2) }]
            };
          }

          case 'list_credit_notes': {
            // Transform updated_since from YYYY-MM-DD to ISO 8601 if needed
            const params = { ...request.params.arguments };

            if (params.updated_since && typeof params.updated_since === 'string') {
              // Check if format is YYYY-MM-DD (10 characters, no 'T')
              if (params.updated_since.length === 10 && !params.updated_since.includes('T')) {
                params.updated_since = `${params.updated_since}T00:00:00.000Z`;
              }
            }

            // Transform nested to API's nested_credit_note_items parameter
            if (params.nested === true) {
              params.nested_credit_note_items = true;
              delete params.nested;  // Remove the MCP parameter
            } else {
              delete params.nested;  // Remove if false or undefined
            }

            const creditNotes = await this.client.listCreditNotes(params);
            return {
              content: [{ type: 'text', text: JSON.stringify(creditNotes, null, 2) }]
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
