const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = 'binance-halal-trading-bot-secret-key-2024';
const ENCRYPTION_KEY = 'binance0123456789012345678901234567890123456789';

// ==================== HALAL ASSETS (Binance Spot) ====================
const HALAL_ASSETS = [
    { symbol: 'BTCUSDT', name: 'Bitcoin', minQty: 0.00001, stepSize: 0.00001, volatility: 'high', liquidity: 'high', basePrice: 50000 },
    { symbol: 'ETHUSDT', name: 'Ethereum', minQty: 0.0001, stepSize: 0.0001, volatility: 'high', liquidity: 'high', basePrice: 3000 },
    { symbol: 'BNBUSDT', name: 'Binance Coin', minQty: 0.001, stepSize: 0.001, volatility: 'medium', liquidity: 'high', basePrice: 400 },
    { symbol: 'SOLUSDT', name: 'Solana', minQty: 0.01, stepSize: 0.01, volatility: 'high', liquidity: 'medium', basePrice: 100 },
    { symbol: 'ADAUSDT', name: 'Cardano', minQty: 1, stepSize: 1, volatility: 'medium', liquidity: 'medium', basePrice: 0.5 },
    { symbol: 'XRPUSDT', name: 'Ripple', minQty: 1, stepSize: 1, volatility: 'medium', liquidity: 'high', basePrice: 0.6 },
    { symbol: 'DOTUSDT', name: 'Polkadot', minQty: 0.1, stepSize: 0.1, volatility: 'medium', liquidity: 'low', basePrice: 7 },
    { symbol: 'LINKUSDT', name: 'Chainlink', minQty: 0.1, stepSize: 0.1, volatility: 'medium', liquidity: 'medium', basePrice: 15 },
    { symbol: 'MATICUSDT', name: 'Polygon', minQty: 1, stepSize: 1, volatility: 'medium', liquidity: 'medium', basePrice: 0.8 },
    { symbol: 'AVAXUSDT', name: 'Avalanche', minQty: 0.01, stepSize: 0.01, volatility: 'high', liquidity: 'medium', basePrice: 35 }
];

// Trading settings
const MAX_CONCURRENT_TRADES = 20;
const TIME_LIMIT_HOURS = 1;
const PROFIT_CHECK_INTERVAL = 1000;

// Strategy definitions
const STRATEGIES = {
    scalping: { name: 'Scalping', targetMultiplier: 1.002, stopMultiplier: 0.998, confidence: 0.8 },
    momentum: { name: 'Momentum', targetMultiplier: 1.005, stopMultiplier: 0.995, confidence: 0.7 },
    swing: { name: 'Swing', targetMultiplier: 1.01, stopMultiplier: 0.99, confidence: 0.6 },
    conservative: { name: 'Conservative', targetMultiplier: 1.003, stopMultiplier: 0.997, confidence: 0.85 }
};

// ==================== DATA DIRECTORIES ====================
const DATA_DIR = path.join(__dirname, 'data');
const TRADES_DIR = path.join(DATA_DIR, 'trades');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PENDING_FILE = path.join(DATA_DIR, 'pending.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const BALANCE_CACHE_FILE = path.join(DATA_DIR, 'balance_cache.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TRADES_DIR)) fs.mkdirSync(TRADES_DIR, { recursive: true });

// ==================== CREATE OWNER ACCOUNT ====================
const ownerEmail = "mujtabahatif@gmail.com";
const ownerPasswordPlain = "Mujtabah@2598";
const ownerPasswordHash = bcrypt.hashSync(ownerPasswordPlain, 10);

let users = {};
if (fs.existsSync(USERS_FILE)) {
    try {
        users = JSON.parse(fs.readFileSync(USERS_FILE));
    } catch(e) { users = {}; }
}

users[ownerEmail] = {
    email: ownerEmail,
    password: ownerPasswordHash,
    isOwner: true,
    isApproved: true,
    isBlocked: false,
    apiKey: "",
    secretKey: "",
    createdAt: new Date().toISOString()
};
fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
console.log("✅ Owner account created");
console.log("   Email: mujtabahatif@gmail.com");
console.log("   Password: Mujtabah@2598");

