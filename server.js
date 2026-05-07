const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const app = express();

// --- 1. CORS Fix (በምስሉ ላይ የታየውን ስህተት ለመፍታት) ---
app.use(cors({
    origin: "*", // ወይም የFrontend አድራሻህን ለምሳሌ "http://localhost:3000" ጥቀስ
    methods: ["GET", "POST"],
    credentials: true
}));
app.use(express.json({ limit: '15mb' }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] // ግንኙነቱን ይበልጥ አስተማማኝ ለማድረግ
});

// --- 2. MongoDB Atlas Connection ---
const mongoURI = "mongodb+srv://abrhamman825_db_user:v1BrSJz7GHHRjwya@cluster0.oxlnr7n.mongodb.net/aviator_db?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(mongoURI)
    .then(() => console.log("✅ የሞንጎ ዲቢ ዳታቤዝ በትክክል ተገናኝቷል"))
    .catch(err => console.error("❌ DB Error:", err.message));

// --- 3. User Model ---
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    history: { type: Array, default: [] },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// --- 4. Telegram Bot (409 Conflict Fix ተጨምሮበታል) ---
const TELEGRAM_TOKEN = '8601691945:AAHuf1tKpCAmU6j6cOqp0i8sR0qv4F0nCPc';
const ADMIN_CHAT_ID = '2068983666';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on('polling_error', (error) => {
    if (!error.message.includes('409')) console.log("Telegram Bot Alert:", error.message);
});

// --- 5. Game State ---
let gameState = {
    multiplier: 1.0,
    status: 'waiting', 
    timer: 10,
    userCount: 2500,
    liveBets: [],
    gameHistory: []
};
let userSockets = {}; 

const generateFakeBets = () => {
    const names = ["Abebe", "Sara", "Yoni", "Mery", "Ethio", "King", "Lucky", "Dave", "Kal", "Bini", "Tedi", "Hani", "Mahi", "Lili"];
    let bets = Array.from({ length: 25 }, () => ({
        user: names[Math.floor(Math.random() * names.length)] + "***" + Math.floor(Math.random() * 99),
        amount: (Math.floor(Math.random() * 100) + 1) * 10,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
    }));
    return bets.sort((a, b) => b.amount - a.amount);
};

// --- 6. Auth Routes ---
app.post('/register', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.json({ status: 'error', error: 'ይህ ስልክ ቁጥር ተመዝግቧል!' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ phone, password: hashedPassword });
        await newUser.save();
        bot.sendMessage(ADMIN_CHAT_ID, `👤 *አዲስ ተመዝጋቢ:* \`${phone}\``, { parse_mode: 'Markdown' });
        res.json({ status: 'ok' });
    } catch (err) { res.json({ status: 'error' }); }
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const user = await User.findOne({ phone });
        if (user && await bcrypt.compare(password, user.password)) {
            res.json({ status: 'ok', balance: user.balance, phone: user.phone });
        } else { res.json({ status: 'error', error: 'ስልክ ወይም ፓስወርድ ስህተት' }); }
    } catch (err) { res.json({ status: 'error' }); }
});

// --- 7. Socket.io (Strict Betting Lock) ---
io.on('connection', (socket) => {
    socket.emit('data', gameState);
    socket.on('identify', (phone) => { userSockets[phone] = socket.id; });

    socket.on('placeBet', async (data) => {
        if (gameState.status !== 'waiting') return;
        try {
            const user = await User.findOne({ phone: data.phone });
            const alreadyBet = gameState.liveBets.find(b => b.user === data.phone);
            if (user && !alreadyBet && user.balance >= data.amount) {
                user.balance -= data.amount;
                await user.save();
                gameState.liveBets.unshift({ user: data.phone, amount: data.amount });
                socket.emit('balanceUpdate', user.balance);
                io.emit('data', gameState); 
            }
        } catch (e) { console.log(e); }
    });

    socket.on('sendDepositRequest', (data) => {
        const msg = `💰 *የዲፖዚት ጥያቄ*\n📱 ስልክ: \`${data.phone}\` \n💵 መጠን: *${data.amount} ETB*`;
        const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
            { text: '✅ አጽድቅ', callback_data: `approve_${data.phone}_${data.amount}` },
            { text: '❌ ሰርዝ', callback_data: `reject_${data.phone}_${data.amount}` }
        ]]}};
        bot.sendMessage(ADMIN_CHAT_ID, msg, opts);
    });
});

// --- 8. Admin Control ---
bot.on('callback_query', async (query) => {
    const [action, phone, amount] = query.data.split('_');
    if (action === 'approve') {
        const user = await User.findOneAndUpdate({ phone }, { $inc: { balance: parseFloat(amount) } }, { new: true });
        bot.sendMessage(ADMIN_CHAT_ID, `✅ የ ${phone} ዲፖዚት ጸድቋል:: ባላንስ: ${user.balance}`);
        if (userSockets[phone]) io.to(userSockets[phone]).emit('balanceUpdate', user.balance);
    }
    bot.answerCallbackQuery(query.id);
});

// --- 9. Game Engine ---
const startGame = () => {
    gameState.status = 'waiting'; gameState.timer = 10;
    gameState.multiplier = 1.0; gameState.liveBets = generateFakeBets();
    const countdown = setInterval(() => {
        gameState.timer--; io.emit('data', gameState);
        if (gameState.timer <= 0) { clearInterval(countdown); startFlying(); }
    }, 1000);
};

const startFlying = () => {
    gameState.status = 'flying';
    const crashPoint = Math.random() < 0.1 ? 1.0 : parseFloat((1 / (1 - Math.random() * 0.95)).toFixed(2));
    const interval = setInterval(() => {
        if (gameState.multiplier < crashPoint) {
            gameState.multiplier = parseFloat((gameState.multiplier + (gameState.multiplier < 2 ? 0.01 : 0.05)).toFixed(2));
            io.emit('data', gameState);
        } else {
            clearInterval(interval); gameState.status = 'crashed';
            gameState.gameHistory.unshift(gameState.multiplier);
            if (gameState.gameHistory.length > 12) gameState.gameHistory.pop();
            io.emit('data', gameState); setTimeout(startGame, 3000);
        }
    }, 100);
};

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => { console.log(`✅ ሰርቨር በፖርት ${PORT} ላይ ጀመረ`); startGame(); });
