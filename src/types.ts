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

export interface InvoiceItemAttributes {
    description: string;
    price: string | number;
    quantity: number;
    sales_tax_rate?: string | number;
    sales_tax_status?: 'TAXABLE' | 'EXEMPT' | 'OUT_OF_SCOPE';
    item_type?: string;
    category?: string;
    project?: string;
}

export interface Invoice {
    // Core fields (always present)
    url: string;
    status: string;  // Draft, Scheduled To Email, Open, Zero Value, Overdue, Paid, etc.
    long_status: string;  // Status with relative due date
    contact: string;  // Contact URI
    dated_on: string;  // YYYY-MM-DD
    due_on: string;  // YYYY-MM-DD
    payment_terms_in_days: number;

    // Financial fields (always present)
    currency: string;  // ISO 4217 code
    exchange_rate: string;
    net_value: string;
    sales_tax_value: string;
    total_value: string;
    paid_value: string;
    due_value: string;

    // Timestamps (always present)
    created_at: string;
    updated_at: string;

    // Optional fields
    reference?: string;
    project?: string;  // Project URI
    property?: string;  // For UK unincorporated landlord companies only
    comments?: string;
    bank_account?: string;  // Bank account URI
    ec_status?: string;  // VAT status
    discount_percent?: string;
    client_contact_name?: string;  // Overrides default contact name
    payment_terms?: string;  // Custom payment terms text
    po_reference?: string;  // Purchase order reference

    // Boolean flags
    omit_header?: boolean;
    show_project_name?: boolean;
    always_show_bic_and_iban?: boolean;
    send_new_invoice_emails?: boolean;
    send_reminder_emails?: boolean;
    send_thank_you_emails?: boolean;

    // Conditional fields
    paid_on?: string;  // Present when fully paid (YYYY-MM-DD)
    written_off_date?: string;  // Present when written off (YYYY-MM-DD)
    recurring_invoice?: string;  // URI of source recurring invoice
    payment_methods?: Record<string, unknown>;  // Available payment options
    payment_url?: string;  // Online payment link

    // CIS-related fields (for Construction Industry Scheme)
    cis_rate?: string;
    cis_deduction_rate?: string;
    cis_deduction?: string;
    cis_deduction_suffered?: string;

    // Nested resources (when nested_invoice_items=true)
    invoice_items?: InvoiceItemAttributes[];
}

export interface InvoicesResponse {
    invoices: Invoice[];
}

export interface InvoiceResponse {
    invoice: Invoice;
}