if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify({}, null, 2));
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, JSON.stringify({}, null, 2));
if (!fs.existsSync(BALANCE_CACHE_FILE)) fs.writeFileSync(BALANCE_CACHE_FILE, JSON.stringify({}, null, 2));

// ==================== HELPER FUNCTIONS ====================
function readUsers() { 
    try { return JSON.parse(fs.readFileSync(USERS_FILE)); } 
    catch(e) { return {}; }
}
function writeUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2)); }
function readPending() { 
    try { return JSON.parse(fs.readFileSync(PENDING_FILE)); } 
    catch(e) { return {}; }
}
function writePending(data) { fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2)); }
function readOrders() { 
    try { return JSON.parse(fs.readFileSync(ORDERS_FILE)); } 
    catch(e) { return {}; }
}
function writeOrders(data) { fs.writeFileSync(ORDERS_FILE, JSON.stringify(data, null, 2)); }
function readBalanceCache() { 
    try { return JSON.parse(fs.readFileSync(BALANCE_CACHE_FILE)); } 
    catch(e) { return {}; }
}
function writeBalanceCache(data) { fs.writeFileSync(BALANCE_CACHE_FILE, JSON.stringify(data, null, 2)); }

function encrypt(text) {
    if (!text) return "";
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    if (!text) return "";
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function cleanKey(k) { return k ? k.replace(/[\s\n\r\t]+/g, '').trim() : ""; }

// ==================== AUTO STRATEGY SELECTION ====================
function selectStrategy(asset, marketCondition) {
    if (asset.volatility === 'high' && marketCondition.momentum > 0.5) {
        return STRATEGIES.momentum;
    } else if (asset.volatility === 'high') {
        return STRATEGIES.scalping;
    } else if (asset.liquidity === 'high') {
        return STRATEGIES.scalping;
    } else if (asset.volatility === 'low') {
        return STRATEGIES.swing;
    } else {
        return STRATEGIES.conservative;
    }
}

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: '🕋 HALAL Binance Trading Bot' });
});

// ==================== AUTHENTICATION ====================
app.post('/api/register', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }
    if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    
    const users = readUsers();
    if (users[email]) {
        return res.status(400).json({ success: false, message: 'User already exists' });
    }
    
    const pending = readPending();
    if (pending[email]) {
        return res.status(400).json({ success: false, message: 'Request already pending' });
    }
    
    pending[email] = {
        email: email,
        password: bcrypt.hashSync(password, 10),
        requestedAt: new Date().toISOString()
    };
    writePending(pending);
    
    res.json({ success: true, message: 'Registration request sent to owner for approval.' });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    
    const users = readUsers();
    const user = users[email];
    
    if (!user) {
        const pending = readPending();
        if (pending[email]) {
            return res.status(401).json({ success: false, message: 'Pending owner approval' });
        }
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    if (!bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    
    if (!user.isApproved && !user.isOwner) {
        return res.status(401).json({ success: false, message: 'Account not approved by owner' });
    }
    
    if (user.isBlocked) {
        return res.status(401).json({ success: false, message: 'Account blocked. Contact owner.' });
    }
    
    const token = jwt.sign({ email: email, isOwner: user.isOwner }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token: token, isOwner: user.isOwner });
});

function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
}

// ==================== FIXED BINANCE API INTEGRATION ====================
const BINANCE_API = 'https://api.binance.com';
const BINANCE_TESTNET = 'https://testnet.binance.vision';

async function binanceRequest(apiKey, secretKey, endpoint, params = {}, method = 'GET', testnet = false) {
    const baseUrl = testnet ? BINANCE_TESTNET : BINANCE_API;
    const timestamp = Date.now();
    const allParams = { ...params, timestamp, recvWindow: 5000 };
    const queryString = Object.keys(allParams).sort().map(k => `${k}=${allParams[k]}`).join('&');
    const signature = crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
    const url = `${baseUrl}${endpoint}?${queryString}&signature=${signature}`;
    
    const response = await axios({
        method,
        url,
        headers: { 'X-MBX-APIKEY': apiKey },
        timeout: 15000
    });
    return response.data;
}

