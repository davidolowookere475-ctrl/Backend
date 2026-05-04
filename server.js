const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// ========== YOUR CONFIGURATION - UPDATE THESE ==========
const CLARITY_SECRET_KEY = 'sk_xxxxxxxxxxxxx';     // Get from Clarity dashboard
const VTPASS_EMAIL = 'your_vtpass_email@gmail.com';    // Your VTpass email
const VTPASS_PASSWORD = 'your_vtpass_password';        // Your VTpass password
// =======================================================

let transactions = [];
let vtpassToken = null;
let tokenExpiry = null;

// VTpass Authentication
async function getVTpassToken() {
    if (vtpassToken && tokenExpiry > Date.now()) {
        return vtpassToken;
    }
    
    try {
        const response = await axios.post('https://vtpass.com/api/login', {
            email: VTPASS_EMAIL,
            password: VTPASS_PASSWORD
        });
        
        vtpassToken = response.data.token;
        tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
        return vtpassToken;
    } catch (error) {
        console.error('VTpass login failed:', error.response?.data || error.message);
        throw new Error('VTpass authentication failed');
    }
}

// Health check endpoint (for testing)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Signal Strength Inc Backend is running!',
        timestamp: new Date().toISOString(),
        transactions: transactions.length
    });
});

// Initiate payment endpoint
app.post('/initiate-payment', async (req, res) => {
    const { email, amount, smartcard, service, packageCode, packageName, phone } = req.body;
    
    const reference = 'SIG-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    
    // Store transaction
    const transaction = {
        id: reference,
        reference: reference,
        email: email,
        amount: amount,
        smartcard: smartcard,
        service: service,
        packageCode: packageCode,
        packageName: packageName,
        phone: phone,
        status: 'pending',
        date: new Date().toISOString()
    };
    transactions.push(transaction);
    
    console.log(`📝 New order: ${service.toUpperCase()} - ${packageName}`);
    console.log(`💰 Amount: ₦${amount}`);
    console.log(`🔢 Smartcard: ${smartcard}`);
    
    // For now, return success (you'll add Clarity later)
    res.json({
        authorization_url: 'https://claritypay.com/sandbox/pay',
        reference: reference,
        message: 'Payment endpoint ready - Add your Clarity API key'
    });
});

// Webhook endpoint
app.post('/clarity-webhook', async (req, res) => {
    console.log('Webhook received:', req.body);
    res.sendStatus(200);
});

// Admin endpoint
app.get('/admin/transactions', (req, res) => {
    res.json(transactions.reverse());
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'Signal Strength Inc API',
        version: '1.0.0',
        status: 'running',
        endpoints: ['/health', '/initiate-payment', '/admin/transactions', '/clarity-webhook']
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`✅ Health check: https://signalstrengthinc.onrender.com/health`);
    console.log(`💰 DStv profit: ₦3,000 | GOtv profit: ₦1,000`);
});
