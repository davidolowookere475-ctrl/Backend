const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// ========== YOUR CONFIGURATION ==========
const CLARITY_SECRET_KEY = 'sk_xxxxxxxxxxxxx';     // From Clarity dashboard
const VTPASS_EMAIL = 'youremail@gmail.com';        // Your VTpass email
const VTPASS_PASSWORD = 'your_vtpass_password';    // Your VTpass password
// Markup: DStv = ₦3,000, GOtv = ₦1,000 (handled per transaction)
// ==========================================

let transactions = [];
let vtpassToken = null;
let tokenExpiry = null;

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

async function renewDecoderWithFloat(smartcard, service, packageCode, vtpassAmount) {
    try {
        const token = await getVTpassToken();
        
        let serviceId = '';
        if (service === 'dstv') {
            serviceId = 'dstv';
        } else if (service === 'gotv') {
            serviceId = 'gotv';
        }
        
        console.log(`🔄 Renewing ${service} smartcard ${smartcard}`);
        console.log(`💰 Deducting ₦${vtpassAmount} from your VTpass FLOAT`);
        
        const response = await axios.post('https://vtpass.com/api/pay', {
            serviceID: serviceId,
            billersCode: smartcard,
            variation_code: packageCode,
            phone: '07079197823',
            subscription_type: 'monthly'
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log(`✅ Renewal successful! Transaction ID: ${response.data.transactionId}`);
        
        return {
            success: true,
            transactionId: response.data.transactionId,
            message: `Decoder renewed. Float deducted: ₦${vtpassAmount}`
        };
    } catch (error) {
        console.error('❌ VTpass renewal failed:', error.response?.data || error.message);
        return {
            success: false,
            message: error.response?.data?.message || 'Renewal failed. Your float may be low.'
        };
    }
}

app.post('/initiate-payment', async (req, res) => {
    const { email, amount, vtpassAmount, smartcard, service, packageCode, packageName, phone, profit } = req.body;
    
    const reference = 'SIG-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    
    const transaction = {
        id: reference,
        reference: reference,
        email: email,
        customerAmount: amount,
        vtpassAmount: vtpassAmount,
        profit: profit,
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
    console.log(`💰 Customer pays: ₦${amount}`);
    console.log(`💸 VTpass cost: ₦${vtpassAmount}`);
    console.log(`✅ Your profit: ₦${profit}`);
    
    try {
        const response = await axios.post('https://api.claritypay.com/v1/transaction/initialize', {
            public_key: CLARITY_SECRET_KEY,
            reference: reference,
            amount: amount,
            currency: 'NGN',
            email: email,
            metadata: {
                smartcard: smartcard,
                service: service,
                packageCode: packageCode,
                packageName: packageName,
                phone: phone,
                vtpassAmount: vtpassAmount,
                yourProfit: profit
            }
        }, {
            headers: {
                'Authorization': `Bearer ${CLARITY_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        res.json({
            authorization_url: response.data.data.authorization_url,
            reference: reference
        });
    } catch (error) {
        console.error('Payment init failed:', error.response?.data || error.message);
        res.status(500).json({ error: 'Payment initialization failed' });
    }
});

app.post('/clarity-webhook', async (req, res) => {
    const event = req.body;
    
    if (event.event === 'charge.success') {
        const transaction = transactions.find(t => t.reference === event.data.reference);
        
        if (transaction && transaction.status === 'pending') {
            console.log(`💰 Payment received: ${transaction.reference}`);
            console.log(`💵 Customer paid: ₦${transaction.customerAmount}`);
            console.log(`🔄 Renewing using float... (cost: ₦${transaction.vtpassAmount})`);
            console.log(`✅ Your profit: ₦${transaction.profit}`);
            
            const renewal = await renewDecoderWithFloat(
                transaction.smartcard,
                transaction.service,
                transaction.packageCode,
                transaction.vtpassAmount
            );
            
            if (renewal.success) {
                transaction.status = 'completed';
                transaction.renewalId = renewal.transactionId;
                transaction.profitRealized = transaction.profit;
                
                console.log(`🎉 SUCCESS! Transaction complete.`);
                console.log(`💰 Your profit: ₦${transaction.profitRealized}`);
                console.log(`💵 Money will settle to your bank: OPAY 7079197823`);
                
            } else {
                transaction.status = 'float_insufficient';
                transaction.failureReason = renewal.message;
                
                console.log(`❌ FAILED! Float insufficient.`);
                console.log(`📌 Customer paid ₦${transaction.customerAmount} but your float is low.`);
                console.log(`📞 Manually renew: ${transaction.service} - ${transaction.smartcard}`);
            }
        }
    }
    
    res.sendStatus(200);
});

app.get('/admin/transactions', (req, res) => {
    const summary = {
        totalTransactions: transactions.length,
        totalProfit: transactions.reduce((sum, t) => sum + (t.profitRealized || 0), 0),
        totalRevenue: transactions.reduce((sum, t) => sum + (t.customerAmount || 0), 0),
        totalFloatUsed: transactions.reduce((sum, t) => sum + (t.vtpassAmount || 0), 0),
        transactions: transactions.reverse()
    };
    res.json(summary);
});

app.get('/admin/float-balance', async (req, res) => {
    try {
        const token = await getVTpassToken();
        const response = await axios.get('https://vtpass.com/api/wallet-balance', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        res.json({ balance: response.data.balance, currency: 'NGN' });
    } catch (error) {
        res.json({ error: 'Could not fetch float balance' });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        transactions: transactions.length,
        message: 'DStv +₦3,000 | GOtv +₦1,000'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`💰 DStv profit: ₦3,000 per transaction`);
    console.log(`💰 GOtv profit: ₦1,000 per transaction`);
    console.log(`💵 Customer pays your price, float pays VTpass price`);
});
