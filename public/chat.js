/**
 * LLM Chat App Frontend - Firewall for AI Edition
 * * Updated to handle 403 Security Blocks and display custom JSON error messages.
 */

// DOM elements
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendButton = document.getElementById("send-button");
const typingIndicator = document.getElementById("typing-indicator");

// Chat state
let chatHistory = [
	{
		role: "assistant",
		content:
			"Hello! I'm an LLM chat app powered by Cloudflare Workers AI. How can I help you today?",
	},
];
let isProcessing = false;

// Auto-resize textarea as user types
userInput.addEventListener("input", function () {
	this.style.height = "auto";
	this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
userInput.addEventListener("keydown", function (e) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

// Send button click handler
sendButton.addEventListener("click", sendMessage);

/**
 * Sends a message to the chat API and processes the response
 */
async function sendMessage() {
	const message = userInput.value.trim();

	// Don't send empty messages
	if (message === "" || isProcessing) return;

	// Disable input while processing
	isProcessing = true;
	userInput.disabled = true;
	sendButton.disabled = true;

	// Add user message to chat
	addMessageToChat("user", message);

	// Clear input
	userInput.value = "";
	userInput.style.height = "auto";

	// Show typing indicator
	typingIndicator.classList.add("visible");

	// Add message to history
	chatHistory.push({ role: "user", content: message });

	try {
		// Send request to API
		const response = await fetch("/api/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				messages: chatHistory,
			}),
		});

		// --- START SECURITY BLOCK LOGIC ---
		// Check for the 403 Blocked status from the Firewall for AI
		if (response.status === 403) {
			const errorData = await response.json();
			typingIndicator.classList.remove("visible");
			
			// Display the specific message from your Custom JSON response body
			addMessageToChat(
				"assistant",
				`🚫 **Security Block:** ${errorData.message || "Request denied by security policy."}`
			);
			
			return; // Exit early so we don't try to stream an error
		}
		// --- END SECURITY BLOCK LOGIC ---

		if (!response.ok) {
			throw new Error("Failed to get response");
		}

		// Create assistant response element for streaming
		const assistantMessageEl = document.createElement("div");
		assistantMessageEl.className = "message assistant-message";
		assistantMessageEl.innerHTML = "<p></p>";
		chatMessages.appendChild(assistantMessageEl);

		// Process streaming response
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let responseText = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = decoder.decode(value, { stream: true });
			const lines = chunk.split("\n");

			for (const line of lines) {
				if (!line.trim()) continue;
				
				try {
					// Handling both raw text and data: SSE format if necessary
					const cleanLine = line.replace(/^data: /, "").trim();
					if (cleanLine === "[DONE]") break;

					const jsonData = JSON.parse(cleanLine);
					if (jsonData.response) {
						responseText += jsonData.response;
						assistantMessageEl.querySelector("p").textContent = responseText;
						chatMessages.scrollTop = chatMessages.scrollHeight;
					}
				} catch (e) {
					// Fallback for non-JSON chunks
					responseText += line;
					assistantMessageEl.querySelector("p").textContent = responseText;
				}
			}
		}

		chatHistory.push({ role: "assistant", content: responseText });

	} catch (error) {
		console.error("Error:", error);
		addMessageToChat(
			"assistant",
			"Sorry, there was an error processing your request."
		);
	} finally {
		typingIndicator.classList.remove("visible");
		isProcessing = false;
		userInput.disabled = false;
		sendButton.disabled = false;
		userInput.focus();
		chatMessages.scrollTop = chatMessages.scrollHeight;
	}
}

/**
 * Helper function to add message to chat
 */
function addMessageToChat(role, content) {
	const messageEl = document.createElement("div");
	messageEl.className = `message ${role}-message`;
	messageEl.innerHTML = `<p>${content}</p>`;
	chatMessages.appendChild(messageEl);
	chatMessages.scrollTop = chatMessages.scrollHeight;
}