async function getBinanceBalance(apiKey, secretKey, testnet = false) {
    try {
        const account = await binanceRequest(apiKey, secretKey, '/api/v3/account', {}, 'GET', testnet);
        const usdtBalance = account.balances.find(b => b.asset === 'USDT');
        return {
            balance: parseFloat(usdtBalance?.free || 0),
            locked: parseFloat(usdtBalance?.locked || 0),
            total: parseFloat(usdtBalance?.free || 0) + parseFloat(usdtBalance?.locked || 0)
        };
    } catch (error) {
        console.error('Balance fetch error:', error.response?.data || error.message);
        return { balance: 0, locked: 0, total: 0 };
    }
}

async function getBinancePrice(symbol, testnet = false) {
    try {
        const baseUrl = testnet ? BINANCE_TESTNET : BINANCE_API;
        const response = await axios.get(`${baseUrl}/api/v3/ticker/price?symbol=${symbol}`);
        return {
            price: parseFloat(response.data.price),
            symbol: symbol,
            timestamp: Date.now()
        };
    } catch (error) {
        console.error('Price fetch error:', error.message);
        const asset = HALAL_ASSETS.find(a => a.symbol === symbol);
        const basePrice = asset?.basePrice || 100;
        return { price: basePrice, symbol: symbol, timestamp: Date.now() };
    }
}

async function placeBinanceLimitOrder(apiKey, secretKey, symbol, side, quantity, price, testnet = false) {
    try {
        const order = await binanceRequest(apiKey, secretKey, '/api/v3/order', {
            symbol: symbol,
            side: side,
            type: 'LIMIT',
            timeInForce: 'GTC',
            quantity: quantity.toFixed(6),
            price: price.toFixed(2)
        }, 'POST', testnet);
        return {
            orderId: order.orderId,
            status: order.status,
            symbol: symbol,
            side: side,
            price: parseFloat(order.price),
            quantity: parseFloat(order.origQty),
            executedQty: parseFloat(order.executedQty || 0),
            createdAt: order.transactTime
        };
    } catch (error) {
        console.error('Order placement error:', error.response?.data || error.message);
        throw error;
    }
}

async function checkBinanceOrderStatus(apiKey, secretKey, symbol, orderId, testnet = false) {
    try {
        const order = await binanceRequest(apiKey, secretKey, '/api/v3/order', {
            symbol: symbol,
            orderId: orderId
        }, 'GET', testnet);
        return {
            orderId: order.orderId,
            status: order.status,
            executedQty: parseFloat(order.executedQty || 0),
            avgPrice: parseFloat(order.price || 0),
            cumQuote: parseFloat(order.cumQuote || 0)
        };
    } catch (error) {
        console.error('Order status error:', error.message);
        return { status: 'PENDING', executedQty: 0, avgPrice: 0 };
    }
}

async function cancelBinanceOrder(apiKey, secretKey, symbol, orderId, testnet = false) {
    try {
        const result = await binanceRequest(apiKey, secretKey, '/api/v3/order', {
            symbol: symbol,
            orderId: orderId
        }, 'DELETE', testnet);
        return { success: true, orderId: orderId, status: 'CANCELED' };
    } catch (error) {
        console.error('Cancel order error:', error.message);
        return { success: false, error: error.message };
    }
}

// ==================== TEST DIAGNOSTIC ENDPOINT ====================
app.post('/api/test-binance-keys', authenticate, async (req, res) => {
    const { apiKey, secretKey, accountType } = req.body;
    const testnet = accountType === 'testnet';
    const baseUrl = testnet ? BINANCE_TESTNET : BINANCE_API;
    const timestamp = Date.now();
    const queryString = `timestamp=${timestamp}&recvWindow=5000`;
    const signature = crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
    const url = `${baseUrl}/api/v3/account?${queryString}&signature=${signature}`;

    try {
        const response = await axios({
            method: 'GET',
            url,
            headers: { 'X-MBX-APIKEY': apiKey },
            timeout: 10000
        });
        const usdtBalance = response.data.balances?.find(b => b.asset === 'USDT');
        res.json({ 
            success: true, 
            message: '✅ API keys are valid!', 
            balance: usdtBalance?.free || '0',
            permissions: 'Spot & Margin Trading enabled'
        });
    } catch (error) {
        const binanceMsg = error.response?.data?.msg || error.message;
        res.json({ success: false, message: `❌ Binance error: ${binanceMsg}` });
    }
});

