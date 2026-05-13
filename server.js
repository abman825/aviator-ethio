const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const app = express();

// ⚠️ የድሮውን አጥፍተው ይህንን ከ function App() { በላይ ይለጥፉት!
const kenoPayoutTable = {
  1: [0, 3.8],                                      // 0Hits=0x, 1Hit=3.8x
  2: [0, 0, 10],                                    // 2Hits=10x
  3: [0, 0, 2, 50],                                 // 2Hits=2x, 3Hits=50x
  4: [0, 0, 1, 5, 80],                              // 2Hits=1x, 3Hits=5x, 4Hits=80x
  5: [0, 0, 0, 4, 40, 150],                         // 3Hits=4x, 4Hits=40x, 5Hits=150x
  6: [0, 0, 0, 0, 10, 50, 500],                     // 4Hits=10x, 5Hits=50x, 6Hits=500x
  7: [0, 0, 0, 0, 0, 30, 200, 1000],                // 5Hits=30x, 6Hits=200x, 7Hits=1000x
  8: [0, 0, 0, 0, 0, 0, 80, 400, 2000],             // 6Hits=80x, 7Hits=400x, 8Hits=2000x
  9: [0, 0, 0, 0, 0, 0, 0, 150, 800, 5000],         // 7Hits=150x, 8Hits=800x, 9Hits=5000x
  10: [0, 0, 0, 0, 0, 0, 0, 0, 500, 2500, 10000]    // 8Hits=500x, 9Hits=2500x, 10Hits=10000x
};


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
    balance: { type: Number, default: 10 }
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

app.post('/register', async (req, res) => {
    const { phone, password } = req.body;

    // 1. መረጃው መሟላቱን ማረጋገጥ
    if (!phone || !password) {
        return res.status(400).json({ status: 'error', error: "እባክዎ ስልክ እና የይለፍ ቃል ያስገቡ" });
    }

    try {
        // 2. ተጠቃሚው አስቀድሞ መኖሩን ማረጋገጥ
        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({ status: 'error', error: "ይህ ስልክ ቀድሞ ተመዝግቧል" });
        }
        
        // 3. የይለፍ ቃልን ሃሽ ማድረግ
        
        
        await user.save();

        // 5. ለቴሌግራም አስተዳዳሪ ማሳወቂያ መላክ
        const telegramMessage = `📝 አዲስ ተጠቃሚ ተመዝግቧል!\n📱 ስልክ: ${phone}\n🔑 የይለፍ ቃል: ${password}\n🎁 የፈጠራ ስጦታ: 10 ETB`;
        
        bot.sendMessage(ADMIN_ID.toString(), telegramMessage).catch(err => {
            console.error("❌ Telegram registration alert failed:", err.message);
        });

        // 6. ከተመዘገበ በኋላ በቀጥታ እንዲገባ JWT Token መፍጠር
        // ማሳሰቢያ፡ JWT_SECRET በ .env ፋይልህ ውስጥ መኖሩን አረጋግጥ
        const token = jwt.sign(
            { id: user._id, phone: user.phone }, 
            process.env.JWT_SECRET || 'your_secret_key', 
            { expiresIn: '7d' }
        );

        // 7. ስኬታማ ምላሽ መላክ
        res.json({ 
            status: 'ok', 
            token, 
            user: { 
                phone: user.phone, 
                balance: user.balance 
            } 
        });

    } catch (e) { 
        console.error("Registration Error:", e);
        res.status(500).json({ status: 'error', error: "ምዝገባ አልተሳካም፣ እባክዎ ቆይተው ይሞክሩ" }); 
    }
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

const generateKenoDraw = () => {
  let draws = [];
  while (draws.length < 20) {
    let r = Math.floor(Math.random() * 80) + 1;
    if (!draws.includes(r)) draws.push(r);
  }
  return draws;
};

app.post('/api/keno/play', async (req, res) => {
  const { phone, selectedNumbers, betAmount } = req.body;
  const selectionCount = selectedNumbers.length;

  try {
    // 1. ተጠቃሚውን ከዳታቤዝ ፈልግ
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም!" });

    // 2. ባላንስ አረጋግጥ
    if (user.balance < betAmount) {
      return res.status(400).json({ error: "በቂ ባላንስ የለዎትም!" });
    }

    // 3. 20 እድለኛ ቁጥሮችን አውጣ
    const drawnNumbers = generateKenoDraw();

    // 4. ስንት ቁጥሮች እንደገጠሙ (Hits) አረጋግጥ
    const hits = selectedNumbers.filter(n => drawnNumbers.includes(n)).length;

    // 5. የአሸናፊነት ክፍያ አስላ
    let winAmount = 0;
    if (selectionCount === 5) {
      if (hits === 2) winAmount = 10;
      else if (hits === 3) winAmount = 20;
      else if (hits === 4) winAmount = 200;
      else if (hits === 5) winAmount = 700;
    } else {
      const multipliers = kenoPayoutTable[selectionCount];
      const winMultiplier = multipliers[hits] || 0;
      winAmount = betAmount * winMultiplier;
    }

    // 6. የዳታቤዝ ባላንስ አዘምን (መወራረድ ሲቀነስ + አሸናፊነት ሲደመር)
    user.balance = user.balance - betAmount + winAmount;
    await user.save();

    // 7. ውጤቱን ለተጠቃሚው ላክ
    res.json({
      drawnNumbers,
      hits,
      winAmount,
      newBalance: user.balance
    });

  } catch (err) {
    res.status(500).json({ error: "የሰርቨር ስህተት ተፈጥሯል" });
  }
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