const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '15mb' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- 1. MongoDB Connection ---
const mongoURI = "mongodb+srv://abrhamman825_db_user:v1BrSJz7GHHRjwya@cluster0.oxlnr7n.mongodb.net/aviator_db?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(mongoURI)
    .then(() => console.log("✅ ዳታቤዝ በትክክል ተገናኝቷል"))
    .catch(err => console.log("❌ DB Error:", err.message));

// --- 2. User Schema ---
const userSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    isBetting: { type: Boolean, default: false } 
});
const User = mongoose.model('User', userSchema);

// --- 3. Telegram Config ---
const TELEGRAM_TOKEN = '8601691945:AAHuf1tKpCAmU6j6cOqp0i8sR0qv4F0nCPc';
const ADMIN_CHAT_ID = '2068983666';
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// --- 4. Game State ---
let gameState = {
    multiplier: 1.0,
    status: 'waiting', 
    timer: 10,
    liveBets: [],
    gameHistory: []
};

let userSockets = {}; 

const generateFakeBets = () => {
    const names = ["Abebe", "Sara", "Yoni", "Mery", "Ethio", "King", "Dave", "Kal", "Bini", "Tedi"];
    let bets = Array.from({ length: 20 }, () => ({
        user: names[Math.floor(Math.random() * names.length)] + "***" + Math.floor(Math.random() * 99),
        amount: (Math.floor(Math.random() * 100) + 1) * 10,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));
    return bets.sort((a, b) => b.amount - a.amount);
};

// --- 5. Routes ---
app.post('/register', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ phone, password: hashedPassword });
        await newUser.save();
        bot.sendMessage(ADMIN_CHAT_ID, `👤 አዲስ ተመዝጋቢ: \`${phone}\``, { parse_mode: 'Markdown' });
        res.json({ status: 'ok' });
    } catch (err) { res.json({ status: 'error', error: 'ምዝገባ አልተሳካም' }); }
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const user = await User.findOne({ phone });
        if (user && await bcrypt.compare(password, user.password)) {
            res.json({ status: 'ok', balance: user.balance, phone: user.phone });
        } else { res.json({ status: 'error', error: 'የስልክ ቁጥር ወይም ፓስወርድ ስህተት' }); }
    } catch (e) { res.json({ status: 'error' }); }
});

// --- 6. Socket Logic (Strict Betting Lock) ---
io.on('connection', (socket) => {
    socket.emit('data', gameState);
    
    socket.on('identify', (phone) => {
        userSockets[phone] = socket.id;
    });

    socket.on('placeBet', async (data) => {
        // ህግ 1: ጨዋታው ከጀመረ በኋላ መወራረድ አይቻልም
        if (gameState.status !== 'waiting') return socket.emit('error', 'ጨዋታው ጀምሯል!');

        try {
            const user = await User.findOne({ phone: data.phone });
            // ህግ 2: አንድ ሰው በአንድ ዙር ሁለት ጊዜ መወራረድ አይችልም (Lock)
            const alreadyBet = gameState.liveBets.find(b => b.user === data.phone);
            
            if (user && !alreadyBet && user.balance >= data.amount) {
                user.balance -= data.amount;
                await user.save();
                
                gameState.liveBets.unshift({ 
                    user: data.phone, 
                    amount: data.amount,
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                });
                
                socket.emit('balanceUpdate', user.balance);
                io.emit('data', gameState); 
            } else {
                socket.emit('error', 'ባላንስ የለዎትም ወይም አስቀድመው ተወራርደዋል');
            }
        } catch (e) { console.log(e); }
    });

    socket.on('sendDepositRequest', (data) => {
        const msg = `💰 *የዲፖዚት ጥያቄ*\n\n📱 ስልክ: \`${data.phone}\` \n💵 መጠን: *${data.amount} ETB*`;
        const opts = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ አጽድቅ (Approve)', callback_data: `approve_${data.phone}_${data.amount}` },
                    { text: '❌ ሰርዝ (Reject)', callback_data: `reject_${data.phone}_${data.amount}` }
                ]]
            }
        };
        bot.sendMessage(ADMIN_CHAT_ID, msg, opts);
    });
});

// --- 7. Admin Approval ---
bot.on('callback_query', async (query) => {
    const [action, phone, amount] = query.data.split('_');
    try {
        if (action === 'approve') {
            const user = await User.findOneAndUpdate({ phone }, { $inc: { balance: parseFloat(amount) } }, { new: true });
            bot.sendMessage(ADMIN_CHAT_ID, `✅ የ ${phone} ዲፖዚት ጸድቋል። አዲስ ባላንስ: ${user.balance} ETB`);
            
            if (userSockets[phone]) {
                io.to(userSockets[phone]).emit('balanceUpdate', user.balance);
            }
        }
    } catch (e) { console.error(e); }
    bot.answerCallbackQuery(query.id);
});

// --- 8. Game Engine ---
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
    // Crash point አሰላል (የድሮው ሎጅክ)
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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`✅ ሰርቨሩ በፖርት ${PORT} ላይ ስራ ጀምሯል`);
    startGame();
});