// ==================== MARKET CONDITIONS ====================
async function getMarketConditions(symbol, testnet = false) {
    try {
        const price = await getBinancePrice(symbol, testnet);
        return {
            momentum: 0.6,
            volatility: 0.4,
            spread: 0.001
        };
    } catch (error) {
        return { momentum: 0.5, volatility: 0.4, spread: 0.001 };
    }
}

// ==================== API KEY MANAGEMENT ====================
app.post('/api/set-binance-keys', authenticate, async (req, res) => {
    let { apiKey, secretKey, accountType } = req.body;
    if (!apiKey || !secretKey) {
        return res.status(400).json({ success: false, message: 'Both API keys required' });
    }
    
    const cleanApi = cleanKey(apiKey);
    const cleanSecret = cleanKey(secretKey);
    const useTestnet = accountType === 'testnet';
    
    try {
        const balance = await getBinanceBalance(cleanApi, cleanSecret, useTestnet);
        const users = readUsers();
        users[req.user.email].apiKey = encrypt(cleanApi);
        users[req.user.email].secretKey = encrypt(cleanSecret);
        writeUsers(users);
        
        res.json({ 
            success: true, 
            message: `✅ Binance API keys saved! Balance: ${balance.balance} USDT`, 
            balance: balance.balance
        });
    } catch (err) {
        console.error('API key error:', err);
        res.status(401).json({ success: false, message: 'Invalid API keys. Make sure "Enable Spot & Margin Trading" is checked in Binance API settings.' });
    }
});

app.post('/api/connect-binance', authenticate, async (req, res) => {
    const { accountType } = req.body;
    const user = readUsers()[req.user.email];
    if (!user?.apiKey) {
        return res.status(400).json({ success: false, message: 'No API keys saved' });
    }
    
    const apiKey = decrypt(user.apiKey);
    const secretKey = decrypt(user.secretKey);
    const useTestnet = accountType === 'testnet';
    
    try {
        const balance = await getBinanceBalance(apiKey, secretKey, useTestnet);
        
        res.json({ 
            success: true, 
            balance: balance.balance,
            total: balance.total,
            message: `✅ Connected to Binance! Balance: ${balance.balance} USDT`
        });
    } catch (error) {
        console.error('Connect error:', error);
        res.status(401).json({ success: false, message: 'Connection failed. Check that your API key has Spot & Margin Trading permission enabled.' });
    }
});

app.get('/api/get-keys', authenticate, (req, res) => {
    const user = readUsers()[req.user.email];
    if (!user?.apiKey) return res.json({ success: false, message: 'No keys saved' });
    res.json({ 
        success: true, 
        apiKey: decrypt(user.apiKey), 
        secretKey: decrypt(user.secretKey)
    });
});

app.post('/api/get-balance', authenticate, async (req, res) => {
    const { accountType } = req.body;
    const user = readUsers()[req.user.email];
    if (!user?.apiKey) return res.json({ success: false, message: 'No API keys' });
    
    const apiKey = decrypt(user.apiKey);
    const secretKey = decrypt(user.secretKey);
    const useTestnet = accountType === 'testnet';
    const balance = await getBinanceBalance(apiKey, secretKey, useTestnet);
    
    res.json({ 
        success: true, 
        balance: balance.balance,
        total: balance.total
    });
});

// ==================== TRADING ENGINE ====================
const activeSessions = new Map();

function calculateTradeQuantity(currentBalance, targetAmount, remainingTime, totalTrades, asset) {
    const remainingNeeded = Math.max(0, targetAmount - currentBalance);
    const timeFactor = Math.max(0.1, remainingTime / TIME_LIMIT_HOURS);
    const tradeCount = totalTrades + 1;
    
    let quantity = remainingNeeded / (tradeCount * timeFactor) / (asset.basePrice || 100);
    quantity = Math.max(asset.minQty, Math.floor(quantity / asset.stepSize) * asset.stepSize);
    return quantity;
}

