const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const app = express();

// --- 1. CORS Configuration ---
const allowedOrigins = [
    "https://aviator-ethio-front.vercel.app", 
    "http://localhost:3000"
]; 

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ["GET", "POST"],
    credentials: true
}));

app.use(express.json({ limit: '15mb' }));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'] 
});

// --- 2. MongoDB Connection ---
const mongoURI = "mongodb+srv://abrhamman825_db_user:v1BrSJz7GHHRjwya@cluster0.oxlnr7n.mongodb.net/aviator_db?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(mongoURI)
    .then(() => console.log("✅ DB Connected Successfully"))
    .catch(err => console.error("❌ DB Connection Error:", err));

const User = mongoose.model('User', new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 }
}));

// --- 3. Telegram Bot ---
const BOT_TOKEN = '8601691945:AAHuf1tKpCAmU6j6cOqp0i8sR0qv4F0nCPc';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const ADMIN_ID = '2068983666';

// --- 4. Game Logic & Fake Data Generator ---
// የውሸት ተጫዋቾች ስም ዝርዝር
const fakeNames = ["Mery***", "Dave***", "Sara***", "Yoni***", "Ethio***", "Tedi***", "Kal***", "Bini***", "Abe***", "Hani***", "Mulu***", "Sami***", "Zeni***", "Geni***", "Ab***", "Tutu***"];

// 40 ተጫዋች የሚፈጥር ፈንክሽን
const generateFakeBets = () => {
    let bets = [];
    for (let i = 0; i < 40; i++) {
        bets.push({
            user: fakeNames[Math.floor(Math.random() * fakeNames.length)] + (Math.floor(Math.random() * 89) + 10),
            amount: (Math.floor(Math.random() * 95) + 5) * 10 // ከ 50 እስከ 1000 ብር
        });
    }
    return bets.sort((a, b) => b.amount - a.amount); // ከትልቅ ወደ ትንሽ መደርደር
};

let gameState = { 
    multiplier: 1.0, 
    status: 'waiting', 
    timer: 10, 
    liveBets: generateFakeBets(), // መጀመሪያ ላይ 40 ሰው ይኑር
    gameHistory: [],
    userCount: 2850 // የመነሻ ቁጥር
};
let userSockets = {};

// የተጫዋቾችን ቁጥር ከ2500-3000 በየ 4 ሰከንዱ መቀያየር
setInterval(() => {
    gameState.userCount = Math.floor(Math.random() * (3000 - 2500 + 1)) + 2500;
}, 4000);

// --- 5. APIs (Login/Register) ---
app.post('/register', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).json({ status: 'error', error: "ይህ ስልክ ቀድሞ ተመዝግቧል" });
        const hashed = await bcrypt.hash(password, 10);
        const user = new User({ phone, password: hashed, balance: 0 });
        await user.save();
        res.json({ status: 'ok' });
    } catch (e) { res.status(500).json({ status: 'error', error: "ምዝገባ አልተሳካም" }); }
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const user = await User.findOne({ phone });
        if (user && await bcrypt.compare(password, user.password)) {
            res.json({ status: 'ok', balance: user.balance, phone: user.phone });
        } else { res.status(401).json({ status: 'error', error: "ስልክ ወይም ፓስወርድ ስህተት" }); }
    } catch (e) { res.status(500).json({ status: 'error', error: "የውስጥ ስህተት" }); }
});

// --- 6. Socket Logic ---
io.on('connection', (socket) => {
    socket.emit('data', gameState);
    socket.on('identify', (phone) => { userSockets[phone] = socket.id; });
    
    socket.on('updateServerBalance', async (data) => {
        try { await User.findOneAndUpdate({ phone: data.phone }, { balance: data.newBalance }); } catch (e) {}
    });

    socket.on('sendDepositRequest', (data) => {
        bot.sendMessage(ADMIN_ID, `💰 አዲስ የዲፖዚት ጥያቄ!\n📱 ስልክ: ${data.phone}\n💵 መጠን: ${data.amount} ETB`);
    });

    socket.on('disconnect', () => { console.log('Client disconnected'); });
});

// --- 7. Admin Commands ---
bot.onText(/\/update (.+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (chatId.toString() !== ADMIN_ID) return;
    const phone = match[1];
    const amount = parseFloat(match[2]);
    try {
        const user = await User.findOneAndUpdate({ phone: phone }, { $inc: { balance: amount } }, { new: true });
        if (user) {
            bot.sendMessage(ADMIN_ID, `✅ የ ${phone} ባላንስ ተስተካክሏል። አሁን: ${user.balance.toFixed(2)} ETB`);
            const userSock = userSockets[phone];
            if (userSock) { io.to(userSock).emit('manual_balance_update', { phone: user.phone, balance: user.balance }); }
        }
    } catch (e) { bot.sendMessage(ADMIN_ID, "❌ ስህተት"); }
});

// --- 8. Game Engine ---
const runGame = () => {
    gameState.status = 'waiting'; 
    gameState.timer = 10;
    gameState.multiplier = 1.0;
    gameState.liveBets = generateFakeBets(); // በየዙሩ አዲስ 40 ተጫዋች ይፈጠራል

    const timerInterval = setInterval(() => {
        gameState.timer--;
        io.emit('data', gameState);
        if(gameState.timer <= 0) {
            clearInterval(timerInterval);
            startFlying();
        }
    }, 1000);
};

const startFlying = () => {
    gameState.status = 'flying';
    let crashPoint = (Math.random() * 4 + 1).toFixed(2); // Crash point 1-5x
    
    let flyInterval = setInterval(() => {
        gameState.multiplier += 0.03;
        if(parseFloat(gameState.multiplier) >= parseFloat(crashPoint)) {
            clearInterval(flyInterval);
            gameState.status = 'crashed';
            gameState.gameHistory.unshift(parseFloat(gameState.multiplier).toFixed(2));
            if(gameState.gameHistory.length > 15) gameState.gameHistory.pop();
            io.emit('data', gameState);
            setTimeout(runGame, 3000);
        } else { 
            io.emit('data', gameState); 
        }
    }, 100);
};

runGame();

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server Running on port ${PORT}`));