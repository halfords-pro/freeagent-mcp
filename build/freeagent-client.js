import axios from 'axios';
// TODO: BEFORE COMMITTING - Change api.sandbox.freeagent.com back to api.freeagent.com (production)
export class FreeAgentClient {
    constructor(config) {
        this.config = config;
        this.apiUrl = config.apiUrl || 'https://api.freeagent.com/v2';
        this.axiosInstance = axios.create({
            baseURL: this.apiUrl,
            headers: {
                'Authorization': `Bearer ${config.accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        // Add response interceptor for token refresh
        this.axiosInstance.interceptors.response.use(response => response, async (error) => {
            if (error.response?.status === 401) {
                await this.refreshToken();
                error.config.headers['Authorization'] = `Bearer ${this.config.accessToken}`;
                return this.axiosInstance.request(error.config);
            }
            return Promise.reject(error);
        });
    }
    async refreshToken() {
        try {
            const response = await axios.post(`${this.apiUrl}/token_endpoint`, {
                grant_type: 'refresh_token',
                refresh_token: this.config.refreshToken,
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret
            });
            this.config.accessToken = response.data.access_token;
            this.config.refreshToken = response.data.refresh_token;
            this.axiosInstance.defaults.headers['Authorization'] = `Bearer ${this.config.accessToken}`;
            console.error('[Auth] Successfully refreshed access token');
        }
        catch (error) {
            console.error('[Auth] Failed to refresh token:', error);
            throw error;
        }
    }
    async checkConnection() {
        try {
            await this.axiosInstance.get('/contacts', {
                params: {
                    view: 'active',
                    per_page: 1
                }
            });
            return {
                status: 'connected',
                apiUrl: this.apiUrl
            };
        }
        catch (error) {
            return {
                status: 'failed',
                apiUrl: this.apiUrl
            };
        }
    }
    async listTimeslips(params) {
        try {
            console.error('[API] Fetching timeslips with params:', params);
            const response = await this.axiosInstance.get('/timeslips', { params });
            return response.data.timeslips;
        }
        catch (error) {
            console.error('[API] Failed to fetch timeslips:', error);
            throw error;
        }
    }
    async getTimeslip(id) {
        try {
            console.error('[API] Fetching timeslip:', id);
            const response = await this.axiosInstance.get(`/timeslips/${id}`);
            return response.data.timeslip;
        }
        catch (error) {
            console.error('[API] Failed to fetch timeslip:', error);
            throw error;
        }
    }
    async createTimeslip(timeslip) {
        try {
            console.error('[API] Creating timeslip:', timeslip);
            const response = await this.axiosInstance.post('/timeslips', {
                timeslip
            });
            return response.data.timeslip;
        }
        catch (error) {
            console.error('[API] Failed to create timeslip:', error);
            throw error;
        }
    }
    async createTimeslips(timeslips) {
        try {
            console.error('[API] Creating multiple timeslips:', timeslips);
            const response = await this.axiosInstance.post('/timeslips', {
                timeslips
            });
            return response.data.timeslips;
        }
        catch (error) {
            console.error('[API] Failed to create timeslips:', error);
            throw error;
        }
    }
    async updateTimeslip(id, timeslip) {
        try {
            console.error('[API] Updating timeslip:', id, timeslip);
            const response = await this.axiosInstance.put(`/timeslips/${id}`, {
                timeslip
            });
            return response.data.timeslip;
        }
        catch (error) {
            console.error('[API] Failed to update timeslip:', error);
            throw error;
        }
    }
    async deleteTimeslip(id) {
        try {
            console.error('[API] Deleting timeslip:', id);
            await this.axiosInstance.delete(`/timeslips/${id}`);
        }
        catch (error) {
            console.error('[API] Failed to delete timeslip:', error);
            throw error;
        }
    }
    async startTimer(id) {
        try {
            console.error('[API] Starting timer for timeslip:', id);
            const response = await this.axiosInstance.post(`/timeslips/${id}/timer`);
            return response.data.timeslip;
        }
        catch (error) {
            console.error('[API] Failed to start timer:', error);
            throw error;
        }
    }
    async stopTimer(id) {
        try {
            console.error('[API] Stopping timer for timeslip:', id);
            const response = await this.axiosInstance.delete(`/timeslips/${id}/timer`);
            return response.data.timeslip;
        }
        catch (error) {
            console.error('[API] Failed to stop timer:', error);
            throw error;
        }
    }
    async createCreditNote(creditNoteAttributes) {
        try {
            console.error('[API] Creating credit note:', creditNoteAttributes);
            // Note: Validation happens at the MCP tool layer before reaching this method
            const response = await this.axiosInstance.post('/credit_notes', {
                credit_note: creditNoteAttributes
            });
            // TODO: Handle 201 Created status and Location header if needed
            return response.data.credit_note;
        }
        catch (error) {
            console.error('[API] Failed to create credit note:', error);
            // Enhanced error handling for FreeAgent API responses
            if (axios.isAxiosError(error)) {
                const statusCode = error.response?.status;
                const apiError = error.response?.data;
                if (statusCode === 400) {
                    throw new Error(`Invalid credit note data: ${JSON.stringify(apiError)}`);
                }
                else if (statusCode === 401) {
                    throw new Error('Authentication failed. Please check your API credentials.');
                }
                else if (statusCode === 422) {
                    throw new Error(`Validation failed: ${JSON.stringify(apiError)}`);
                }
                else if (statusCode) {
                    throw new Error(`FreeAgent API error (${statusCode}): ${JSON.stringify(apiError)}`);
                }
            }
            throw error;
        }
    }
    async markCreditNoteAsSent(id) {
        try {
            console.error('[API] Marking credit note as sent:', id);
            const response = await this.axiosInstance.put(`/credit_notes/${id}/transitions/mark_as_sent`);
            return response.data.credit_note;
        }
        catch (error) {
            console.error('[API] Failed to mark credit note as sent:', error);
            throw error;
        }
    }
    async emailCreditNote(id, emailParams) {
        try {
            console.error('[API] Emailing credit note:', id);
            const payload = {
                credit_note: {
                    email: emailParams
                }
            };
            await this.axiosInstance.post(`/credit_notes/${id}/send_email`, payload);
            console.error('[API] Credit note emailed successfully');
        }
        catch (error) {
            console.error('[API] Failed to email credit note:', error);
            throw error;
        }
    }
    async listCreditNotes(params) {
        try {
            console.error('[API] Fetching credit notes with params:', params);
            const response = await this.axiosInstance.get('/credit_notes', { params });
            // Log pagination info for debugging
            if (response.headers['x-total-count']) {
                console.error('[API] Total credit notes:', response.headers['x-total-count']);
            }
            if (response.headers.link) {
                console.error('[API] Pagination links available');
            }
            return response.data.credit_notes;
        }
        catch (error) {
            console.error('[API] Failed to fetch credit notes:', error);
            throw error;
        }
    }
    async listInvoices(params) {
        try {
            console.error('[DEBUG] listInvoices method called with endpoint: /invoices');
            console.error('[API] Fetching invoices with params:', params);
            const response = await this.axiosInstance.get('/invoices', { params });
            console.error('[DEBUG] Response data keys:', Object.keys(response.data));
            console.error('[DEBUG] Response data type check - has invoices?', 'invoices' in response.data);
            console.error('[DEBUG] Response data type check - has credit_notes?', 'credit_notes' in response.data);
            if (response.headers['x-total-count']) {
                console.error('[API] Total invoices:', response.headers['x-total-count']);
            }
            if (response.headers.link) {
                console.error('[API] Pagination links available');
            }
            return response.data.invoices;
        }
        catch (error) {
            console.error('[API] Failed to fetch invoices:', error);
            throw error;
        }
    }
    async getInvoice(id) {
        try {
            console.error('[API] Fetching invoice:', id);
            const response = await this.axiosInstance.get(`/invoices/${id}`);
            return response.data.invoice;
        }
        catch (error) {
            console.error('[API] Failed to fetch invoice:', error);
            throw error;
        }
    }
    async getContact(id) {
        try {
            console.error('[API] Fetching contact:', id);
            const response = await this.axiosInstance.get(`/contacts/${id}`);
            return response.data.contact;
        }
        catch (error) {
            console.error('[API] Failed to fetch contact:', error);
            throw error;
        }
    }
    async listBankAccounts(params) {
        try {
            console.error('[API] Fetching bank accounts with params:', params);
            const response = await this.axiosInstance.get('/bank_accounts', { params });
            return response.data.bank_accounts;
        }
        catch (error) {
            console.error('[API] Failed to fetch bank accounts:', error);
            throw error;
        }
    }
    constructCreditNoteUri(creditNoteId) {
        return `${this.apiUrl}/credit_notes/${creditNoteId}`;
    }
    constructBankAccountUri(bankAccountId) {
        // Handle both ID and full URI
        if (bankAccountId.startsWith('http')) {
            return bankAccountId;
        }
        return `${this.apiUrl}/bank_accounts/${bankAccountId}`;
    }
    async createBankTransactionExplanation(creditNoteId, bankAccountId, attributes) {
        try {
            console.error('[API] Creating bank transaction explanation (Credit Note Refund) for credit note:', creditNoteId);
            const payload = {
                bank_transaction_explanation: {
                    bank_account: this.constructBankAccountUri(bankAccountId),
                    dated_on: attributes.dated_on,
                    gross_value: attributes.gross_value,
                    paid_invoice: this.constructCreditNoteUri(creditNoteId),
                    ...(attributes.description && { description: attributes.description })
                }
            };
            console.error('[API] Payload:', payload);
            const response = await this.axiosInstance.post('/bank_transaction_explanations', payload);
            return response.data.bank_transaction_explanation;
        }
        catch (error) {
            console.error('[API] Failed to create bank transaction explanation:', error);
            // Enhanced error handling similar to createCreditNote
            if (axios.isAxiosError(error)) {
                const statusCode = error.response?.status;
                const apiError = error.response?.data;
                if (statusCode === 400) {
                    throw new Error(`Invalid bank transaction explanation data: ${JSON.stringify(apiError)}`);
                }
                else if (statusCode === 401) {
                    throw new Error('Authentication failed. Please check your API credentials.');
                }
                else if (statusCode === 422) {
                    throw new Error(`Validation failed: ${JSON.stringify(apiError)}`);
                }
                else if (statusCode) {
                    throw new Error(`FreeAgent API error (${statusCode}): ${JSON.stringify(apiError)}`);
                }
            }
            throw error;
        }
    }
}