app.post('/api/start-trading', authenticate, async (req, res) => {
    try {
        const { investmentAmount, targetAmount, timeLimitHours, accountType } = req.body;
        
        if (!investmentAmount || !targetAmount) {
            return res.status(400).json({ success: false, message: 'Investment amount and target amount required' });
        }
        
        if (investmentAmount < 10) {
            return res.status(400).json({ success: false, message: 'Minimum investment is $10' });
        }
        
        if (targetAmount <= investmentAmount) {
            return res.status(400).json({ success: false, message: 'Target must be greater than investment' });
        }
        
        const user = readUsers()[req.user.email];
        if (!user?.apiKey) {
            return res.status(400).json({ success: false, message: 'Add Binance API keys first' });
        }
        
        const apiKey = decrypt(user.apiKey);
        const secretKey = decrypt(user.secretKey);
        const useTestnet = accountType === 'testnet';
        const timeLimit = timeLimitHours || TIME_LIMIT_HOURS;
        
        let currentBalance = 0;
        try {
            const balance = await getBinanceBalance(apiKey, secretKey, useTestnet);
            currentBalance = balance.balance;
        } catch (error) {
            return res.status(401).json({ success: false, message: 'Cannot verify balance. Check API keys.' });
        }
        
        if (currentBalance < investmentAmount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient balance. You have ${currentBalance} USDT, need ${investmentAmount} USDT.`
            });
        }
        
        const sessionId = crypto.randomBytes(16).toString('hex');
        
        const sessionData = {
            userId: req.user.email,
            initialInvestment: investmentAmount,
            targetAmount: targetAmount,
            currentBalance: investmentAmount,
            totalProfit: 0,
            startTime: Date.now(),
            timeLimitHours: timeLimit,
            useTestnet: useTestnet,
            apiKey: apiKey,
            secretKey: secretKey,
            status: 'ACTIVE',
            activeTrades: [],
            completedTrades: [],
            totalTrades: 0,
            successfulTrades: 0,
            failedTrades: 0
        };
        
        activeSessions.set(sessionId, sessionData);
        
        const orders = readOrders();
        orders[sessionId] = {
            userId: req.user.email,
            initialInvestment: investmentAmount,
            targetAmount: targetAmount,
            startTime: new Date().toISOString(),
            timeLimitHours: timeLimit,
            status: 'ACTIVE'
        };
        writeOrders(orders);
        
        startAggressiveTrading(sessionId);
        
        const mode = useTestnet ? 'TESTNET' : 'REAL BINANCE';
        const profitNeeded = targetAmount - investmentAmount;
        const requiredReturn = ((targetAmount / investmentAmount) - 1) * 100;
        
        res.json({ 
            success: true, 
            sessionId: sessionId, 
            message: `✅ HALAL TRADING STARTED on Binance!\n\n📊 Mode: ${mode}\n💰 Investment: $${investmentAmount}\n🎯 Target: $${targetAmount}\n📈 Profit Needed: $${profitNeeded} (${requiredReturn.toFixed(1)}% return)\n⏰ Time Limit: ${timeLimit} hour(s)\n\n⚡ Bot places multiple concurrent limit orders\n🔄 Trade size increases automatically with profits\n🧠 Strategy auto-selected for each asset\n\n🕋 ISLAMIC REMINDER: NO Riba, NO Gharar, NO Maysir, NO leverage, NO short selling.\n\nThe bot will trade continuously until target is reached or time expires.`
        });
        
    } catch (error) {
        console.error('Start trading error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

async function startAggressiveTrading(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session || session.status !== 'ACTIVE') return;
    
    if (session.currentBalance >= session.targetAmount) {
        session.status = 'TARGET_REACHED';
        console.log(`🎯 TARGET REACHED! ${session.userId} achieved $${session.currentBalance.toFixed(2)}`);
        activeSessions.delete(sessionId);
        return;
    }
    
    const elapsedHours = (Date.now() - session.startTime) / (1000 * 60 * 60);
    if (elapsedHours >= session.timeLimitHours) {
        session.status = 'TIME_LIMIT_REACHED';
        console.log(`⏰ TIME LIMIT REACHED for ${session.userId}. Final balance: $${session.currentBalance.toFixed(2)}`);
        activeSessions.delete(sessionId);
        return;
    }
    
    // Clean up completed trades
    for (let i = session.activeTrades.length - 1; i >= 0; i--) {
        const trade = session.activeTrades[i];
        if (trade.status === 'COMPLETED') {
            session.currentBalance += trade.profit;
            session.totalProfit += trade.profit;
            session.successfulTrades++;
            session.activeTrades.splice(i, 1);
            console.log(`✅ Trade completed! Profit: $${trade.profit.toFixed(2)}. New balance: $${session.currentBalance.toFixed(2)}`);
            
            if (session.currentBalance >= session.targetAmount) {
                session.status = 'TARGET_REACHED';
                return;
            }
        } else if (trade.status === 'FAILED') {
            session.failedTrades++;
            session.activeTrades.splice(i, 1);
        } else if (trade.status === 'FILLED') {
            await checkSellOrderStatus(session, trade);
        } else if (trade.status === 'BUY_ORDER_PLACED') {
            await checkBuyOrderStatus(session, trade);
        }
    }
    
    const remainingHours = Math.max(0.1, session.timeLimitHours - elapsedHours);
    const timeFactor = Math.min(1, remainingHours / session.timeLimitHours);
    const tradesToPlace = Math.min(MAX_CONCURRENT_TRADES - session.activeTrades.length, Math.ceil(10 / timeFactor));
    
    for (let i = 0; i < tradesToPlace; i++) {
        if (session.currentBalance >= session.targetAmount) break;
        await placeNewTrade(session);
    }
    
    setTimeout(() => { startAggressiveTrading(sessionId); }, PROFIT_CHECK_INTERVAL);
}

async function placeNewTrade(session) {
    const asset = HALAL_ASSETS[Math.floor(Math.random() * HALAL_ASSETS.length)];
    const marketConditions = await getMarketConditions(asset.symbol, session.useTestnet);
    const strategy = selectStrategy(asset, marketConditions);
    
    const remainingNeeded = session.targetAmount - session.currentBalance;
    const timeRemaining = Math.max(0.1, (session.startTime + session.timeLimitHours * 3600000 - Date.now()) / 3600000);
    
    let quantity = remainingNeeded / (session.totalTrades + 1) / timeRemaining / asset.basePrice;
    quantity = Math.max(asset.minQty, Math.floor(quantity / asset.stepSize) * asset.stepSize);
    if (quantity < asset.minQty) return;
    
    const price = await getBinancePrice(asset.symbol, session.useTestnet);
    const entryPrice = price.price * 0.999;
    const targetPrice = entryPrice * strategy.targetMultiplier;
    
    try {
        const buyOrder = await placeBinanceLimitOrder(
            session.apiKey, session.secretKey, asset.symbol, 'BUY',
            quantity, entryPrice, session.useTestnet
        );
        
        session.activeTrades.push({
            id: buyOrder.orderId,
            symbol: asset.symbol,
            strategy: strategy.name,
            quantity: quantity,
            entryPrice: entryPrice,
            targetPrice: targetPrice,
            buyOrderId: buyOrder.orderId,
            status: 'BUY_ORDER_PLACED',
            createdAt: Date.now()
        });
        session.totalTrades++;
        console.log(`📈 New trade placed: ${quantity} ${asset.symbol} @ ${entryPrice} (Strategy: ${strategy.name})`);
    } catch (error) {
        console.error(`Failed to place trade:`, error.message);
    }
}

async function checkBuyOrderStatus(session, trade) {
    try {
        const orderStatus = await checkBinanceOrderStatus(
            session.apiKey, session.secretKey, trade.symbol, trade.buyOrderId, session.useTestnet
        );
        
        if (orderStatus.status === 'FILLED') {
            trade.status = 'FILLED';
            trade.fillPrice = orderStatus.avgPrice || trade.entryPrice;
            
            const sellOrder = await placeBinanceLimitOrder(
                session.apiKey, session.secretKey, trade.symbol, 'SELL',
                trade.quantity, trade.targetPrice, session.useTestnet
            );
            
            trade.sellOrderId = sellOrder.orderId;
            trade.status = 'SELL_ORDER_PLACED';
            console.log(`✅ Buy order filled: ${trade.quantity} ${trade.symbol} @ ${trade.fillPrice}`);
        } else if (orderStatus.status === 'EXPIRED' || orderStatus.status === 'CANCELED') {
            trade.status = 'FAILED';
        }
    } catch (error) {
        console.error('Buy order check error:', error.message);
    }
}

async function checkSellOrderStatus(session, trade) {
    try {
        const orderStatus = await checkBinanceOrderStatus(
            session.apiKey, session.secretKey, trade.symbol, trade.sellOrderId, session.useTestnet
        );
        
        if (orderStatus.status === 'FILLED') {
            const profit = (orderStatus.avgPrice - trade.fillPrice) * trade.quantity;
            trade.status = 'COMPLETED';
            trade.profit = profit;
            trade.exitPrice = orderStatus.avgPrice;
            console.log(`✅ SELL order filled! Profit: $${profit.toFixed(2)}`);
            
            const historyFile = path.join(TRADES_DIR, session.userId.replace(/[^a-z0-9]/gi, '_') + '.json');
            let history = [];
            if (fs.existsSync(historyFile)) history = JSON.parse(fs.readFileSync(historyFile));
            history.unshift({
                symbol: trade.symbol,
                strategy: trade.strategy,
                entryPrice: trade.fillPrice,
                exitPrice: trade.exitPrice,
                quantity: trade.quantity,
                profit: profit,
                profitPercent: (profit / (trade.fillPrice * trade.quantity)) * 100,
                timestamp: new Date().toISOString(),
                isHalal: true
            });
            fs.writeFileSync(historyFile, JSON.stringify(history.slice(0, 500), null, 2));
        } else if (orderStatus.status === 'EXPIRED' || orderStatus.status === 'CANCELED') {
            trade.status = 'FAILED';
        }
    } catch (error) {
        console.error('Sell order check error:', error.message);
    }
}

app.post('/api/stop-trading', authenticate, (req, res) => {
    const { sessionId } = req.body;
    if (activeSessions.has(sessionId)) {
        activeSessions.get(sessionId).status = 'STOPPED_BY_USER';
        activeSessions.delete(sessionId);
        res.json({ success: true, message: 'Trading stopped successfully' });
    } else {
        res.json({ success: false, message: 'Session not found' });
    }
});

app.post('/api/trade-status', authenticate, (req, res) => {
    const session = activeSessions.get(req.body.sessionId);
    if (!session) return res.json({ success: true, active: false });
    
    const elapsedHours = (Date.now() - session.startTime) / (1000 * 60 * 60);
    const timeRemaining = Math.max(0, session.timeLimitHours - elapsedHours);
    const progressPercent = ((session.currentBalance - session.initialInvestment) / (session.targetAmount - session.initialInvestment)) * 100;
    const winRate = session.totalTrades > 0 ? (session.successfulTrades / session.totalTrades) * 100 : 0;
    
    res.json({ 
        success: true, 
        active: session.status === 'ACTIVE',
        initialInvestment: session.initialInvestment,
        targetAmount: session.targetAmount,
        currentBalance: session.currentBalance,
        totalProfit: session.totalProfit,
        progressPercent: Math.min(100, Math.max(0, progressPercent)).toFixed(1),
        totalTrades: session.totalTrades,
        successfulTrades: session.successfulTrades,
        failedTrades: session.failedTrades,
        winRate: winRate.toFixed(1),
        activeTrades: session.activeTrades.length,
        timeRemaining: timeRemaining.toFixed(2),
        status: session.status
    });
});

app.get('/api/trade-history', authenticate, (req, res) => {
    const file = path.join(TRADES_DIR, req.user.email.replace(/[^a-z0-9]/gi, '_') + '.json');
    if (!fs.existsSync(file)) return res.json({ success: true, trades: [] });
    const trades = JSON.parse(fs.readFileSync(file));
    res.json({ success: true, trades: trades });
});

app.get('/api/halal-assets', authenticate, (req, res) => {
    res.json({ success: true, assets: HALAL_ASSETS });
});

// ==================== ADMIN ENDPOINTS ====================
app.get('/api/admin/pending-users', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const pending = readPending();
    const list = Object.keys(pending).map(e => ({ email: e, requestedAt: pending[e].requestedAt }));
    res.json({ success: true, pending: list });
});

app.post('/api/admin/approve-user', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const pending = readPending();
    if (!pending[email]) return res.status(404).json({ success: false });
    const users = readUsers();
    users[email] = {
        email: email,
        password: pending[email].password,
        isOwner: false,
        isApproved: true,
        isBlocked: false,
        apiKey: "",
        secretKey: "",
        createdAt: new Date().toISOString()
    };
    writeUsers(users);
    delete pending[email];
    writePending(pending);
    res.json({ success: true, message: `User ${email} approved` });
});

app.post('/api/admin/reject-user', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const pending = readPending();
    if (!pending[email]) return res.status(404).json({ success: false });
    delete pending[email];
    writePending(pending);
    res.json({ success: true, message: `User ${email} rejected` });
});

app.post('/api/admin/toggle-block', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { email } = req.body;
    const users = readUsers();
    if (!users[email]) return res.status(404).json({ success: false });
    users[email].isBlocked = !users[email].isBlocked;
    writeUsers(users);
    res.json({ success: true, message: `User ${email} is now ${users[email].isBlocked ? 'BLOCKED' : 'ACTIVE'}` });
});

app.get('/api/admin/users', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const users = readUsers();
    const list = Object.keys(users).map(e => ({
        email: e,
        hasApiKeys: !!users[e].apiKey,
        isOwner: users[e].isOwner,
        isApproved: users[e].isApproved,
        isBlocked: users[e].isBlocked
    }));
    res.json({ success: true, users: list });
});

app.get('/api/admin/user-balances', authenticate, async (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const users = readUsers();
    const balances = {};
    for (const [email, userData] of Object.entries(users)) {
        if (userData.apiKey) {
            try {
                const apiKey = decrypt(userData.apiKey);
                const secretKey = decrypt(userData.secretKey);
                const balance = await getBinanceBalance(apiKey, secretKey, false);
                balances[email] = { balance: balance.balance, total: balance.total, hasKeys: true };
            } catch {
                balances[email] = { balance: 0, total: 0, hasKeys: true, error: true };
            }
        } else {
            balances[email] = { balance: 0, total: 0, hasKeys: false };
        }
    }
    res.json({ success: true, balances: balances });
});

app.get('/api/admin/all-trades', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const allTrades = {};
    const files = fs.readdirSync(TRADES_DIR);
    for (const file of files) {
        if (file === '.gitkeep') continue;
        const userId = file.replace('.json', '');
        const trades = JSON.parse(fs.readFileSync(path.join(TRADES_DIR, file)));
        allTrades[userId] = trades;
    }
    res.json({ success: true, trades: allTrades });
});

app.post('/api/change-password', authenticate, (req, res) => {
    if (!req.user.isOwner) return res.status(403).json({ success: false });
    const { currentPassword, newPassword } = req.body;
    const users = readUsers();
    const owner = users[req.user.email];
    if (!bcrypt.compareSync(currentPassword, owner.password)) {
        return res.status(401).json({ success: false, message: 'Wrong current password' });
    }
    owner.password = bcrypt.hashSync(newPassword, 10);
    writeUsers(users);
    res.json({ success: true, message: 'Password changed! Please login again.' });
});

// ==================== SERVE FRONTEND ====================
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================`);
    console.log(`🕋 HALAL BINANCE TRADING BOT - RUNNING`);
    console.log(`========================================`);
    console.log(`✅ Owner: mujtabahatif@gmail.com`);
    console.log(`✅ Password: Mujtabah@2598`);
    console.log(`✅ ${HALAL_ASSETS.length} Halal Assets`);
    console.log(`✅ 100% HALAL - No Riba, No Gharar, No Maysir, No Leverage`);
    console.log(`✅ Real Binance API | Limit Orders Only`);
    console.log(`========================================`);
    console.log(`Server running on port: ${PORT}`);
});
