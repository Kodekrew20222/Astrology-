// const API_KEY = "";
// const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`;

let chatHistory = [];
let isAutoSpeak = true;
let userProfile = {};

const now = new Date();
const chatContainer = document.getElementById('chat-container');
const questionInput = document.getElementById('userQuestion');
const avatarVideo = document.getElementById('avatar-video');

// 1. Navigation from Setup to Chat
document.getElementById('start-chat').onclick = () => {
    userProfile = {
        name: document.getElementById('userName').value || "Seeker",
        loc: document.getElementById('userLoc').value,
        dob: document.getElementById('userDob').value,
        tob: document.getElementById('userTob').value
    };
    document.getElementById('setup-step').classList.add('hidden');
    document.getElementById('chat-step').classList.remove('hidden');

    chatHistory.push({
        role: "user",
        parts: [{ text: `Context: My name is ${userProfile.name}, born ${userProfile.dob} at ${userProfile.tob} in ${userProfile.loc}. Act as my personal mystic astrologer.` }]
    });
};

// 2. The Chat Execution
const sendMessage = async () => {
    const text = questionInput.value.trim();
    if (!text) return;

    const now = new Date();
    const formattedDateTime = now.toLocaleString("en-IN", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    });

    // Show User Message
    appendMessage(text, 'user-msg');
    questionInput.value = "";
    const enrichedPrompt = `
    Current Date & Time: ${formattedDateTime}
    User Question: ${text}
    Instruction: Give astrology predictions based on current planetary positions relative to the above date and time. Always focus on present and future insights, not past.`;
    chatHistory.push({
        role: "user",
        parts: [{ text: enrichedPrompt }]
    });

    // SHOW PROCESSING INDICATOR
    const loadingId = "loader-" + Date.now();
    const loadingDiv = document.createElement('div');
    loadingDiv.id = loadingId;
    loadingDiv.className = "msg ai-msg italic text-mute  d";
    loadingDiv.innerHTML = `<span class="spinner-grow spinner-grow-sm text-info"></span> Consultng the heavens...`;
    chatContainer.appendChild(loadingDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        const response = await fetch('/.netlify/functions/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: chatHistory,
                generationConfig: { temperature: 0.8 }
            })
        });

        const data = await response.json();

        // Remove loader
        document.getElementById(loadingId).remove();

        // ✅ HANDLE ERRORS (FIXES SILENT FAIL)
        if (data.error) {
            console.log("API ERROR:", data.error);
            appendMessage("⚠️ " + data.error.message, "ai-msg");
            return;
        }

        if (data.candidates && data.candidates.length > 0) {
            const aiText = data.candidates[0].content.parts[0].text.replace(/[*#]/g, '');

            appendMessage(aiText, 'ai-msg');
            chatHistory.push({ role: "model", parts: [{ text: aiText }] });

            if (isAutoSpeak) speak(aiText);
        } else {
            console.log("UNKNOWN RESPONSE:", data);
            appendMessage("⚠️ No response generated. Try again.", "ai-msg");
        }

    } catch (err) {
        console.error("FETCH ERROR:", err);
        document.getElementById(loadingId).innerHTML =
            "⚠️ Connection lost. Try again.";
    }
};

// UI Helpers
function appendMessage(text, className) {
    const div = document.createElement('div');
    div.className = `msg ${className}`;
    div.innerText = text;
    chatContainer.appendChild(div);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function speak(text) {
    window.speechSynthesis.cancel();

    const msg = new SpeechSynthesisUtterance(text);
    msg.rate = 0.9;

    // 🎥 Play speaking animation (you can later swap video)
    if (avatarVideo) {
        avatarVideo.playbackRate = 1;
        avatarVideo.currentTime = 0;
        avatarVideo.play();
    }

    msg.onstart = () => {
        if (avatarVideo) avatarVideo.play();
    };

    msg.onend = () => {
        if (avatarVideo) {
            avatarVideo.pause();
            avatarVideo.currentTime = 0;
        }
    };

    window.speechSynthesis.speak(msg);
}

// Event Listeners
document.getElementById('send-btn').onclick = sendMessage;
questionInput.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

// Voice logic (Same as before)
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
    const recognition = new SpeechRecognition();
    document.getElementById('start-record').onclick = () => recognition.start();
    recognition.onresult = (e) => {
        questionInput.value = e.results[0][0].transcript;
        sendMessage();
    };
}
