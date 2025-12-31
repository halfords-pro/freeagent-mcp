export interface TimeslipAttributes {
    url?: string;
    task: string;
    user: string;
    project: string;
    dated_on: string;
    hours: string;
    comment?: string;
    billed_on_invoice?: string;
    created_at?: string;
    updated_at?: string;
    timer?: TimerAttributes;
}

export interface TimerAttributes {
    running: boolean;
    start_from: string;
}

export interface Timeslip {
    url: string;
    task: string;
    user: string;
    project: string;
    dated_on: string;
    hours: string;
    comment?: string;
    billed_on_invoice?: string;
    created_at: string;
    updated_at: string;
    timer?: TimerAttributes;
}

export interface TimeslipsResponse {
    timeslips: Timeslip[];
}

export interface TimeslipResponse {
    timeslip: Timeslip;
}

export interface FreeAgentConfig {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
}

// Credit Note Types
export interface CreditNoteItemAttributes {
    description: string;
    price: string | number;
    quantity: number;
    sales_tax_rate?: string | number;  // Optional tax rate
    sales_tax_status?: 'TAXABLE' | 'EXEMPT' | 'OUT_OF_SCOPE';  // Optional tax status
    // TODO: Add other optional fields (item_type, category)
}

export interface CreditNoteAttributes {
    contact: string;  // URI format
    dated_on: string;  // YYYY-MM-DD
    payment_terms_in_days: number;
    credit_note_items: CreditNoteItemAttributes[];
    comments?: string;  // Optional comments
    involves_sales_tax?: boolean;  // Optional sales tax indicator
    // TODO: Add other optional fields (reference, currency, project, etc.)
}

export interface CreditNote {
    url: string;
    contact: string;
    dated_on: string;
    payment_terms_in_days: number;
    credit_note_items: CreditNoteItemAttributes[];
    created_at: string;
    updated_at: string;
    status?: string;  // Credit note status (e.g., "Draft", "Sent")
    // TODO: Add response fields (reference, total_value, net_value, sales_tax_value, etc.)
}

export interface CreditNoteResponse {
    credit_note: CreditNote;
}
