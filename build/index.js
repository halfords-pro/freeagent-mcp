#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { FreeAgentClient } from './freeagent-client.js';
const CLIENT_ID = process.env.FREEAGENT_CLIENT_ID;
const CLIENT_SECRET = process.env.FREEAGENT_CLIENT_SECRET;
const ACCESS_TOKEN = process.env.FREEAGENT_ACCESS_TOKEN;
const REFRESH_TOKEN = process.env.FREEAGENT_REFRESH_TOKEN;
const API_URL = process.env.FREEAGENT_API_URL;
if (!CLIENT_ID || !CLIENT_SECRET || !ACCESS_TOKEN || !REFRESH_TOKEN) {
    throw new Error('Missing required environment variables for FreeAgent authentication');
}
/**
 * Validates email address format according to RFC 5322.
 * Accepts both formats:
 * - addr-spec: name@domain.com, name.name@domain.com
 * - name-addr/mailbox: "Display Name" <name@domain.com>, Display Name <name@domain.com>
 */
function isValidEmail(email) {
    const trimmed = email.trim();
    // Check for name-addr format: "Name" <email@domain.com> or Name <email@domain.com>
    const nameAddrMatch = trimmed.match(/^(?:"?([^"]*)"?\s*)?<(.+)>$/);
    let emailToValidate;
    if (nameAddrMatch) {
        // name-addr format - extract email from angle brackets
        emailToValidate = nameAddrMatch[2].trim();
    }
    else {
        // addr-spec format - use as is
        emailToValidate = trimmed;
    }
    // Validate the email address (addr-spec)
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(emailToValidate);
}
function extractIdFromUrl(url, resourceType) {
    if (!url)
        return undefined;
    // Extract ID from URL like "https://api.sandbox.freeagent.com/v2/credit_notes/123"
    const match = url.match(/\/(\d+)$/);
    if (!match) {
        console.error(`[Warning] Failed to extract ${resourceType} ID from URL: ${url}`);
        return undefined;
    }
    return match[1];
}
function validateTimeslipAttributes(data) {
    if (typeof data !== 'object' || !data) {
        throw new Error('Invalid timeslip data: must be an object');
    }
    const attrs = data;
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
        comment: attrs.comment
    };
}
function validateCreditNoteItemAttributes(data) {
    if (typeof data !== 'object' || !data) {
        throw new Error('Invalid credit note item: must be an object');
    }
    const item = data;
    if (typeof item.description !== 'string' || item.description.trim() === '') {
        throw new Error('Invalid credit note item: description must be a non-empty string');
    }
    // Validate price is a valid number or numeric string
    let priceValue;
    if (typeof item.price === 'number') {
        priceValue = item.price;
    }
    else if (typeof item.price === 'string') {
        priceValue = parseFloat(item.price);
        if (isNaN(priceValue)) {
            throw new Error('Invalid credit note item: price must be a valid number');
        }
    }
    else {
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
    const validatedItem = {
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
function validateCreditNoteAttributes(data) {
    if (typeof data !== 'object' || !data) {
        throw new Error('Invalid credit note data: must be an object');
    }
    const attrs = data;
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
        }
        catch (error) {
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
    const validatedCreditNote = {
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
function validateBankTransactionExplanationParams(data) {
    if (typeof data !== 'object' || !data) {
        throw new Error('Invalid bank transaction explanation data: must be an object');
    }
    const params = data;
    // Validate required fields for Credit Note Refund type
    if (typeof params.credit_note_id !== 'string' || params.credit_note_id.trim() === '') {
        throw new Error('Invalid data: credit_note_id must be a non-empty string (required for credit note refund explanations)');
    }
    // Validate credit_note_id is a positive integer
    const creditNoteIdNum = parseInt(params.credit_note_id, 10);
    if (isNaN(creditNoteIdNum) || creditNoteIdNum <= 0 || params.credit_note_id !== creditNoteIdNum.toString()) {
        throw new Error('Invalid data: credit_note_id must be a positive integer');
    }
    if (typeof params.bank_account_id !== 'string' || params.bank_account_id.trim() === '') {
        throw new Error('Invalid data: bank_account_id must be a non-empty string (ID or URI)');
    }
    if (typeof params.dated_on !== 'string') {
        throw new Error('Invalid data: dated_on must be a string');
    }
    // Validate dated_on format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(params.dated_on)) {
        throw new Error('Invalid data: dated_on must be in YYYY-MM-DD format');
    }
    // Validate it's a valid date
    const dateObj = new Date(params.dated_on);
    if (isNaN(dateObj.getTime())) {
        throw new Error('Invalid data: dated_on must be a valid date');
    }
    if (typeof params.gross_value !== 'string' && typeof params.gross_value !== 'number') {
        throw new Error('Invalid data: gross_value must be a string or number');
    }
    // Validate gross_value is a valid decimal
    const grossValueStr = params.gross_value.toString();
    const grossValueNum = parseFloat(grossValueStr);
    if (isNaN(grossValueNum)) {
        throw new Error('Invalid data: gross_value must be a valid decimal number');
    }
    // Validate optional description
    if (params.description !== undefined && typeof params.description !== 'string') {
        throw new Error('Invalid data: description must be a string');
    }
    return {
        credit_note_id: params.credit_note_id,
        bank_account_id: params.bank_account_id,
        dated_on: params.dated_on,
        gross_value: grossValueStr,
        description: params.description
    };
}
class FreeAgentServer {
    constructor() {
        console.error('[Setup] Initializing FreeAgent MCP server...');
        this.client = new FreeAgentClient({
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            accessToken: ACCESS_TOKEN,
            refreshToken: REFRESH_TOKEN,
            apiUrl: API_URL
        });
        this.server = new Server({
            name: 'freeagent-mcp',
            version: '0.1.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }
    setupToolHandlers() {
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
                    name: 'email_credit_note',
                    description: 'Email a credit note to a contact',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'string',
                                description: 'Credit note ID (e.g., "123" from the credit note URL)'
                            },
                            to: {
                                type: 'string',
                                description: 'Recipient email address in RFC 5322 format (e.g., "customer@example.com" or "John Doe <john.doe@example.com>")'
                            },
                            from: {
                                type: 'string',
                                description: 'Sender email address in RFC 5322 format (must belong to a registered user). Examples: "sender@example.com" or "John Doe <john.doe@example.com>"'
                            },
                            subject: {
                                type: 'string',
                                description: 'Email subject line'
                            },
                            body: {
                                type: 'string',
                                description: 'Email message content'
                            },
                            email_to_sender: {
                                type: 'boolean',
                                description: 'Whether to send a copy to the sender (defaults to true)'
                            },
                            use_template: {
                                type: 'boolean',
                                description: 'Whether to use an email template'
                            }
                        },
                        required: ['id', 'to', 'from', 'subject', 'body']
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
                    name: 'get_contact',
                    description: 'Get a single contact by ID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'string',
                                description: 'Contact ID (e.g., "123" from the contact URL - https://api.freeagent.com/v2/invoices/[INVOICE ID])'
                            }
                        },
                        required: ['id']
                    }
                },
                {
                    name: 'get_invoice',
                    description: 'Get a single invoice by ID',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            id: {
                                type: 'string',
                                description: 'Invoice ID (e.g., "123" from the invoice URL)'
                            }
                        },
                        required: ['id']
                    }
                },
                {
                    name: 'create_bank_transaction_explanation',
                    description: 'Create a bank transaction explanation. NOTE: Current implementation ONLY supports Credit Note Refunds. Other transaction types (invoice payments, bill payments, etc.) are not yet supported.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            credit_note_id: {
                                type: 'string',
                                description: 'Credit note ID (e.g., "699571", "1000029818" - must be a positive integer). Required for credit note refund explanations.'
                            },
                            bank_account_id: {
                                type: 'string',
                                description: 'Bank account ID or URI (e.g., "123" or "https://api.freeagent.com/v2/bank_accounts/123")'
                            },
                            dated_on: {
                                type: 'string',
                                description: 'Transaction date in YYYY-MM-DD format'
                            },
                            gross_value: {
                                type: 'string',
                                description: 'Transaction amount as decimal (e.g., "100.50" for refund, negative values supported)'
                            },
                            description: {
                                type: 'string',
                                description: 'Optional description of the transaction'
                            }
                        },
                        required: ['credit_note_id', 'bank_account_id', 'dated_on', 'gross_value']
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
                },
                {
                    name: 'list_invoices',
                    description: 'List invoices with optional filtering, sorting, and pagination. Returns up to 25 items by default (max 100 per page).',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            view: {
                                type: 'string',
                                enum: [
                                    'all',
                                    'recent_open_or_overdue',
                                    'open',
                                    'overdue',
                                    'open_or_overdue',
                                    'draft',
                                    'paid',
                                    'scheduled_to_email',
                                    'thank_you_emails',
                                    'reminder_emails'
                                ],
                                description: 'Filter by invoice status view. Also supports "last_N_months" format (e.g., "last_6_months")'
                            },
                            updated_since: {
                                type: 'string',
                                description: 'Date or datetime to filter invoices updated since. Accepts YYYY-MM-DD or ISO datetime'
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
                                description: 'Items per page (default: 25, max: 100)'
                            },
                            nested: {
                                type: 'boolean',
                                description: 'Include nested invoice items (default: false)'
                            }
                        }
                    }
                },
                {
                    name: 'list_bank_accounts',
                    description: 'List bank accounts with optional filtering by account type',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            view: {
                                type: 'string',
                                enum: ['standard_bank_accounts', 'credit_card_accounts', 'paypal_accounts'],
                                description: 'Filter by account type'
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
                        const { id } = request.params.arguments;
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
                        const { id, ...updates } = request.params.arguments;
                        // Only include valid update fields
                        const validUpdates = {};
                        if (typeof updates.task === 'string')
                            validUpdates.task = updates.task;
                        if (typeof updates.user === 'string')
                            validUpdates.user = updates.user;
                        if (typeof updates.project === 'string')
                            validUpdates.project = updates.project;
                        if (typeof updates.dated_on === 'string')
                            validUpdates.dated_on = updates.dated_on;
                        if (typeof updates.hours === 'string')
                            validUpdates.hours = updates.hours;
                        if (typeof updates.comment === 'string')
                            validUpdates.comment = updates.comment;
                        const timeslip = await this.client.updateTimeslip(id, validUpdates);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(timeslip, null, 2) }]
                        };
                    }
                    case 'delete_timeslip': {
                        const { id } = request.params.arguments;
                        await this.client.deleteTimeslip(id);
                        return {
                            content: [{ type: 'text', text: 'Timeslip deleted successfully' }]
                        };
                    }
                    case 'start_timer': {
                        const { id } = request.params.arguments;
                        const timeslip = await this.client.startTimer(id);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(timeslip, null, 2) }]
                        };
                    }
                    case 'stop_timer': {
                        const { id } = request.params.arguments;
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
                        const { id } = request.params.arguments;
                        const creditNote = await this.client.markCreditNoteAsSent(id);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(creditNote, null, 2) }]
                        };
                    }
                    case 'email_credit_note': {
                        const args = request.params.arguments;
                        // Validate email addresses
                        if (!isValidEmail(args.to)) {
                            throw new Error(`Invalid recipient email address: ${args.to}`);
                        }
                        if (!isValidEmail(args.from)) {
                            throw new Error(`Invalid sender email address: ${args.from}`);
                        }
                        const emailParams = {
                            to: args.to,
                            from: args.from,
                            subject: args.subject,
                            body: args.body,
                            ...(args.email_to_sender !== undefined && { email_to_sender: args.email_to_sender }),
                            ...(args.use_template !== undefined && { use_template: args.use_template })
                        };
                        await this.client.emailCreditNote(args.id, emailParams);
                        return {
                            content: [{
                                    type: 'text',
                                    text: JSON.stringify({
                                        success: true,
                                        message: `Credit note ${args.id} sent successfully to ${args.to}`
                                    }, null, 2)
                                }]
                        };
                    }
                    case 'check_connection_status': {
                        const status = await this.client.checkConnection();
                        return {
                            content: [{ type: 'text', text: JSON.stringify(status, null, 2) }]
                        };
                    }
                    case 'get_contact': {
                        const { id } = request.params.arguments;
                        const contact = await this.client.getContact(id);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(contact, null, 2) }]
                        };
                    }
                    case 'get_invoice': {
                        const { id } = request.params.arguments;
                        const invoice = await this.client.getInvoice(id);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(invoice, null, 2) }]
                        };
                    }
                    case 'create_bank_transaction_explanation': {
                        const params = validateBankTransactionExplanationParams(request.params.arguments);
                        const explanation = await this.client.createBankTransactionExplanation(params.credit_note_id, params.bank_account_id, {
                            dated_on: params.dated_on,
                            gross_value: params.gross_value,
                            description: params.description
                        });
                        // Extract ID from URL for easier reference
                        const explanation_id = extractIdFromUrl(explanation.url, 'bank_transaction_explanation');
                        // Return enhanced response
                        const enhancedResponse = {
                            ...explanation,
                            bank_transaction_explanation_id: explanation_id
                        };
                        return {
                            content: [{ type: 'text', text: JSON.stringify(enhancedResponse, null, 2) }]
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
                            delete params.nested; // Remove the MCP parameter
                        }
                        else {
                            delete params.nested; // Remove if false or undefined
                        }
                        const creditNotes = await this.client.listCreditNotes(params);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(creditNotes, null, 2) }]
                        };
                    }
                    case 'list_invoices': {
                        console.error('[DEBUG] list_invoices handler called');
                        const params = { ...request.params.arguments };
                        // Transform YYYY-MM-DD to ISO 8601 format
                        if (params.updated_since && typeof params.updated_since === 'string') {
                            if (params.updated_since.length === 10 && !params.updated_since.includes('T')) {
                                params.updated_since = `${params.updated_since}T00:00:00.000Z`;
                            }
                        }
                        // Transform nested to nested_invoice_items
                        if (params.nested === true) {
                            params.nested_invoice_items = true;
                            delete params.nested;
                        }
                        else {
                            delete params.nested;
                        }
                        console.error('[DEBUG] Calling this.client.listInvoices with params:', params);
                        const invoices = await this.client.listInvoices(params);
                        console.error('[DEBUG] Received data, count:', invoices?.length || 0);
                        console.error('[DEBUG] First item keys (if any):', invoices[0] ? Object.keys(invoices[0]).slice(0, 10) : 'no items');
                        return {
                            content: [{ type: 'text', text: JSON.stringify(invoices, null, 2) }]
                        };
                    }
                    case 'list_bank_accounts': {
                        const bankAccounts = await this.client.listBankAccounts(request.params.arguments);
                        return {
                            content: [{ type: 'text', text: JSON.stringify(bankAccounts, null, 2) }]
                        };
                    }
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
                }
            }
            catch (error) {
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
