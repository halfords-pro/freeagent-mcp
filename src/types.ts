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

export interface Invoice {
    url: string;
    contact: string;
    project?: string;
    dated_on: string;
    due_on: string;
    reference?: string;
    currency: string;
    net_value: string;
    sales_tax_value: string;
    total_value: string;
    paid_value: string;
    due_value: string;
    status: string;
    created_at: string;
    updated_at: string;
}

export interface InvoicesResponse {
    invoices: Invoice[];
}

export interface FreeAgentConfig {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
}
