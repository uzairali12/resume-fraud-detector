// public/js/auth.js

// 1. Database Connectivity Parameters (Placeholder Strings)
const SUPABASE_URL = "https://your-supabase-url.supabase.co"; 
const SUPABASE_ANON_KEY = "your-anon-public-key"; 

let supabaseClient = null;

// Determine if we should activate Mock Authentication Mode based on the placeholder keys
const isMockAuth = (!SUPABASE_URL || SUPABASE_URL.includes("your-supabase-url") || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes("your-anon-public-key"));

if (isMockAuth) {
    console.warn("⚠️ [MOCK AUTH ACTIVE]: Using developer local bypass mode. Enter any email and password 'admin123' to log in.");
} else {
    try {
        // Initialize real cloud communication instance if actual keys are detected
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("✅ [SUPABASE FRONTEND CONNECTED]: Identity management portal initialized.");
    } catch (err) {
        console.error("❌ Failed to initialize standard Supabase client configuration:", err);
    }
}

// 2. User Authentication Login Function Handler
async function handleLogin() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
        alert("Please specify both an identity email address and verification key.");
        return;
    }

    // --- MOCK AUTHENTICATION BYPASS ROUTE ---
    if (isMockAuth || !supabaseClient) {
        if (password === "admin123") {
            console.log("🔓 [LOCAL AUTH BYPASS]: Mock authentication match verified.");
            showDashboard({ email: email, id: "mock-uid-12345" });
        } else {
            alert("❌ Access Denied!\n\nMock Mode is active. Please use 'admin123' as your security access password key to login.");
        }
        return;
    }

    // --- LIVE PRODUCTION SUPABASE ROUTE ---
    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        console.log("🔐 [CLOUD AUTH SUCCESS]: User verified via Supabase Identity database mapping.");
        showDashboard(data.user);
    } catch (error) {
        alert("Authentication Error: " + error.message);
    }
}

// 3. User Registration Account Generation Handler
async function handleSignUp() {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (!email || !password) {
        alert("Please provide an email address and set a complex password schema.");
        return;
    }

    if (isMockAuth || !supabaseClient) {
        alert("ℹ️ registration Unavailable in Mock Mode:\n\nYou are running locally without explicit network keys. You can log in instantly right now using your credentials with password 'admin123' without creating an account!");
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        alert("🎉 Registration profile submitted successfully! Please check your mailbox folder for verification confirmations.");
    } catch (error) {
        alert("Sign Up Process Failed: " + error.message);
    }
}

// 4. State Management Interface View Controllers
function showDashboard(user) {
    window.currentUser = user;
    
    // Smooth transition from validation forms onto processing metrics grids
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("dashboardScreen").classList.remove("hidden");
    document.getElementById("userGreeting").innerText = `Active Session Node: ${user.email}`;
}

async function handleLogout() {
    window.currentUser = null;
    
    // Clear cloud user token credentials if running online
    if (supabaseClient && !isMockAuth) {
        await supabaseClient.auth.signOut();
    }
    
    console.log("🔒 Session destroyed. Returning entry vector to security guard screen.");
    document.getElementById("authScreen").classList.remove("hidden");
    document.getElementById("dashboardScreen").classList.add("hidden");
    
    // Reset file string inputs smoothly
    document.getElementById("fileUpload").value = "";
    document.getElementById("fileNameTxt").innerText = "";
    document.getElementById("resultBox").style.display = "none";
    document.getElementById("resultBox").classList.add("hidden");
}